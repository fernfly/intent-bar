import { afterEach, describe, expect, it } from 'vitest'
import { isEditable, matchesHotkey, parseHotkey, shouldOpenFromHotkey } from './hotkey'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('parseHotkey', () => {
  it('reads modifiers and the key', () => {
    expect(parseHotkey('mod+K')).toEqual({ key: 'k', mod: true, ctrl: false, meta: false, alt: false, shift: false })
    expect(parseHotkey('ctrl+shift+p')).toMatchObject({ key: 'p', ctrl: true, shift: true })
    expect(parseHotkey('/')).toMatchObject({ key: '/', mod: false })
  })

  it('rejects a typo rather than never matching', () => {
    expect(() => parseHotkey('cmmd+k')).toThrow(/Unknown modifier/)
    expect(() => parseHotkey('')).toThrow(/Invalid hotkey/)
  })
})

describe('matchesHotkey', () => {
  const modK = parseHotkey('mod+k')

  it('is ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(matchesHotkey(key({ key: 'k', metaKey: true }), modK, true)).toBe(true)
    expect(matchesHotkey(key({ key: 'k', ctrlKey: true }), modK, true)).toBe(false)
    expect(matchesHotkey(key({ key: 'k', ctrlKey: true }), modK, false)).toBe(true)
    expect(matchesHotkey(key({ key: 'k', metaKey: true }), modK, false)).toBe(false)
  })

  it('requires the exact modifiers', () => {
    expect(matchesHotkey(key({ key: 'k', metaKey: true, shiftKey: true }), modK, true)).toBe(false)
    expect(matchesHotkey(key({ key: 'K', metaKey: true }), modK, true)).toBe(true)
  })

  it('falls back to the physical key on a non-Latin layout', () => {
    expect(matchesHotkey(key({ key: 'л', code: 'KeyK', metaKey: true }), modK, true)).toBe(true)
    expect(matchesHotkey(key({ key: 'л', code: 'KeyJ', metaKey: true }), modK, true)).toBe(false)
  })
})

describe('isEditable', () => {
  it('counts text inputs, textareas, selects, editable content and typing roles', () => {
    document.body.innerHTML = `
      <input id="text"><input id="box" type="checkbox"><textarea id="area"></textarea>
      <div id="rich" contenteditable="true"></div><div id="role" role="combobox"></div><div id="plain"></div>`
    const el = (id: string) => document.getElementById(id)
    expect(isEditable(el('text'))).toBe(true)
    expect(isEditable(el('box'))).toBe(false)
    expect(isEditable(el('area'))).toBe(true)
    expect(isEditable(el('rich'))).toBe(true)
    expect(isEditable(el('role'))).toBe(true)
    expect(isEditable(el('plain'))).toBe(false)
    expect(isEditable(null)).toBe(false)
  })
})

describe('shouldOpenFromHotkey', () => {
  const modK = parseHotkey('mod+k')
  const slash = parseHotkey('/')

  /** Dispatches a keydown on `target` and reports what the guard decided at the document. */
  function decide(target: EventTarget, init: KeyboardEventInit, hk = modK, before?: (e: KeyboardEvent) => void) {
    let result: boolean | undefined
    if (before) target.addEventListener('keydown', before as EventListener)
    const listener = (e: Event) => {
      result = shouldOpenFromHotkey(e as KeyboardEvent, hk, true)
    }
    document.addEventListener('keydown', listener)
    target.dispatchEvent(key(init))
    document.removeEventListener('keydown', listener)
    if (before) target.removeEventListener('keydown', before as EventListener)
    return result
  }

  it('opens on the hotkey', () => {
    expect(decide(document.body, { key: 'k', metaKey: true })).toBe(true)
  })

  it('skips a key the page already handled', () => {
    expect(decide(document.body, { key: 'k', metaKey: true }, modK, (e) => e.preventDefault())).toBe(false)
  })

  it('skips a held key and IME composition', () => {
    expect(decide(document.body, { key: 'k', metaKey: true, repeat: true })).toBe(false)
    expect(decide(document.body, { key: 'k', metaKey: true, isComposing: true })).toBe(false)
  })

  it('skips a bare-key hotkey typed into a field inside a shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const input = document.createElement('input')
    host.attachShadow({ mode: 'open' }).append(input)
    expect(decide(input, { key: '/' }, slash)).toBe(false)
    expect(decide(document.body, { key: '/' }, slash)).toBe(true)
  })

  it('opens a modified hotkey from a field, since it types nothing', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(decide(input, { key: 'k', metaKey: true })).toBe(true)
  })
})
