const { appendFileSync } = require('node:fs')
const { shell } = require('electron')

const log = process.env.DOJO_E2E_OPEN_LOG
if (!log) throw new Error('DOJO_E2E_OPEN_LOG must be set')

shell.openExternal = async (url) => {
  appendFileSync(log, `${url}\n`)
}
