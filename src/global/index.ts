/**
 * The script-tag build: `window.FernflyIntentBar`. It renders the same
 * `<IntentBar>` as the React package, from a React root of its own whose
 * container is never attached; the bar portals into its shadow root as usual.
 *
 * A tag with `data-project` or `data-endpoint` mounts the bar as it loads.
 * Anything the host passes no function for goes out as a `fernfly:preview`,
 * `fernfly:run` or `fernfly:values` event on `window`.
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { intentBar, type OpenOptions } from '../react/controller'
import { IntentBar } from '../react/IntentBar'
import { optionsFromScript, withEventFallbacks, type InitOptions } from './setup'

export type { InitOptions }

let root: Root | null = null
let cancelWait: (() => void) | null = null

/** Mounts the bar, once `<body>` exists. Calling it again replaces the previous bar, including one its script tag mounted. */
export function init(options: InitOptions): void {
  destroy()
  const mount = () => {
    cancelWait = null
    root = createRoot(document.createElement('div'))
    root.render(createElement(IntentBar, withEventFallbacks(options, window)))
  }
  if (document.body) return mount()
  document.addEventListener('DOMContentLoaded', mount, { once: true })
  cancelWait = () => document.removeEventListener('DOMContentLoaded', mount)
}

/** Opens the bar, for the host's own buttons and menus. `query` starts it with text, and `ask` sends that text to the model. */
export function open(options?: OpenOptions): void {
  intentBar.open(options)
}

/** Closes the bar. */
export function close(): void {
  intentBar.close()
}

/** Unmounts the bar and removes its host element. */
export function destroy(): void {
  cancelWait?.()
  cancelWait = null
  root?.unmount()
  root = null
}

// The one place the build reads the page as it loads: its own script tag, which is only known while it runs.
const fromTag = typeof document === 'undefined' ? null : optionsFromScript(document.currentScript)
if (fromTag) init(fromTag)
