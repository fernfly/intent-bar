/**
 * A React host app for the harness, built by `serve.mjs`. Like Plane, it
 * runs in StrictMode and wraps the app in providers with their own React key
 * handlers. The bar sits inside one, to show that its keys don't bubble up
 * the host's React tree through the portal.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IntentBar, type IntentBarProps } from '../../src/index'

declare global {
  interface Window {
    harness: Omit<IntentBarProps, 'open' | 'onOpenChange'>
    hostEvents: { reactKeydowns: number }
    harnessReady?: boolean
  }
}

function HostApp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('harness:open', onOpen)
    window.harnessReady = true
    return () => window.removeEventListener('harness:open', onOpen)
  }, [])

  return (
    <div onKeyDown={() => window.hostEvents.reactKeydowns++}>
      <IntentBar {...window.harness} open={open} onOpenChange={setOpen} />
    </div>
  )
}

createRoot(document.getElementById('react-root')!).render(
  <StrictMode>
    <HostApp />
  </StrictMode>,
)
