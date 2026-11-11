import { useEffect, useRef, useState } from 'react'
import { sameValue, valueLabel } from '../core/call'
import { fromMatches, lookupKey, resolveLocally, type Pick, type Resolution } from '../core/lookup'
import type { Call, HandlerContext, HostContext, Preview, ResolvedArgs, ToolConfig, ValueResolver } from '../core/types'

/** The message of anything thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The host's context, read again on every render, so a value the host loads
 * after the bar opens, such as the current cycle, still resolves. The same
 * object is kept while the host's answer reads the same, so lookups and
 * other effects that depend on it don't rerun.
 */
export function useHostContext(getContext: () => HostContext): HostContext {
  const kept = useRef<HostContext | null>(null)
  const next = getContext()
  if (kept.current === null || !sameValue(kept.current, next)) kept.current = next
  return kept.current
}

/**
 * Where each of the call's arguments stands. Entity arguments are looked up
 * through `values`, once per entity and words while the bar is open, and a
 * pick between matches holds while the words stay the same.
 */
export function useResolutions(
  call: Call | null,
  tool: ToolConfig | undefined,
  values: Readonly<Record<string, ValueResolver>> | undefined,
  context: HostContext,
  picks: Readonly<Record<string, Pick>>,
): Record<string, Resolution> {
  const [found, setFound] = useState<Record<string, Resolution>>({})
  const started = useRef(new Set<string>())

  useEffect(() => {
    for (const [name, value] of Object.entries(call?.arguments ?? {})) {
      const arg = tool?.args?.[name]
      const resolver = arg?.entity ? values?.[arg.entity] : undefined
      if (!arg?.entity || !resolver || resolveLocally(value, arg, values, context, String)) continue
      const key = lookupKey(arg.entity, value)
      if (started.current.has(key)) continue
      started.current.add(key)
      Promise.resolve()
        .then(() => resolver(String(value), { context }))
        .then(
          (matches) => fromMatches(matches, value, (v) => valueLabel(v, arg)),
          (): Resolution => ({ status: 'failed' }),
        )
        .then((resolution) => setFound((f) => ({ ...f, [key]: resolution })))
    }
  }, [call, tool, values, context])

  const out: Record<string, Resolution> = {}
  for (const [name, value] of Object.entries(call?.arguments ?? {})) {
    const arg = tool?.args?.[name]
    const local = resolveLocally(value, arg, values, context, (v) => valueLabel(v, arg))
    const pick = picks[name]
    if (local) out[name] = local
    else if (pick && sameValue(pick.raw, value)) out[name] = { status: 'resolved', value: pick.option.id, label: pick.option.label }
    else out[name] = found[lookupKey(arg?.entity ?? '', value)] ?? { status: 'pending' }
  }
  return out
}

/** Where the preview stands for the current call. */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: Preview }
  | { status: 'failed'; message: string }

/**
 * Runs the tool's `preview` whenever the call or its resolved arguments
 * change, keeping only the latest answer. `args` is null until every
 * argument has resolved, and nothing runs until then.
 */
export function usePreview(
  tool: ToolConfig | undefined,
  call: Call | null,
  args: ResolvedArgs | null,
  handlerContext: () => HandlerContext,
): PreviewState {
  const key = call && args && tool?.preview ? JSON.stringify([call, args]) : null
  const [state, setState] = useState<{ key: string | null; value: PreviewState }>({ key: null, value: { status: 'idle' } })
  const latest = useRef({ tool, args, handlerContext })
  latest.current = { tool, args, handlerContext }

  useEffect(() => {
    if (!key) return
    let live = true
    const { tool: t, args: a, handlerContext: ctx } = latest.current
    Promise.resolve()
      .then(() => t!.preview!(a!, ctx()))
      .then(
        (preview): PreviewState => ({ status: 'ready', preview: preview ?? {} }),
        (err): PreviewState => ({ status: 'failed', message: messageOf(err) }),
      )
      .then((value) => live && setState({ key, value }))
    return () => {
      live = false
    }
  }, [key])

  if (!key) return { status: 'idle' }
  return state.key === key ? state.value : { status: 'loading' }
}
