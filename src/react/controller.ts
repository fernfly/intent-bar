/** What `open()` takes: text to start the bar with, and whether to ask the model with it straight away. */
export interface OpenOptions {
  query?: string
  ask?: boolean
}

/** One call to `open()`, numbered so the same text asked twice still counts twice. */
export interface OpenRequest extends OpenOptions {
  id: number
}

/** Opens and closes a bar from outside it. */
export interface IntentBarController {
  open(options?: OpenOptions): void
  close(): void
}

const bars: IntentBarController[] = []
let pending: OpenOptions | null = null

/**
 * Registers a mounted bar and returns its unregister function. The most
 * recently mounted bar is the one `open()` and `close()` reach. An `open()`
 * made before any bar mounted is applied to the first one that does, so a
 * script can call `init()` and then `open()` at once.
 */
export function registerBar(bar: IntentBarController): () => void {
  bars.push(bar)
  if (pending) {
    const options = pending
    pending = null
    bar.open(options)
  }
  return () => {
    const index = bars.lastIndexOf(bar)
    if (index !== -1) bars.splice(index, 1)
  }
}

/** Opens or closes the most recently mounted bar. */
export const intentBar: IntentBarController = {
  open(options = {}) {
    const bar = bars.at(-1)
    if (bar) bar.open(options)
    else pending = options
  },
  close() {
    pending = null
    bars.at(-1)?.close()
  },
}

/** Opens and closes the bar from the host's own buttons and menus, anywhere in the app. */
export function useIntentBar(): IntentBarController {
  return intentBar
}
