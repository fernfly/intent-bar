import { isComposing } from './hotkey'

/** A text field the host attaches the bar to. */
export type AttachedField = HTMLInputElement | HTMLTextAreaElement

/** How the attached field asked for the bar: focus, a click, or Enter on its text. */
export type AttachTrigger = 'focus' | 'click' | 'enter'

/**
 * Hands the host's own search field to the bar: focusing or clicking it, or
 * pressing Enter in it, calls `onOpen` with the field. It listens on the
 * document rather than the field, so a field rendered after the bar mounts
 * still counts. `target` is a CSS selector or the element itself. Enter is
 * taken from the field, so a host form doesn't submit too.
 */
export function watchAttached(
  target: string | Element,
  doc: Document,
  onOpen: (field: AttachedField, trigger: AttachTrigger) => void,
): () => void {
  if (typeof target === 'string') doc.querySelector(target) // fails here, at mount, on an invalid selector

  const fieldOf = (e: Event): AttachedField | null => {
    const el = e.composedPath()[0] as Element | undefined
    if (!el || el.nodeType !== 1) return null
    const hit = typeof target === 'string' ? el.matches(target) : el === target
    return hit && 'value' in el ? (el as AttachedField) : null
  }
  const onFocus = (e: Event) => {
    const field = fieldOf(e)
    if (field) onOpen(field, e.type === 'click' ? 'click' : 'focus')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.defaultPrevented || isComposing(e)) return
    const field = fieldOf(e)
    if (!field) return
    e.preventDefault()
    onOpen(field, 'enter')
  }

  doc.addEventListener('focusin', onFocus, true)
  doc.addEventListener('click', onFocus, true)
  doc.addEventListener('keydown', onKeyDown, true)
  return () => {
    doc.removeEventListener('focusin', onFocus, true)
    doc.removeEventListener('click', onFocus, true)
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}
