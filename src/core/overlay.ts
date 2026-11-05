/**
 * Overlay mechanics the bar owns instead of Radix's: Radix's focus scope and
 * outside-click code listen on `document`, where shadow DOM retargeting hides
 * which element really has focus.
 */

const TABBABLE = [
  'input:not([disabled]):not([type="hidden"])',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The element that really has focus, looking through open shadow roots, so focus can return into a web component. */
export function deepActiveElement(doc: Document = document): Element | null {
  let active = doc.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

/**
 * Returns focus to `returnTo` after the bar closes, unless focus has since
 * moved somewhere else. Focus counts as still the bar's while
 * `root.activeElement` is set, or while nothing (or only the host) has it.
 * It waits a microtask because React ends the commit that removes the bar by
 * re-focusing whatever had focus when the commit began, which from the page's
 * side is the shadow host.
 */
export function returnFocus(returnTo: HTMLElement | null, root: ShadowRoot): void {
  const doc = root.host.ownerDocument
  const idle = () => !doc.activeElement || doc.activeElement === doc.body || doc.activeElement === root.host
  if (!returnTo?.isConnected || (root.activeElement === null && !idle())) return
  queueMicrotask(() => {
    if (root.activeElement === null && idle() && returnTo.isConnected) returnTo.focus({ preventScroll: true })
  })
}

/** Whether a click target can take focus. Clicks elsewhere in the panel must not pull focus out of the input. */
export function isFocusable(target: EventTarget | null): boolean {
  const el = target as Element | null
  return !!el && el.nodeType === 1 && el.closest(TABBABLE) !== null
}

/** Tabbable elements inside `scope`, in DOM order, skipping anything under `hidden` or `inert`. */
export function tabbables(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest('[hidden], [inert]'))
}

/**
 * Moves focus to the next or previous tabbable in `scope`, wrapping at both
 * ends. The bar handles every Tab itself rather than only the edges, so the
 * order is the same in every browser and testable headlessly. `root` is where
 * the current focus is read, which inside a shadow root is the shadow root.
 */
export function cycleFocus(scope: ParentNode, root: DocumentOrShadowRoot, backwards: boolean): HTMLElement | null {
  const list = tabbables(scope)
  if (list.length === 0) return null
  const index = list.indexOf(root.activeElement as HTMLElement)
  const next = backwards
    ? list[index <= 0 ? list.length - 1 : index - 1]
    : list[index === -1 || index === list.length - 1 ? 0 : index + 1]
  next?.focus()
  return next ?? null
}

/**
 * Locks the page's scroll and returns the function that restores it. Pads
 * the page by the scrollbar's width so the content behind the bar doesn't
 * jump sideways.
 */
export function lockScroll(doc: Document = document): () => void {
  const html = doc.documentElement
  const view = doc.defaultView
  const gap = view ? view.innerWidth - html.clientWidth : 0
  const previous = { overflow: html.style.overflow, paddingRight: html.style.paddingRight }
  const padding = view ? parseFloat(view.getComputedStyle(html).paddingRight) || 0 : 0
  html.style.overflow = 'hidden'
  if (gap > 0) html.style.paddingRight = `${padding + gap}px`
  return () => {
    html.style.overflow = previous.overflow
    html.style.paddingRight = previous.paddingRight
  }
}
