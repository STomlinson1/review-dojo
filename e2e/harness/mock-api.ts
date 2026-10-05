import { appendFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

export type ProviderRoute = 'claude' | 'codex'

interface TurnBase {
  provider: ProviderRoute
  /** Must appear in the last user-authored or tool-output item of the request. */
  expect: string
  hold?: boolean
}

export interface TextTurn extends TurnBase {
  text: string
  chunks?: number
  delayMs?: number
}

export interface ToolTurn extends TurnBase {
  tool: { name: string; input: Record<string, unknown> }
}

export type Turn = TextTurn | ToolTurn

export interface MockRequest {
  method: string
  url: string
  route: ProviderRoute | null
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown> | null
  input: string
  closed: boolean
}

export interface Mock {
  url: string
  requests: MockRequest[]
  unexpected: string[]
  blocked: string[]
  script(...turns: Turn[]): void
  pending(): number
  release(rest?: string): void
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function pieces(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count)
  return Array.from({ length: count }, (_, index) => text.slice(index * size, (index + 1) * size)).filter(Boolean)
}

function sse(response: ServerResponse): (event: string, data: Record<string, unknown>) => void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  return (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
}

function lastInput(route: ProviderRoute, body: Record<string, unknown>): string {
  const items = ((route === 'claude' ? body.messages : body.input) ?? []) as Record<string, unknown>[]
  // The Claude CLI appends a role:"system" environment message after the real user turn.
  const authored = items.filter((item) => item.role === 'user' || String(item.type ?? '').endsWith('_output'))
  const last = authored.at(-1)
  return last ? JSON.stringify(last.content ?? last.output ?? last) : ''
}

type Finish = (rest: string) => void

async function claudeReply(
  response: ServerResponse,
  body: Record<string, unknown>,
  turn: Turn,
  index: number,
): Promise<Finish | null> {
  const send = sse(response)
  send('message_start', {
    message: {
      id: `msg_${index}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 0 },
    },
  })
  if ('tool' in turn) {
    send('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: `toolu_${index}`, name: turn.tool.name, input: {} },
    })
    send('content_block_delta', {
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.tool.input) },
    })
  } else {
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    for (const piece of pieces(turn.text, turn.chunks ?? 1)) {
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } })
      if (turn.delayMs) await sleep(turn.delayMs)
    }
  }
  const finish: Finish = (rest) => {
    if (rest) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: rest } })
    send('content_block_stop', { index: 0 })
    send('message_delta', {
      delta: { stop_reason: 'tool' in turn ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    })
    send('message_stop', {})
    response.end()
  }
  if (turn.hold) return finish
  finish('')
  return null
}

async function codexReply(
  response: ServerResponse,
  _body: Record<string, unknown>,
  turn: Turn,
  index: number,
): Promise<Finish | null> {
  const send = sse(response)
  const created = { id: `resp_${index}`, object: 'response', status: 'in_progress', output: [] }
  send('response.created', { response: created })
  let item: Record<string, unknown>
  let message: { type: string; text: string; annotations: never[] } | null = null
  if ('tool' in turn) {
    item = {
      id: `fc_${index}`,
      type: 'function_call',
      status: 'completed',
      call_id: `call_${index}`,
      name: turn.tool.name,
      arguments: JSON.stringify(turn.tool.input),
    }
    send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } })
  } else {
    message = { type: 'output_text', text: turn.text, annotations: [] }
    item = { id: `msg_${index}`, type: 'message', role: 'assistant', status: 'completed', content: [message] }
    send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
    for (const piece of pieces(turn.text, turn.chunks ?? 1)) {
      send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: piece })
      if (turn.delayMs) await sleep(turn.delayMs)
    }
  }
  const finish: Finish = (rest) => {
    if (rest && message) {
      message.text += rest
      send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: rest })
    }
    send('response.output_item.done', { output_index: 0, item })
    send('response.completed', {
      response: {
        ...created,
        status: 'completed',
        output: [item],
        usage: {
          input_tokens: 11,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 18,
        },
      },
    })
    response.end()
  }
  if (turn.hold) return finish
  finish('')
  return null
}

const ROUTES: { route: ProviderRoute; path: RegExp; reply: typeof claudeReply }[] = [
  { route: 'claude', path: /^\/v1\/messages(\?|$)/, reply: claudeReply },
  { route: 'codex', path: /^\/v1\/responses(\?|$)/, reply: codexReply },
]

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => resolve(raw))
  })
}

export async function startMock(logPath: string): Promise<Mock> {
  const queue: Turn[] = []
  const requests: MockRequest[] = []
  const unexpected: string[] = []
  const blocked: string[] = []
  const sockets = new Set<Socket>()
  const held: Finish[] = []
  let served = 0

  const log = (entry: Record<string, unknown>) => appendFileSync(logPath, `${JSON.stringify(entry)}\n`)

  // 400 makes both CLIs give up at once; they retry 5xx and 429 with backoff.
  const reject = (response: ServerResponse, status: number, why: string): void => {
    unexpected.push(why)
    log({ unexpected: why })
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `mock: ${why}` } }))
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const raw = await readBody(request)
    const method = request.method ?? ''
    const url = request.url ?? ''
    if (/^https?:\/\//.test(url)) {
      const target = new URL(url).host
      blocked.push(target)
      log({ blocked: target })
      response.writeHead(403).end()
      return
    }
    if (method === 'HEAD' && url === '/api/hello') {
      response.writeHead(200).end()
      return
    }
    const hit = method === 'POST' ? ROUTES.find((candidate) => candidate.path.test(url)) : undefined
    if (!hit) return reject(response, 404, `unknown route ${method} ${url}`)
    const body = JSON.parse(raw) as Record<string, unknown>
    const entry: MockRequest = {
      method,
      url,
      route: hit.route,
      headers: request.headers,
      body,
      input: lastInput(hit.route, body),
      closed: false,
    }
    requests.push(entry)
    response.on('close', () => (entry.closed = true))
    const turn = queue.shift()
    if (!turn)
      return reject(response, 400, `no scripted turn left for a ${hit.route} request: ${entry.input.slice(0, 200)}`)
    if (turn.provider !== hit.route) {
      return reject(response, 400, `next turn is for ${turn.provider} but ${hit.route} called`)
    }
    if (!entry.input.includes(turn.expect)) {
      return reject(
        response,
        400,
        `expected input containing ${JSON.stringify(turn.expect)}, got: ${entry.input.slice(0, 200)}`,
      )
    }
    log({ served: hit.route, expect: turn.expect })
    const finish = await hit.reply(response, body, turn, (served += 1))
    if (finish) held.push(finish)
  }

  // A rejection escaping the request handler would end the process that owns the mock.
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error: unknown) =>
      reject(
        response,
        400,
        `${request.method} ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (request, socket) => {
    unexpected.push(`websocket upgrade ${request.url}`)
    log({ unexpected: `websocket upgrade ${request.url}` })
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
  })
  server.on('connect', (request, socket) => {
    blocked.push(request.url ?? '')
    log({ blocked: request.url })
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    unexpected,
    blocked,
    script: (...turns) => void queue.push(...turns),
    pending: () => queue.length,
    release: (rest = '') => {
      for (const finish of held.splice(0)) finish(rest)
    },
    close: () => {
      for (const socket of sockets) socket.destroy()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
