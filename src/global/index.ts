/**
 * The script-tag build: `window.FernflyIntentBar`. It renders the same
 * `<IntentBar>` as the React package, from a React root of its own whose
 * container is never attached; the bar portals into its shadow root as usual.
 */
import { createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IntentBar, type IntentBarProps } from '../react/IntentBar'

/** The options `init()` takes: the React props, minus open state, which `open()` and `close()` drive. */
export type InitOptions = Omit<IntentBarProps, 'open' | 'defaultOpen' | 'onOpenChange'>

let isOpen = false
let root: Root | null = null
const listeners = new Set<() => void>()

/** Sets the open state and re-renders the bar. */
function setOpen(next: boolean): void {
  if (isOpen === next) return
  isOpen = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function GlobalBar({ options }: { options: InitOptions }) {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false)
  return createElement(IntentBar, { ...options, open, onOpenChange: setOpen })
}

/** Mounts the bar. Calling it again replaces the previous bar. */
export function init(options: InitOptions): void {
  destroy()
  root = createRoot(document.createElement('div'))
  root.render(createElement(GlobalBar, { options }))
}

/** Opens the bar, for the host's own buttons and menus. */
export function open(): void {
  setOpen(true)
}

/** Closes the bar. */
export function close(): void {
  setOpen(false)
}

/** Unmounts the bar and removes its host element. */
export function destroy(): void {
  root?.unmount()
  root = null
  isOpen = false
}
