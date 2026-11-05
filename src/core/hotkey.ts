/** A parsed hotkey. `mod` is ⌘ on Apple platforms and Ctrl everywhere else. */
export interface Hotkey {
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

const TYPING_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/**
 * Parses a hotkey such as `mod+k`, `ctrl+shift+p` or `/`. Throws on an
 * unknown modifier or a missing key, so a typo fails at mount rather than
 * silently never matching.
 */
export function parseHotkey(spec: string): Hotkey {
  const parts = spec.toLowerCase().split('+').map((p) => p.trim())
  const key = parts.pop()
  if (!key) throw new Error(`Invalid hotkey "${spec}"`)
  const hk: Hotkey = { key, mod: false, ctrl: false, meta: false, alt: false, shift: false }
  for (const part of parts) {
    if (part === 'mod') hk.mod = true
    else if (part === 'ctrl' || part === 'control') hk.ctrl = true
    else if (part === 'meta' || part === 'cmd') hk.meta = true
    else if (part === 'alt' || part === 'option') hk.alt = true
    else if (part === 'shift') hk.shift = true
    else throw new Error(`Unknown modifier "${part}" in hotkey "${spec}"`)
  }
  return hk
}

/** Whether ⌘ is the platform's primary modifier. Read at call time, never at import. */
export function isApplePlatform(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  const platform = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/**
 * The key a keyboard event names, lowercased. Falls back to the physical key
 * when the layout or Option produces a non-ASCII character, so `mod+k` still
 * works on a Cyrillic layout.
 */
function eventKey(e: KeyboardEvent): string {
  const key = e.key.toLowerCase()
  if (key.length !== 1 || (key >= ' ' && key <= '~')) return key
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
  return physical ? (physical[1] ?? physical[2] ?? key).toLowerCase() : key
}

/** Whether a keyboard event is exactly this hotkey, modifiers included. */
export function matchesHotkey(e: KeyboardEvent, hk: Hotkey, apple = isApplePlatform()): boolean {
  const wantMeta = hk.meta || (hk.mod && apple)
  const wantCtrl = hk.ctrl || (hk.mod && !apple)
  return (
    e.metaKey === wantMeta &&
    e.ctrlKey === wantCtrl &&
    e.altKey === hk.alt &&
    e.shiftKey === hk.shift &&
    eventKey(e) === hk.key
  )
}

/** Whether an element takes typed text: a text-like input, a textarea, a select, editable content or a typing role. */
export function isEditable(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined
  if (!el || el.nodeType !== 1) return false
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
  if (el.isContentEditable) return true
  const role = el.getAttribute('role')
  return role !== null && TYPING_ROLES.has(role)
}

/** Whether an IME is composing, in which case Enter, Tab and Escape belong to the IME. */
export function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}

/** Whether a hotkey has a modifier that stops it typing text. Shift alone doesn't. */
export function hasModifier(hk: Hotkey): boolean {
  return hk.mod || hk.ctrl || hk.meta || hk.alt
}

/**
 * Whether a page-level keydown should open the bar. It skips an event the
 * page already handled (`defaultPrevented`), a held key, and IME input. A
 * bare-key hotkey also skips editable fields, read from `composedPath()[0]`
 * because `target` is retargeted to the outermost shadow host. A modified
 * hotkey types nothing, so it opens from a field too.
 */
export function shouldOpenFromHotkey(e: KeyboardEvent, hk: Hotkey, apple = isApplePlatform()): boolean {
  if (e.defaultPrevented || e.repeat || isComposing(e)) return false
  if (!matchesHotkey(e, hk, apple)) return false
  return hasModifier(hk) || !isEditable(e.composedPath()[0] ?? e.target)
}
