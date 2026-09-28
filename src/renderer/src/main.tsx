import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsWorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new Worker(DiffsWorkerUrl, { type: 'module' }), poolSize: 2 }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        langs: ['typescript', 'tsx', 'javascript', 'jsx', 'css', 'scss', 'json', 'html', 'markdown', 'yaml'],
      }}
    >
      <App />
    </WorkerPoolContextProvider>
  </StrictMode>,
)
