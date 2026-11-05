import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandRoot, defaultFilter } from 'cmdk'
import { hasModifier, isComposing, matchesHotkey, parseHotkey, shouldOpenFromHotkey, type Hotkey } from '../core/hotkey'
import { cycleFocus, deepActiveElement, isFocusable, lockScroll, returnFocus } from '../core/overlay'
import { createShadowMount, type ShadowMount } from '../core/shadow'
import { applyTheme, browserThemeEnv, readTheme } from '../core/theme'
import type { BarPage, Call, ToolConfig, Transport } from '../core/types'

export interface IntentBarProps {
  /** Sends a sentence to the model. */
  transport: Transport
  /** Pages for instant search. */
  pages?: BarPage[]
  /** How each tool and its arguments are labelled and edited. */
  tools?: Record<string, ToolConfig>
  /** The hotkey that opens the bar, or `false` for none. Defaults to `mod+k`. */
  hotkey?: string | false
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Goes to a page picked from instant search. Defaults to setting `location.href`. */
  navigate?: (href: string) => void
  placeholder?: string
}

type Phase =
  | { kind: 'search' }
  | { kind: 'loading' }
  | { kind: 'parsed'; call: Call; latency: number }
  | { kind: 'out_of_scope'; reply?: string }
  | { kind: 'error' }

const ASK = '__fernfly_ask__'
const ASK_MIN_WORDS = 3

/** cmdk's filter, with the Ask item always scoring highest so it stays pinned first. */
const filter = (value: string, search: string, keywords?: string[]) =>
  value === ASK ? 1 : defaultFilter(value, search, keywords)

/** Stops a React event here, so it bubbles neither to the host app's React tree nor past the shadow host. */
const stop = (e: SyntheticEvent) => e.stopPropagation()

/**
 * Creates the shadow mount after the first render and removes it on unmount,
 * so nothing touches `document` at import or during server rendering.
 */
function useShadowMount(): ShadowMount | null {
  const [mount, setMount] = useState<ShadowMount | null>(null)
  useEffect(() => {
    const created = createShadowMount()
    setMount(created)
    return () => created.destroy()
  }, [])
  return mount
}

/**
 * The intent bar. It renders through a portal into its own shadow root at the
 * end of `document.body`, and opens on its hotkey unless the page already
 * handled the key.
 */
export function IntentBar(props: IntentBarProps) {
  const mount = useShadowMount()
  const [innerOpen, setInnerOpen] = useState(props.defaultOpen ?? false)
  const open = props.open ?? innerOpen
  const latest = useRef(props)
  latest.current = props

  const setOpen = useCallback((next: boolean) => {
    if (latest.current.open === undefined) setInnerOpen(next)
    latest.current.onOpenChange?.(next)
  }, [])

  const hotkey = useMemo(() => (props.hotkey === false ? null : parseHotkey(props.hotkey ?? 'mod+k')), [props.hotkey])

  useEffect(() => {
    if (!hotkey) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldOpenFromHotkey(e, hotkey)) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkey, setOpen])

  if (!mount) return null
  return createPortal(
    open ? <Overlay {...props} mount={mount} hotkey={hotkey} onClose={() => setOpen(false)} /> : null,
    mount.container,
  )
}

interface OverlayProps extends Omit<IntentBarProps, 'hotkey'> {
  mount: ShadowMount
  hotkey: Hotkey | null
  onClose: () => void
}

/**
 * The open bar: owns the theme step, scroll lock, focus trap, Escape and
 * focus return. Mounted only while open, so each open starts fresh.
 */
function Overlay({ mount, hotkey, onClose, transport, pages = [], tools, navigate, placeholder }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const returnTo = useRef<HTMLElement | null>(null)
  const requestId = useRef(0)
  const [search, setSearch] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'search' })
  const [picking, setPicking] = useState<string | null>(null)

  useLayoutEffect(() => {
    const doc = mount.host.ownerDocument
    if (doc.activeElement !== mount.host) returnTo.current = deepActiveElement(doc) as HTMLElement | null // StrictMode re-runs this with focus already in the bar
    applyTheme(mount.host, readTheme(browserThemeEnv(mount.host)))
    const unlock = lockScroll(doc)
    inputRef.current?.focus()
    return () => {
      unlock()
      returnFocus(returnTo.current, mount.root)
    }
  }, [mount])

  const words = search.trim().split(/\s+/).filter(Boolean)
  const anyPageMatches = pages.some((p) => defaultFilter(p.label, search) > 0)
  const showAsk = words.length >= ASK_MIN_WORDS || (words.length > 0 && !anyPageMatches)

  const onSearch = (value: string) => {
    setSearch(value)
    if (phase.kind !== 'search') {
      requestId.current++
      setPhase({ kind: 'search' })
      setPicking(null)
    }
  }

  const ask = async () => {
    const utterance = search.trim()
    if (!utterance) return
    const id = ++requestId.current
    setPhase({ kind: 'loading' })
    const started = performance.now()
    try {
      const res = await transport({ utterance })
      if (id !== requestId.current) return
      const call = res.calls[0]
      if (res.out_of_scope || !call) setPhase({ kind: 'out_of_scope', reply: res.reply })
      else setPhase({ kind: 'parsed', call, latency: Math.round(performance.now() - started) })
    } catch {
      if (id === requestId.current) setPhase({ kind: 'error' })
    }
  }

  const go = (page: BarPage) => {
    onClose()
    if (navigate) navigate(page.href)
    else window.location.href = page.href
  }

  const closePicker = (arg: string) => {
    chipRefs.current.get(arg)?.focus()
    setPicking(null)
  }

  const pick = (arg: string, value: string) => {
    if (phase.kind === 'parsed') {
      setPhase({ ...phase, call: { ...phase.call, arguments: { ...phase.call.arguments, [arg]: value } } })
    }
    closePicker(arg)
  }

  const onKeyDownCapture = (e: ReactKeyboardEvent) => {
    if (!hotkey || !hasModifier(hotkey) || isComposing(e.nativeEvent)) return
    if (!matchesHotkey(e.nativeEvent, hotkey)) return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isComposing(e.nativeEvent)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const scope = pickerRef.current ?? panelRef.current
      if (scope) cycleFocus(scope, mount.root, e.shiftKey)
    }
  }

  const onMouseDown = (e: ReactMouseEvent) => {
    if (!isFocusable(e.target)) e.preventDefault()
  }

  const onBackdropClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const tool = phase.kind === 'parsed' ? tools?.[phase.call.name] : undefined
  const pickingArg = picking ? tool?.args?.[picking] : undefined

  return (
    <div className="overlay" onKeyDown={stop} onKeyUp={stop} onMouseDown={onMouseDown} onClick={onBackdropClick}>
      <div
        ref={panelRef}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Intent bar"
        onKeyDownCapture={onKeyDownCapture}
        onKeyDown={onKeyDown}
      >
        <CommandRoot label="Intent bar" loop filter={filter} shouldFilter={phase.kind === 'search'}>
          <CommandInput
            ref={inputRef}
            value={search}
            onValueChange={onSearch}
            placeholder={placeholder ?? 'Search, or describe what you want'}
          />
          {phase.kind === 'search' && (
            <CommandList>
              {showAsk && (
                <CommandItem value={ASK} onSelect={ask}>
                  <span className="ask-key">Ask</span>
                  <span>{search.trim()}</span>
                </CommandItem>
              )}
              {pages.length > 0 && (
                <CommandGroup heading="Pages">
                  {pages.map((page) => (
                    <CommandItem key={page.href} value={page.label} onSelect={() => go(page)}>
                      {page.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          )}
        </CommandRoot>

        {phase.kind === 'loading' && <p className="note">Asking the model</p>}
        {phase.kind === 'out_of_scope' && <p className="note">{phase.reply ?? 'That is not something this app can do.'}</p>}
        {phase.kind === 'error' && <p className="note">The model is unavailable right now. Search still works.</p>}
        {phase.kind === 'parsed' && (
          <div className="chips" role="group" aria-label="Parsed request">
            <button type="button" className="chip" data-role="tool">
              {tool?.label ?? phase.call.name}
            </button>
            {Object.entries(phase.call.arguments).map(([name, value]) => {
              const arg = tool?.args?.[name]
              return (
                <button
                  key={name}
                  ref={(el) => {
                    if (el) chipRefs.current.set(name, el)
                    else chipRefs.current.delete(name)
                  }}
                  type="button"
                  className="chip"
                  data-role="match"
                  data-arg={name}
                  aria-haspopup={arg?.enum ? 'listbox' : undefined}
                  aria-expanded={arg?.enum ? picking === name : undefined}
                  onClick={() => arg?.enum && setPicking(name)}
                >
                  <span className="chip-key">{arg?.label ?? name}</span>
                  <span>{String(value)}</span>
                </button>
              )
            })}
          </div>
        )}
        {phase.kind === 'parsed' && picking && pickingArg?.enum && (
          <Picker
            pickerRef={pickerRef}
            label={pickingArg.label ?? picking}
            options={pickingArg.enum}
            current={String(phase.call.arguments[picking] ?? '')}
            onPick={(value) => pick(picking, value)}
            onCancel={() => closePicker(picking)}
          />
        )}

        <footer className="footer">
          <span>
            {phase.kind === 'parsed'
              ? `Parsed in ${phase.latency} ms`
              : phase.kind === 'loading'
                ? 'Model call'
                : 'Instant search, no model call'}
          </span>
          <span>
            <kbd>Tab</kbd> chips, <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  )
}

interface PickerProps {
  pickerRef: RefObject<HTMLDivElement | null>
  label: string
  options: readonly string[]
  current: string
  onPick: (value: string) => void
  onCancel: () => void
}

/**
 * A chip's dropdown: its own `Command`, beside the main one rather than inside
 * it. Escape closes only the dropdown and returns focus to the chip.
 */
function Picker({ pickerRef, label, options, current, onPick, onCancel }: PickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || isComposing(e.nativeEvent)) return
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  }

  return (
    <div ref={pickerRef} className="picker" onKeyDown={onKeyDown}>
      <CommandRoot label={`Choose ${label}`} loop defaultValue={current}>
        <CommandInput ref={inputRef} placeholder={label} />
        <CommandList>
          <CommandEmpty>No match</CommandEmpty>
          {options.map((option) => (
            <CommandItem key={option} value={option} onSelect={() => onPick(option)}>
              {option}
            </CommandItem>
          ))}
        </CommandList>
      </CommandRoot>
    </div>
  )
}
