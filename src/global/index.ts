/**
 * The script-tag build: `window.FernflyIntentBar`. It renders the same
 * `<IntentBar>` as the React package, from a React root of its own whose
 * container is never attached; the bar portals into its shadow root as usual.
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { intentBar, type OpenOptions } from '../react/controller'
import { IntentBar, type IntentBarProps } from '../react/IntentBar'

/** The options `init()` takes: the React props, minus open state, which `open()` and `close()` drive. */
export type InitOptions = Omit<IntentBarProps, 'open' | 'defaultOpen' | 'onOpenChange'>

let root: Root | null = null

/** Mounts the bar. Calling it again replaces the previous bar. */
export function init(options: InitOptions): void {
  destroy()
  root = createRoot(document.createElement('div'))
  root.render(createElement(IntentBar, options))
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
  root?.unmount()
  root = null
}
