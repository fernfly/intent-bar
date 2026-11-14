import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { CommandEmpty, CommandInput, CommandItem, CommandList, CommandRoot, defaultFilter } from 'cmdk'
import { coerce, missingArgs, optionsFor, typeOf, valueLabel } from '../core/call'
import { isComposing } from '../core/hotkey'
import { watchReads, type Reads, type Resolution } from '../core/lookup'
import type { ArgConfig, Call, HostContext, LookupOption, ToolConfig, ValueResolver } from '../core/types'

/** Which editor is open: the tool chip's, "+ add", or one argument's. `adding` is set for an argument "+ add" picked. */
export type EditorTarget = { kind: 'tool' } | { kind: 'add' } | { kind: 'arg'; name: string; adding?: boolean }

/** Ref keys for the chips that aren't arguments. */
export const TOOL_CHIP = '\u0000tool'
export const ADD_CHIP = '\u0000add'

/** The chip key an editor returns focus to when it closes. */
export function chipKeyFor(target: EditorTarget): string {
  if (target.kind === 'tool') return TOOL_CHIP
  if (target.kind === 'add' || target.adding) return ADD_CHIP
  return target.name
}

/** cmdk's filter over an item's label, kept in `keywords`, rather than its value, which is an id. */
export const labelFilter = (value: string, search: string, keywords?: string[]) => defaultFilter(keywords?.[0] ?? value, search)

const FLAGS: Partial<Record<Resolution['status'], string>> = {
  pending: 'looking up',
  choose: 'choose',
  missing: 'no match',
  failed: 'lookup failed',
}

interface ChipRowProps {
  call: Call
  tool: ToolConfig | undefined
  resolutions: Record<string, Resolution>
  editor: EditorTarget | null
  chipRef: (key: string) => (el: HTMLButtonElement | null) => void
  onOpen: (target: EditorTarget) => void
}

/**
 * The parsed call as chips: the tool, then one chip per argument, then
 * "+ add" when the tool names arguments the call lacks. A `match` chip is
 * tinted and a `set` chip outlined.
 */
export function ChipRow({ call, tool, resolutions, editor, chipRef, onOpen }: ChipRowProps) {
  const open = (target: EditorTarget) => () => onOpen(target)
  return (
    <div className="chips" role="group" aria-label="Your request">
      <button
        ref={chipRef(TOOL_CHIP)}
        type="button"
        className="chip"
        data-role="tool"
        aria-haspopup="listbox"
        aria-expanded={editor?.kind === 'tool'}
        onClick={open({ kind: 'tool' })}
      >
        {tool?.label ?? call.name}
      </button>
      {Object.entries(call.arguments).map(([name, value]) => {
        const arg = tool?.args?.[name]
        const resolution = resolutions[name]
        const status = resolution?.status ?? 'resolved'
        const flag = FLAGS[status]
        return (
          <button
            key={name}
            ref={chipRef(name)}
            type="button"
            className="chip"
            data-role={arg?.role ?? 'match'}
            data-arg={name}
            data-status={status}
            aria-haspopup="dialog"
            aria-expanded={editor?.kind === 'arg' && editor.name === name}
            onClick={open({ kind: 'arg', name })}
          >
            <span className="chip-key">{arg?.label ?? name}</span>
            <span>{resolution?.status === 'resolved' ? resolution.label : valueLabel(value, arg)}</span>
            {flag && <span className="chip-flag">{flag}</span>}
          </button>
        )
      })}
      {missingArgs(call, tool).length > 0 && (
        <button
          ref={chipRef(ADD_CHIP)}
          type="button"
          className="chip"
          data-role="add"
          aria-haspopup="listbox"
          aria-expanded={editor?.kind === 'add'}
          onClick={open({ kind: 'add' })}
        >
          + add
        </button>
      )}
    </div>
  )
}

interface EditorProps {
  target: EditorTarget
  call: Call
  tool: ToolConfig | undefined
  tools: Readonly<Record<string, ToolConfig>>
  resolution: Resolution | undefined
  values: Readonly<Record<string, ValueResolver>> | undefined
  context: HostContext
  editorRef: RefObject<HTMLDivElement | null>
  /** Sets a value. `option` and `reads` come with a value picked from a search: the pick, and what that search read. */
  onSet: (name: string, value: unknown, option?: LookupOption, reads?: Reads) => void
  onPick: (name: string, option: LookupOption) => void
  onRemove: (name: string) => void
  onSwitchTool: (name: string) => void
  onAdd: (name: string) => void
  onCancel: () => void
}

/**
 * The open chip's editor, beside the chips rather than inside the main
 * `Command`. The tool chip lists the other tools, "+ add" lists the missing
 * arguments, and an argument offers its options, a lookup or a text field,
 * plus remove.
 */
export function Editor(props: EditorProps) {
  const { target, call, tool, tools, editorRef, onCancel } = props
  if (target.kind === 'tool') {
    const items = Object.entries(tools).map(([name, t]) => ({ key: `tool:${name}`, label: t.label ?? name, onSelect: () => props.onSwitchTool(name) }))
    return <ListEditor label="tool" items={items} current={`tool:${call.name}`} editorRef={editorRef} onCancel={onCancel} />
  }
  if (target.kind === 'add') {
    const items = missingArgs(call, tool).map((name) => ({ key: `arg:${name}`, label: tool?.args?.[name]?.label ?? name, onSelect: () => props.onAdd(name) }))
    return <ListEditor label="argument to add" items={items} editorRef={editorRef} onCancel={onCancel} />
  }

  const { name, adding } = target
  const arg = tool?.args?.[name]
  const value = call.arguments[name]
  const label = arg?.label ?? name
  const remove = adding ? [] : [{ key: 'remove', label: `Remove ${label}`, danger: true, onSelect: () => props.onRemove(name) }]
  const options = optionsFor(arg, value)
  if (options) {
    const items = options.map((option) => ({ key: `opt:${JSON.stringify(option)}`, label: valueLabel(option, arg), onSelect: () => props.onSet(name, option) }))
    return <ListEditor label={label} items={[...items, ...remove]} current={`opt:${JSON.stringify(value)}`} editorRef={editorRef} onCancel={onCancel} />
  }
  const resolver = arg?.entity ? props.values?.[arg.entity] : undefined
  if (resolver) return <LookupEditor {...props} name={name} label={label} resolver={resolver} remove={remove} />
  return <TextEditor name={name} label={label} arg={arg} value={value} adding={!!adding} editorRef={editorRef} onSet={props.onSet} onRemove={props.onRemove} onCancel={onCancel} />
}

interface Item {
  key: string
  label: string
  detail?: string
  danger?: boolean
  onSelect: () => void
}

/** A keydown handler that closes the editor on Escape, without letting the bar close too. */
function escapeTo(onCancel: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || isComposing(e.nativeEvent)) return
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  }
}

/** Focuses an editor's input when it opens. */
function useAutoFocus<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)
  useLayoutEffect(() => ref.current?.focus(), [])
  return ref
}

interface ListEditorProps {
  label: string
  items: readonly Item[]
  current?: string
  editorRef: RefObject<HTMLDivElement | null>
  onCancel: () => void
  shouldFilter?: boolean
  search?: string
  onSearch?: (search: string) => void
  note?: ReactNode
}

/** A list to choose from, as its own `Command`. */
function ListEditor({ label, items, current, editorRef, onCancel, shouldFilter = true, search, onSearch, note }: ListEditorProps) {
  const inputRef = useAutoFocus<HTMLInputElement>()
  return (
    <div ref={editorRef} className="picker" onKeyDown={escapeTo(onCancel)}>
      <CommandRoot label={`Choose ${label}`} loop defaultValue={current} filter={labelFilter} shouldFilter={shouldFilter}>
        <CommandInput ref={inputRef} placeholder={label} value={search} onValueChange={onSearch} />
        <CommandList>
          {note ?? <CommandEmpty>No match</CommandEmpty>}
          {items.map((item) => (
            <CommandItem key={item.key} value={item.key} keywords={[item.label]} onSelect={item.onSelect} data-danger={item.danger || undefined}>
              <span>{item.label}</span>
              {item.detail && <span className="item-detail">{item.detail}</span>}
            </CommandItem>
          ))}
        </CommandList>
      </CommandRoot>
    </div>
  )
}

/**
 * An entity argument's editor. It first lists the matches the model's words
 * found, and a pick among those keeps the words. Typing searches the host's
 * values instead, and a pick from that search replaces the words.
 */
function LookupEditor(props: EditorProps & { name: string; label: string; resolver: ValueResolver; remove: Item[] }) {
  const { name, label, resolver, resolution, context, remove } = props
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; options: readonly LookupOption[]; reads: Reads } | null>(null)
  const matches = resolution?.status === 'choose' ? resolution.options : []
  const q = query.trim()
  const latest = useRef({ resolver, call: props.call, tool: props.tool })
  latest.current = { resolver, call: props.call, tool: props.tool }

  useEffect(() => {
    if (!q) return
    let live = true
    const timer = setTimeout(() => {
      const { resolver: find, call, tool } = latest.current
      const watched = watchReads(call, Object.keys(tool?.args ?? {}))
      Promise.resolve()
        .then(() => find(q, { context, call: watched.call }))
        .then((options) => options ?? [])
        .catch((): readonly LookupOption[] => [])
        .then((options) => live && setResults({ query: q, options, reads: watched.reads(name) }))
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, context, name])

  const searching = q !== '' && results?.query !== q
  const options = q ? (searching ? [] : (results?.options ?? [])) : matches
  const items: Item[] = options.map((option) => ({
    key: `id:${option.id}`,
    label: option.label,
    detail: option.detail,
    onSelect: () => (matches.some((m) => m.id === option.id) ? props.onPick(name, option) : props.onSet(name, option.label, option, results?.reads)),
  }))
  const note = searching ? <p className="picker-note">Looking up</p> : q || matches.length ? undefined : <p className="picker-note">Type to search {label}</p>
  return (
    <ListEditor
      label={label}
      items={[...items, ...remove]}
      editorRef={props.editorRef}
      onCancel={props.onCancel}
      shouldFilter={false}
      search={query}
      onSearch={setQuery}
      note={note}
    />
  )
}

interface TextEditorProps {
  name: string
  label: string
  arg: ArgConfig | undefined
  value: unknown
  adding: boolean
  editorRef: RefObject<HTMLDivElement | null>
  onSet: (name: string, value: unknown) => void
  onRemove: (name: string) => void
  onCancel: () => void
}

const EXPECTED: Record<NonNullable<ArgConfig['type']>, string> = {
  string: 'Enter a value',
  number: 'Enter a number',
  integer: 'Enter a whole number',
  boolean: 'Enter yes or no',
}

/** A free-text argument's editor: a field converted to the argument's type on save. */
function TextEditor({ name, label, arg, value, adding, editorRef, onSet, onRemove, onCancel }: TextEditorProps) {
  const inputRef = useAutoFocus<HTMLInputElement>()
  const [text, setText] = useState(value === undefined || value === null ? '' : valueLabel(value, undefined))
  const [invalid, setInvalid] = useState(false)
  const type = typeOf(arg, value)

  const save = () => {
    const next = coerce(text, type)
    if (next === undefined) setInvalid(true)
    else onSet(name, next)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' || isComposing(e.nativeEvent)) return
    e.preventDefault()
    save()
  }

  return (
    <div ref={editorRef} className="picker" onKeyDown={escapeTo(onCancel)}>
      <input
        ref={inputRef}
        className="picker-field"
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={onKeyDown}
      />
      {invalid && <p className="picker-note">{EXPECTED[type]}</p>}
      <div className="picker-actions">
        <button type="button" onClick={save}>
          Save
        </button>
        {!adding && (
          <button type="button" data-danger onClick={() => onRemove(name)}>
            Remove {label}
          </button>
        )}
      </div>
    </div>
  )
}
