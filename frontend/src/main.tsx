import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme/theme.css'
import { ThemeProvider } from './theme/ThemeProvider'
import App from './App.tsx'
import { cleanupBrainLegacyStorage } from './serviceWorkerCleanup.ts'

// Some embedded Android WebViews report a usable innerHeight while CSS 100vh
// and html/body height: 100% resolve to zero after their host view is resized.
// Keep the document sized to the visible WebView only in that case.
let embeddedViewportFallback = false
function repairEmbeddedViewportHeight(): void {
  if (window.innerHeight <= 0) return
  if (!embeddedViewportFallback && document.documentElement.getBoundingClientRect().height > 0) return
  embeddedViewportFallback = true
  document.documentElement.style.height = `${window.innerHeight}px`
  document.documentElement.style.setProperty('--app-viewport-height', `${window.innerHeight}px`)
}

repairEmbeddedViewportHeight()
window.addEventListener('resize', repairEmbeddedViewportHeight)
window.visualViewport?.addEventListener('resize', repairEmbeddedViewportHeight)
requestAnimationFrame(repairEmbeddedViewportHeight)

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
    <ThemeProvider><App /></ThemeProvider>
  </StrictMode>,
)
