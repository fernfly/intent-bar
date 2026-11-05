/**
 * Turning the user's words into the host's values. The model returns words
 * for workspace data ("priya", "mobile"), and the host's `values` resolvers
 * find them at runtime.
 */
import type { ArgConfig, HostContext, LookupOption, ValueResolver } from './types'

/** Words the model uses for what it can't know: `none` (unassigned) and `current` (this cycle, say). */
export const RESERVED_TOKENS = ['none', 'current'] as const

/** Where one argument's value stands. Only `resolved` lets the call run. */
export type Resolution =
  | { status: 'resolved'; value: unknown; label: string }
  | { status: 'pending' }
  | { status: 'choose'; options: readonly LookupOption[] }
  | { status: 'missing' }
  | { status: 'failed' }

/** The user's choice between a lookup's matches, kept with the words it was made for. */
export interface Pick {
  raw: unknown
  option: LookupOption
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
