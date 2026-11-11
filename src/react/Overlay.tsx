import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { CommandGroup, CommandInput, CommandItem, CommandList, CommandRoot } from 'cmdk'
import { examplesFrom, isCorrection, kindOf, needsConfirm, removeArg, setArg, switchTool, valueLabel } from '../core/call'
import { hasModifier, isComposing, matchesHotkey, type Hotkey } from '../core/hotkey'
import { readsWithout, type Pick, type Reads } from '../core/lookup'
import { cycleFocus, deepActiveElement, isFocusable, lockScroll, returnFocus } from '../core/overlay'
import { pagesFromNav, relatedPages, shouldAsk } from '../core/router'
import type { ShadowMount } from '../core/shadow'
import { applyTheme, browserThemeEnv, readTheme } from '../core/theme'
import { failureReason, type FailureReason } from '../core/transport'
import type {
  BarPage,
  Call,
  HandlerContext,
  HostContext,
  LookupOption,
  PreviewAction,
  ResolvedArgs,
  ResultItem,
  RunResult,
  ToolConfig,
  Transport,
  ValueResolver,
} from '../core/types'
import { ChipRow, Editor, TOOL_CHIP, chipKeyFor, labelFilter, type EditorTarget } from './Chips'
import type { OpenRequest } from './controller'
import { useHostContext, usePreview, useResolutions } from './hooks'
import type { RunRequest } from './Toast'

const ASK = '\u0000ask'

/** The main list's filter: the Ask item always scores highest, so it stays pinned first. */
const filter = (value: string, search: string, keywords?: string[]) => (value === ASK ? 1 : labelFilter(value, search, keywords))

const NOTICES: Record<FailureReason, string> = {
  rate_limited: 'Too many requests right now. Search still works.',
  quota_exceeded: 'This app has used up its model requests for today. Search still works.',
  unavailable: 'The model is unavailable right now. Search still works.',
}

const NO_PICKS: Readonly<Record<string, Pick>> = {}

/** Stops a React event here, so it bubbles neither to the host app's React tree nor past the shadow host. */
const stop = (e: SyntheticEvent) => e.stopPropagation()

/** A held Enter must not run what the first press only asked to confirm. */
const ignoreRepeat = (e: ReactKeyboardEvent) => {
  if (e.key === 'Enter' && e.repeat) e.preventDefault()
}

type Phase = 'search' | 'loading' | 'parsed' | 'confirm' | 'results' | 'out_of_scope'

/** The call being shown and edited, with what the model returned for comparison. */
interface Draft {
  utterance: string
  logRef?: string
  /** The model's call. Missing for a call started from a tool in search. */
  model?: Call
  call: Call
  picks: Readonly<Record<string, Pick>>
  latency?: number
}

export interface OverlayProps {
  mount: ShadowMount
  hotkey: Hotkey | null
  transport: Transport
  pages: readonly BarPage[] | undefined
  tools: Readonly<Record<string, ToolConfig>>
  fallbackTool: ((name: string) => ToolConfig | undefined) | undefined
  values: Readonly<Record<string, ValueResolver>> | undefined
  getContext: () => HostContext
  navigate: (href: string) => void
  appName: string
  placeholder?: string
  /** Text to start with, from `open({query})` or an attached field. A new request replaces the text. */
  request: OpenRequest | null
  onClose: () => void
  /** Hands a run to the host. Resolves with its result, or nothing when it failed. */
  onRun: (request: RunRequest) => Promise<RunResult | void>
  /** Called as the bar hands focus back to `to` on close, so focus arriving there isn't mistaken for the user's. */
  onReturnFocus: (to: Element | null) => void
}

/**
 * The open bar: the six states, plus the theme step, scroll lock, focus trap,
 * Escape and focus return. Mounted only while open, so each open starts fresh.
 */
export function Overlay(props: OverlayProps) {
  const { mount, hotkey, transport, tools, fallbackTool, values, getContext, navigate, appName, placeholder, request, onClose, onRun } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const runRef = useRef<HTMLButtonElement>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<(() => HTMLElement | null | undefined) | null>(null)
  const latestProps = useRef(props)
  latestProps.current = props
  const returnTo = useRef<HTMLElement | null>(null)
  const requestId = useRef(0)
  const appliedRequest = useRef(0)
  const [pages] = useState(() => props.pages ?? pagesFromNav(mount.host.ownerDocument))
  const context = useHostContext(getContext)
  const [search, setSearch] = useState(request?.query ?? '')
  const [phase, setPhase] = useState<Phase>('search')
  const [notice, setNotice] = useState<string | null>(null)
  const [asked, setAsked] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [action, setAction] = useState<PreviewAction | null>(null)
  const [applying, setApplying] = useState<Draft | null>(null)
  const [results, setResults] = useState<readonly ResultItem[]>([])
  const [selected, setSelected] = useState('')
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useLayoutEffect(() => {
    const doc = mount.host.ownerDocument
    if (doc.activeElement !== mount.host) returnTo.current = deepActiveElement(doc) as HTMLElement | null // StrictMode re-runs this with focus already in the bar
    applyTheme(mount.host, readTheme(browserThemeEnv(mount.host)))
    const unlock = lockScroll(doc)
    inputRef.current?.focus()
    return () => {
      unlock()
      latestProps.current.onReturnFocus(returnTo.current)
      returnFocus(returnTo.current, mount.root)
    }
  }, [mount])

  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    target?.()?.focus()
  })

  /** Moves focus once the next render has committed, to an element that render may create. */
  const focusLater = (target: () => HTMLElement | null | undefined) => {
    pendingFocus.current = target
  }

  const toolName = draft?.call.name
  const tool = useMemo(() => (toolName === undefined ? undefined : (tools[toolName] ?? fallbackTool?.(toolName))), [toolName, tools, fallbackTool])
  const kind = kindOf(tool)
  const resolutions = useResolutions(draft?.call ?? null, tool, values, context, draft?.picks ?? NO_PICKS)
  const entries = Object.entries(resolutions)
  const resolvedArgs: ResolvedArgs | null =
    draft && entries.every(([, r]) => r.status === 'resolved')
      ? Object.fromEntries(entries.map(([name, r]) => [name, r.status === 'resolved' ? r.value : undefined]))
      : null
  const handlerContext = (): HandlerContext => ({
    call: draft!.call,
    raw: draft!.call.arguments,
    utterance: draft!.utterance,
    context: getContext(),
  })
  const preview = usePreview(tool, draft?.call ?? null, resolvedArgs, handlerContext)
  const ready = preview.status === 'ready' ? preview.preview : undefined

  /** Why the call can't run yet, if it can't. `wait` clears by itself; `stop` needs the user. */
  const blocker = ((): { text: string; tone: 'wait' | 'stop' } | null => {
    if (!draft) return null
    if (applying === draft) return { text: 'Applying filter…', tone: 'wait' }
    if (!tool?.run) return { text: "This app hasn't connected that yet.", tone: 'stop' }
    for (const [name, r] of entries) {
      const label = tool.args?.[name]?.label ?? name
      const raw = draft.call.arguments[name]
      if (r.status === 'choose') return { text: `Choose which ${label} you mean.`, tone: 'stop' }
      if (r.status === 'missing') {
        const text = raw === 'current' ? `There is no current ${label} here.` : `No ${label} matches “${valueLabel(raw, undefined)}”.`
        return { text, tone: 'stop' }
      }
      if (r.status === 'failed') return { text: `Couldn't look up ${label}.`, tone: 'stop' }
    }
    if (entries.some(([, r]) => r.status === 'pending')) return { text: 'Looking up…', tone: 'wait' }
    if (kind === 'action' && preview.status === 'loading') return { text: 'Counting…', tone: 'wait' }
    if (kind === 'action' && preview.status === 'failed') return { text: preview.message, tone: 'stop' }
    return null
  })()

  const ask = async (text: string) => {
    const utterance = text.trim()
    if (!utterance) return
    const id = ++requestId.current
    setPhase('loading')
    setSelected('')
    setNotice(null)
    setEditor(null)
    setDraft(null)
    const started = performance.now()
    try {
      const res = await transport.infer({ utterance, meta: { source: 'intent-bar' } })
      if (id !== requestId.current) return
      const call = res.calls?.[0]
      if (res.out_of_scope || !call) {
        setAsked(utterance)
        setPhase('out_of_scope')
        return
      }
      setDraft({ utterance, logRef: res.log_ref, model: call, call, picks: {}, latency: Math.round(performance.now() - started) })
      setPhase('parsed')
    } catch (err) {
      if (id !== requestId.current) return
      setNotice(NOTICES[failureReason(err)])
      setPhase('search')
    }
  }

  const onSearch = (value: string) => {
    setSearch(value)
    setNotice(null)
    if (phase === 'search') return
    requestId.current++
    setPhase('search')
    setDraft(null)
    setEditor(null)
    setAction(null)
  }

  const startTool = (name: string) => {
    setDraft({ utterance: '', call: { name, arguments: {} }, picks: {} })
    setPhase('parsed')
    setSelected('')
  }

  const go = (page: BarPage) => {
    onClose()
    navigate(page.href)
  }

  useEffect(() => {
    if (!request || request.id === appliedRequest.current) return
    appliedRequest.current = request.id
    const query = request.query ?? ''
    onSearch(query)
    if (request.ask) void ask(query)
  }, [request])

  const askExample = (example: string) => {
    setSearch(example)
    void ask(example)
  }

  const update = (next: (d: Draft) => Draft) => setDraft((d) => (d ? next(d) : d))

  const closeEditor = (chipKey: string) => {
    setEditor(null)
    focusLater(() => chipRefs.current.get(chipKey) ?? chipRefs.current.get(TOOL_CHIP))
  }

  const withoutPick = (picks: Readonly<Record<string, Pick>>, name: string) => {
    const { [name]: _dropped, ...rest } = picks
    return rest
  }

  const onSet = (name: string, value: unknown, option?: LookupOption, reads?: Reads) => {
    update((d) => ({
      ...d,
      call: setArg(d.call, name, value),
      picks: option ? { ...d.picks, [name]: { raw: value, option, reads } } : withoutPick(d.picks, name),
    }))
    closeEditor(name)
  }

  const onPick = (name: string, option: LookupOption) => {
    const shown = resolutions[name]
    const reads = readsWithout(shown?.status === 'choose' ? shown.reads : undefined, name)
    update((d) => ({ ...d, picks: { ...d.picks, [name]: { raw: d.call.arguments[name], option, reads } } }))
    closeEditor(name)
  }

  const onRemove = (name: string) => {
    update((d) => ({ ...d, call: removeArg(d.call, name), picks: withoutPick(d.picks, name) }))
    closeEditor(TOOL_CHIP)
  }

  const onSwitchTool = (name: string) => {
    update((d) => {
      const call = switchTool(d.call, name, tools[name])
      return { ...d, call, picks: Object.fromEntries(Object.entries(d.picks).filter(([arg]) => arg in call.arguments)) }
    })
    closeEditor(TOOL_CHIP)
  }

  const toConfirm = (next: PreviewAction | null) => {
    setAction(next)
    setPhase('confirm')
    setEditor(null)
    focusLater(() => runRef.current)
  }

  /**
   * Hands the call, or a preview action, to the host. The bar closes as the
   * run starts, except for a filter, whose run may answer with rows to list
   * here: the bar waits for it, then lists the rows or closes.
   */
  const execute = (act: PreviewAction | null) => {
    if (!draft || !resolvedArgs || (!act && !tool?.run)) return
    const { call, utterance, logRef, model } = draft
    const args = resolvedArgs
    const run = tool?.run
    const base: HandlerContext = { call, raw: call.arguments, utterance, context: getContext() }
    const request: RunRequest = {
      label: act ? (act.summary ?? act.label) : (ready?.summary ?? tool?.label ?? call.name),
      quiet: !act && kind !== 'action',
      run: async (progress) => (act ? act.run({ ...base, progress }) : run!(args, { ...base, progress })),
      correction: !act && logRef && isCorrection(model, call) ? { log_ref: logRef, call } : null,
    }
    if (act || kind !== 'filter') {
      onClose()
      void onRun(request)
      return
    }
    setApplying(draft)
    focusLater(() => inputRef.current)
    void onRun(request).then((result) => {
      if (!live.current || latestDraft.current !== draft) return
      const items = result?.items
      focusLater(() => inputRef.current)
      // Before the next paint, so a run that answers at once never shows "Applying filter…".
      flushSync(() => {
        if (!items) return onClose()
        setApplying(null)
        setResults(items)
        setPhase('results')
        setEditor(null)
      })
    })
  }

  const primary = () => {
    if (!draft || blocker) return
    if (needsConfirm(tool, ready)) toConfirm(null)
    else execute(null)
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
      if (phase !== 'confirm') return onClose()
      setPhase('parsed')
      setAction(null)
      focusLater(() => inputRef.current)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const scope = editorRef.current ?? panelRef.current
      if (scope) cycleFocus(scope, mount.root, e.shiftKey)
    } else if (e.key === 'Enter' && phase === 'parsed' && e.target === inputRef.current) {
      e.preventDefault()
      primary()
    }
  }

  const onMouseDown = (e: ReactMouseEvent) => {
    if (!isFocusable(e.target)) e.preventDefault()
  }

  const onBackdropClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const examples = examplesFrom(tools)
  const commands = Object.entries(tools).filter(([, t]) => t.label)
  const anythingMatches = [...pages.map((p) => p.label), ...commands.map(([, t]) => t.label!)].some(
    (label) => labelFilter('', search, [label]) > 0,
  )
  const showAsk = shouldAsk(search, anythingMatches)
  const related = phase === 'out_of_scope' ? relatedPages(asked, pages) : []

  const pageItems = (list: readonly BarPage[]) =>
    list.map((page) => (
      <CommandItem key={page.href} value={`page:${page.href}`} keywords={[page.label]} onSelect={() => go(page)}>
        {page.label}
      </CommandItem>
    ))
  const exampleItems = examples.map((example, i) => (
    <CommandItem key={i} value={`example:${i}`} keywords={[example]} onSelect={() => askExample(example)}>
      {example}
    </CommandItem>
  ))

  const runLabel = ready?.confirmLabel ?? 'Run'
  const primaryLabel = kind === 'filter' ? 'Apply filter' : kind === 'navigate' ? 'Go' : needsConfirm(tool, ready) ? `${runLabel}…` : runLabel
  const resultLine =
    blocker?.text ??
    (preview.status === 'loading' ? 'Counting…' : preview.status === 'failed' ? preview.message : (ready?.summary ?? (ready?.count !== undefined ? `${ready.count} found` : '')))

  const confirmTitle = action ? (action.summary ?? action.label) : (ready?.summary ?? `Run ${tool?.label ?? draft?.call.name}?`)
  const sample = action ? [] : (ready?.sample ?? [])
  const more = !action && ready?.count !== undefined ? ready.count - sample.length : 0
  const undoable = action ? action.undoable : ready?.undoable

  const footer =
    phase === 'search'
      ? 'Instant search, no model call'
      : phase === 'loading'
        ? 'Model call'
        : phase === 'out_of_scope'
          ? 'Saved for review'
          : draft?.latency !== undefined
            ? `Parsed in ${draft.latency} ms`
            : 'No model call'

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
        {/* cmdk keeps the value of an item that has gone, so past search the selection is held here, cleared before each new list. */}
        <CommandRoot
          label="Intent bar"
          loop
          filter={filter}
          shouldFilter={phase === 'search'}
          value={phase === 'search' ? undefined : selected}
          onValueChange={setSelected}
        >
          <CommandInput
            ref={inputRef}
            value={search}
            onValueChange={onSearch}
            placeholder={placeholder ?? 'Search, or describe what you want'}
          />
          {phase === 'search' && notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {phase === 'search' && (
            <CommandList>
              {showAsk && (
                <CommandItem value={ASK} onSelect={() => ask(search)}>
                  <span className="ask-key">Ask</span>
                  <span>{search.trim()}</span>
                </CommandItem>
              )}
              {!search.trim() && examples.length > 0 && <CommandGroup heading="Try">{exampleItems}</CommandGroup>}
              {search.trim() && commands.length > 0 && (
                <CommandGroup heading="Commands">
                  {commands.map(([name, t]) => (
                    <CommandItem key={name} value={`tool:${name}`} keywords={[t.label!]} onSelect={() => startTool(name)}>
                      {t.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {pages.length > 0 && <CommandGroup heading="Pages">{pageItems(pages)}</CommandGroup>}
            </CommandList>
          )}
          {phase === 'results' &&
            (results.length > 0 ? (
              <CommandList label="Results">
                <CommandGroup heading={ready?.summary ?? `${results.length} found`}>
                  {results.map((item, i) => (
                    <CommandItem key={i} value={`result:${i}`} keywords={[item.label]} onSelect={() => go(item)}>
                      <span>{item.label}</span>
                      {item.detail && <span className="item-detail">{item.detail}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            ) : (
              <p className="note">Nothing matches.</p>
            ))}
          {phase === 'out_of_scope' && (
            <>
              <p className="note">That is not something {appName} can do.</p>
              {(related.length > 0 || examples.length > 0) && (
                <CommandList>
                  {related.length > 0 && <CommandGroup heading="Pages">{pageItems(related)}</CommandGroup>}
                  {examples.length > 0 && <CommandGroup heading="Try">{exampleItems}</CommandGroup>}
                </CommandList>
              )}
            </>
          )}
        </CommandRoot>

        {phase === 'loading' && <p className="note">Asking the model…</p>}

        {phase === 'parsed' && draft && (
          <>
            <ChipRow
              call={draft.call}
              tool={tool}
              resolutions={resolutions}
              editor={editor}
              chipRef={(key) => (el) => {
                if (el) chipRefs.current.set(key, el)
                else chipRefs.current.delete(key)
              }}
              onOpen={(target) => setEditor(editor && chipKeyFor(editor) === chipKeyFor(target) ? null : target)}
            />
            {editor && (
              <Editor
                key={JSON.stringify(editor)}
                target={editor}
                call={draft.call}
                tool={tool}
                tools={tools}
                resolution={editor.kind === 'arg' ? resolutions[editor.name] : undefined}
                values={values}
                context={context}
                editorRef={editorRef}
                onSet={onSet}
                onPick={onPick}
                onRemove={onRemove}
                onSwitchTool={onSwitchTool}
                onAdd={(name) => setEditor({ kind: 'arg', name, adding: true })}
                onCancel={() => closeEditor(chipKeyFor(editor))}
              />
            )}
            <div className="result">
              <p className="result-line" data-tone={blocker?.tone}>
                {resultLine}
              </p>
              <div className="result-actions">
                {ready?.actions?.map((a, i) => (
                  <button key={i} type="button" disabled={!!blocker} onClick={() => toConfirm(a)}>
                    {a.label}
                  </button>
                ))}
                <button type="button" className="primary" disabled={!!blocker} onClick={primary}>
                  {primaryLabel} <kbd>↵</kbd>
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'confirm' && draft && (
          <div className="confirm">
            <p className="confirm-title">{confirmTitle}</p>
            {sample.length > 0 && (
              <ul className="sample">
                {sample.map((row, i) => (
                  <li key={i}>{row}</li>
                ))}
              </ul>
            )}
            {more > 0 && <p className="note">and {more} more</p>}
            {undoable && <p className="note">You can undo this afterwards.</p>}
            <div className="result-actions">
              <button
                type="button"
                onClick={() => {
                  setPhase('parsed')
                  setAction(null)
                  focusLater(() => inputRef.current)
                }}
              >
                Cancel
              </button>
              <button ref={runRef} type="button" className="primary" onKeyDown={ignoreRepeat} onClick={() => execute(action)}>
                {action ? action.label : runLabel}
              </button>
            </div>
          </div>
        )}

        <footer className="footer">
          <span>{footer}</span>
          <span>
            {phase === 'parsed' && (
              <>
                <kbd>Tab</kbd> chips,{' '}
              </>
            )}
            {phase === 'results' && results.length > 0 && (
              <>
                <kbd>↵</kbd> open,{' '}
              </>
            )}
            <kbd>Esc</kbd> {phase === 'confirm' ? 'back' : 'close'}
          </span>
        </footer>
      </div>
    </div>
  )
}
