import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { cleanupBrainLegacyStorage } from './serviceWorkerCleanup.ts'

async function disableServiceWorkerCaching(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await cleanupBrainLegacyStorage(window.location.origin, import.meta.env.BASE_URL);
  } catch {
    // best-effort cleanup to avoid stale client state
  }
}

void disableServiceWorkerCaching();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
