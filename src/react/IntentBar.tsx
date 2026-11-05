import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { watchAttached } from '../core/attach'
import { formatHotkey, parseHotkey, shouldOpenFromHotkey } from '../core/hotkey'
import { ASK_MIN_WORDS, wordsOf } from '../core/router'
import { createShadowMount, type ShadowMount } from '../core/shadow'
import { applyTheme, browserThemeEnv, readTheme } from '../core/theme'
import { createTransport } from '../core/transport'
import type { BarPage, HostContext, ToolConfig, Transport, ValueResolver } from '../core/types'
import { registerBar, type OpenOptions, type OpenRequest } from './controller'
import { Overlay } from './Overlay'
import { Toast, useRunner } from './Toast'

/** A hotkey with options. */
export interface HotkeyConfig {
  /** Such as `mod+k` or `/`. `mod` is ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: string
  /**
   * Takes the key before the host's own listeners see it, so a host palette
   * bound to the same key stays shut. Off by default, when the bar gives way
   * to a host that already handled the key.
   */
  takeOver?: boolean
}

export interface IntentBarProps {
  /** The project's public id. The bar calls `https://fernfly.com/api/p/<project>`. */
  project?: string
  /** A base URL that takes `/infer` and `/corrections`, such as your own proxy for a project with an API key. */
  endpoint?: string
  /** Replaces the network entirely, for tests and demos. */
  transport?: Transport
  /** How each tool is labelled, previewed and run. */
  tools?: Readonly<Record<string, ToolConfig>>
  /** Lookups for workspace data, per entity name. */
  values?: Readonly<Record<string, ValueResolver>>
  /** The host's context, read when the bar opens and again for each preview and run. */
  context?: () => HostContext
  /** Pages for instant search. Defaults to the links in the page's `<nav>`. */
  pages?: readonly BarPage[]
  /** Goes to a page picked from instant search. Defaults to `location.assign`. */
  navigate?: (href: string) => void
  /** Your app's name, as in "That is not something {appName} can do". */
  appName?: string
  /** The hotkey that opens the bar, or `false` for none. Defaults to `mod+k`. */
  hotkey?: string | false | HotkeyConfig
  /** Your own search field, as a selector or element. Focusing it, or Enter in it, opens the bar with its text. */
  attach?: string | Element | null
  /** Shows a floating button that opens the bar. Off by default. */
  launcher?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: string
}

const NO_TOOLS: Readonly<Record<string, ToolConfig>> = {}

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
 * end of `document.body`. It opens on its hotkey, from `useIntentBar()`, from
 * an attached field, or from its launcher.
 */
export function IntentBar(props: IntentBarProps) {
  const mount = useShadowMount()
  const [innerOpen, setInnerOpen] = useState(props.defaultOpen ?? false)
  const open = props.open ?? innerOpen
  const [request, setRequest] = useState<OpenRequest | null>(null)
  const requestSeq = useRef(0)
  const returningFocusTo = useRef<Element | null>(null)
  const latest = useRef(props)
  latest.current = props
  const isOpen = useRef(open)
  isOpen.current = open

  const setOpen = useCallback((next: boolean) => {
    if (latest.current.open === undefined) setInnerOpen(next)
    latest.current.onOpenChange?.(next)
  }, [])
  const close = useCallback(() => setOpen(false), [setOpen])
  const openBar = useCallback(
    (options?: OpenOptions) => {
      setRequest(options?.query !== undefined || options?.ask ? { ...options, id: ++requestSeq.current } : null)
      setOpen(true)
    },
    [setOpen],
  )

  useEffect(() => {
    if (!open) setRequest(null)
  }, [open])

  useEffect(() => registerBar({ open: openBar, close }), [openBar, close])

  const transport = useMemo(
    () => props.transport ?? createTransport({ project: props.project, endpoint: props.endpoint }),
    [props.transport, props.project, props.endpoint],
  )
  const runner = useRunner(transport)
  const getContext = useCallback((): HostContext => latest.current.context?.() ?? {}, [])
  const navigate = useCallback((href: string) => {
    const nav = latest.current.navigate
    if (nav) nav(href)
    else window.location.assign(href)
  }, [])

  const keys = props.hotkey === false ? null : typeof props.hotkey === 'object' ? props.hotkey.keys : (props.hotkey ?? 'mod+k')
  const takeOver = typeof props.hotkey === 'object' && props.hotkey.takeOver === true
  const hotkey = useMemo(() => (keys === null ? null : parseHotkey(keys)), [keys])

  useEffect(() => {
    if (!hotkey) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldOpenFromHotkey(e, hotkey)) return
      e.preventDefault()
      if (!takeOver) return openBar()
      e.stopPropagation()
      if (isOpen.current) close()
      else openBar()
    }
    window.addEventListener('keydown', onKeyDown, takeOver)
    return () => window.removeEventListener('keydown', onKeyDown, takeOver)
  }, [hotkey, takeOver, openBar, close])

  useEffect(() => {
    if (mount && props.launcher) applyTheme(mount.host, readTheme(browserThemeEnv(mount.host)))
  }, [mount, props.launcher])

  useEffect(() => {
    const target = props.attach
    if (!target) return
    return watchAttached(target, document, (field, trigger) => {
      if (isOpen.current || (trigger === 'focus' && field === returningFocusTo.current)) return
      const query = field.value
      openBar({ query, ask: trigger === 'enter' && wordsOf(query).length >= ASK_MIN_WORDS })
    })
  }, [props.attach, openBar])

  if (!mount) return null
  return createPortal(
    <>
      {open && (
        <Overlay
          mount={mount}
          hotkey={takeOver ? null : hotkey}
          transport={transport}
          pages={props.pages}
          tools={props.tools ?? NO_TOOLS}
          values={props.values}
          getContext={getContext}
          navigate={navigate}
          appName={props.appName ?? 'this app'}
          placeholder={props.placeholder}
          request={request}
          onClose={close}
          onRun={runner.start}
          onReturnFocus={(to) => {
            returningFocusTo.current = to
            setTimeout(() => {
              if (returningFocusTo.current === to) returningFocusTo.current = null
            })
          }}
        />
      )}
      {props.launcher && !open && (
        <button type="button" className="launcher" onClick={() => openBar()}>
          Ask{hotkey && <kbd>{formatHotkey(hotkey)}</kbd>}
        </button>
      )}
      {runner.toast && <Toast toast={runner.toast} onUndo={runner.undo} onDismiss={runner.dismiss} />}
    </>,
    mount.container,
  )
}
