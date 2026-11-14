/**
 * The call the chips show, in model space. Every edit returns a new call, so
 * the model's own call stays as it came back and can be compared with the
 * one the user runs.
 */
import type { ArgConfig, Call, Preview, ToolConfig, ToolKind } from './types'

/** A tool's kind. A tool with no kind is an action, so it confirms. */
export function kindOf(tool: ToolConfig | undefined): ToolKind {
  return tool?.kind ?? 'action'
}

/**
 * Whether running the call needs the confirm step. Filters and navigation
 * never do. An action always does, unless its config turns confirm off and
 * the preview counts at most one item: confirm can't be skipped for bulk work.
 */
export function needsConfirm(tool: ToolConfig | undefined, preview: Preview | undefined): boolean {
  const kind = kindOf(tool)
  if (kind === 'filter' || kind === 'navigate') return false
  const singleItem = typeof preview?.count === 'number' && preview.count <= 1
  return !(tool?.confirm === false && singleItem)
}

/** How long a navigation counts down before it runs by itself, unless its config says otherwise. */
export const AUTO_RUN_SECONDS = 3

/**
 * Whole seconds before the model's call runs by itself, or false when it waits
 * for Enter. A navigation counts down `AUTO_RUN_SECONDS` unless its config
 * says otherwise, a filter only when its config gives a number, and an action
 * never, since it confirms.
 */
export function autoRunSeconds(tool: ToolConfig | undefined): number | false {
  const kind = kindOf(tool)
  if (kind === 'action') return false
  const seconds = tool?.autoRun ?? (kind === 'navigate' ? AUTO_RUN_SECONDS : false)
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return false
  return Math.max(1, Math.ceil(seconds))
}

/** The call with one argument set. */
export function setArg(call: Call, name: string, value: unknown): Call {
  return { name: call.name, arguments: { ...call.arguments, [name]: value } }
}

/** The call without one argument. */
export function removeArg(call: Call, name: string): Call {
  const { [name]: _removed, ...rest } = call.arguments
  return { name: call.name, arguments: rest }
}

/** The call switched to another tool, keeping only the arguments the new tool also names. */
export function switchTool(call: Call, name: string, tool: ToolConfig | undefined): Call {
  const known = tool?.args ?? {}
  const kept = Object.entries(call.arguments).filter(([arg]) => Object.hasOwn(known, arg))
  return { name, arguments: Object.fromEntries(kept) }
}

/** The arguments the tool's config names that the call doesn't have yet, for "+ add". */
export function missingArgs(call: Call, tool: ToolConfig | undefined): string[] {
  return Object.keys(tool?.args ?? {}).filter((name) => call.arguments[name] === undefined)
}

/** Deep equality for JSON values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && sameValue(x[k], y[k]))
}

/**
 * Whether the call the user runs differs from the model's, which makes it a
 * correction: a changed value, an added or removed argument, or a switched
 * tool. A call with no model behind it, such as one started from a tool in
 * search, never is.
 */
export function isCorrection(model: Call | undefined, edited: Call): boolean {
  if (!model) return false
  if (model.name !== edited.name) return true
  const defined = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
  return !sameValue(defined(model.arguments), defined(edited.arguments))
}

/** The type an edited value is converted to: the config's, else the model's value's, else text. */
export function typeOf(arg: ArgConfig | undefined, current: unknown): NonNullable<ArgConfig['type']> {
  if (arg?.type) return arg.type
  if (typeof current === 'number') return Number.isInteger(current) ? 'integer' : 'number'
  if (typeof current === 'boolean') return 'boolean'
  return 'string'
}

/** Converts typed text to an argument's type. `undefined` means the text doesn't fit it. */
export function coerce(text: string, type: NonNullable<ArgConfig['type']>): unknown {
  const t = text.trim()
  if (!t) return undefined
  if (type === 'string') return t
  if (type === 'boolean') {
    if (/^(true|yes)$/i.test(t)) return true
    if (/^(false|no)$/i.test(t)) return false
    return undefined
  }
  const n = Number(t)
  if (!Number.isFinite(n) || (type === 'integer' && !Number.isInteger(n))) return undefined
  return n
}

/** The values an argument offers as a list: its enum, or yes and no for a boolean. Null for anything else. */
export function optionsFor(arg: ArgConfig | undefined, current: unknown): readonly unknown[] | null {
  if (arg?.enum) return arg.enum
  if (typeOf(arg, current) === 'boolean') return [true, false]
  return null
}

/** How a value reads on a chip. */
export function valueLabel(value: unknown, arg: ArgConfig | undefined): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.map((v) => valueLabel(v, arg)).join(', ')
  if (typeof value === 'string') return arg?.optionLabels?.[value] ?? value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Up to `max` example sentences, taking each tool's first example before any tool's second. */
export function examplesFrom(tools: Readonly<Record<string, ToolConfig>> | undefined, max = 3): string[] {
  const lists = Object.values(tools ?? {}).map((t) => t.examples ?? [])
  const out: string[] = []
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const example = list[i]
      if (example !== undefined && out.length < max) out.push(example)
    }
  }
  return out
}
