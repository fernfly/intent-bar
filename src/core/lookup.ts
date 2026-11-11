/**
 * Turning the user's words into the host's values. The model returns words
 * for workspace data ("priya", "mobile"), and the host's `values` resolvers
 * find them at runtime.
 */
import { sameValue } from './call'
import type { ArgConfig, Call, HostContext, LookupOption, ValueResolver } from './types'

/** Words the model uses for what it can't know: `none` (unassigned) and `current` (this cycle, say). */
export const RESERVED_TOKENS = ['none', 'current'] as const

/** What a lookup read of the call, with the values it saw: the call its answer holds for. */
export interface Reads {
  /** The tool's name, when the lookup read it. */
  name?: string
  /** The arguments it read, by name. An argument the call lacked reads as `undefined`. */
  args: Readonly<Record<string, unknown>>
}

/** Where one argument's value stands. Only `resolved` lets the call run. A choice keeps what its lookup read. */
export type Resolution =
  | { status: 'resolved'; value: unknown; label: string }
  | { status: 'pending' }
  | { status: 'choose'; options: readonly LookupOption[]; reads?: Reads }
  | { status: 'missing' }
  | { status: 'failed' }

/** The user's choice of a value, kept with the words it was made for and what the lookup that offered it read. */
export interface Pick {
  raw: unknown
  option: LookupOption
  reads?: Reads
}

/**
 * The call as a lookup sees it: the same name and arguments, read-only,
 * recording which of them the lookup reads. `known` adds the arguments the
 * tool names that the call lacks, so reading one of those counts too.
 * `reads(skip)` lists what was read so far, leaving out `skip`, usually the
 * argument being looked up.
 */
export function watchReads(call: Call, known: Iterable<string> = []): { call: Call; reads(skip?: string): Reads } {
  const seen = new Set<string>()
  let sawName = false
  const args = {}
  for (const name of new Set([...Object.keys(call.arguments), ...known])) {
    Object.defineProperty(args, name, {
      enumerable: Object.hasOwn(call.arguments, name),
      get: () => {
        seen.add(name)
        return call.arguments[name]
      },
    })
  }
  const watched = Object.defineProperties({} as Call, {
    name: {
      enumerable: true,
      get: () => {
        sawName = true
        return call.name
      },
    },
    arguments: { enumerable: true, value: Object.freeze(args) },
  })
  const reads = (skip?: string): Reads => ({
    ...(sawName && { name: call.name }),
    args: Object.fromEntries([...seen].filter((name) => name !== skip).map((name) => [name, call.arguments[name]])),
  })
  return { call: watched, reads }
}

/** Whether the call still has the values a lookup read. Nothing read always holds. */
export function readsHold(reads: Reads | undefined, call: Call): boolean {
  if (!reads) return true
  if (reads.name !== undefined && reads.name !== call.name) return false
  return Object.entries(reads.args).every(([name, value]) => sameValue(call.arguments[name], value))
}

/** What a lookup read, without one argument: a choice of that argument's value doesn't depend on its own words. */
export function readsWithout(reads: Reads | undefined, name: string): Reads | undefined {
  if (!reads) return undefined
  const { [name]: _own, ...args } = reads.args
  return { ...reads, args }
}

/**
 * Resolves a value without a lookup when it can: anything that isn't an
 * entity, the reserved tokens, and an entity the host gave no resolver for,
 * which passes the words through for the host to handle. Null means a
 * lookup is needed.
 */
export function resolveLocally(
  value: unknown,
  arg: ArgConfig | undefined,
  values: Readonly<Record<string, ValueResolver>> | undefined,
  context: HostContext,
  label: (value: unknown) => string,
): Resolution | null {
  const entity = arg?.entity
  if (!entity) return { status: 'resolved', value, label: label(value) }
  if (value === 'none' || value === null) return { status: 'resolved', value: null, label: label('none') }
  if (value === 'current') {
    const current = context.current?.[entity]
    return current ? { status: 'resolved', value: current.id, label: current.label } : { status: 'missing' }
  }
  if (!values?.[entity]) return { status: 'resolved', value, label: label(value) }
  return null
}

/** One match resolves, several ask the user to choose, none blocks the run. A declined lookup (`null`) passes the words through. */
export function fromMatches(matches: readonly LookupOption[] | null | undefined, value: unknown, label: (value: unknown) => string): Resolution {
  if (matches == null) return { status: 'resolved', value, label: label(value) }
  const [only] = matches
  if (matches.length === 1 && only) return { status: 'resolved', value: only.id, label: only.label }
  return matches.length === 0 ? { status: 'missing' } : { status: 'choose', options: matches }
}

/** The cache key for one lookup: the same words for the same entity resolve once per open. */
export function lookupKey(entity: string, value: unknown): string {
  return `${entity}\u0000${JSON.stringify(value)}`
}
