/**
 * The script tag's event contract. A tool or lookup the host gave no
 * function for is asked through an event on `window` instead, and the
 * host answers with `event.detail.respondWith(value or promise)`, the way a
 * service worker answers a `FetchEvent`.
 */
import type { Call, HostContext, LookupOption, Preview, ResolvedArgs, RunResult, ToolConfig, ValueResolver } from './types'

/** The event names, by what they ask for. */
export const EVENT_NAMES = {
  preview: 'fernfly:preview',
  run: 'fernfly:run',
  values: 'fernfly:values',
} as const

/** What every request event carries: the way to answer it. */
export interface RespondableDetail<T> {
  /** Answers the event. Call it during the listener, once, with a value or a promise of one. */
  respondWith(response: T | PromiseLike<T>): void
}

/** `fernfly:preview`: what the call would touch. */
export interface PreviewEventDetail extends RespondableDetail<Preview | undefined> {
  tool: string
  args: ResolvedArgs
  call: Call
  raw: Record<string, unknown>
  utterance: string
  context: HostContext
}

/** `fernfly:run`: run the call. `progress(done, total)` reports on a long run. */
export interface RunEventDetail extends RespondableDetail<RunResult | void> {
  tool: string
  args: ResolvedArgs
  call: Call
  raw: Record<string, unknown>
  utterance: string
  context: HostContext
  progress(done: number, total?: number): void
}

/** `fernfly:values`: workspace values for the user's words. */
export interface ValuesEventDetail extends RespondableDetail<readonly LookupOption[] | null> {
  entity: string
  query: string
  context: HostContext
  /** The call as it stands, in the user's words. Reading another argument runs the lookup again when that argument changes. */
  call: Call
}

declare global {
  interface WindowEventMap {
    'fernfly:preview': CustomEvent<PreviewEventDetail>
    'fernfly:run': CustomEvent<RunEventDetail>
    'fernfly:values': CustomEvent<ValuesEventDetail>
  }
}

/** A run of a tool nothing in the host handles. */
export class NotConnectedError extends Error {
  constructor() {
    super("This app hasn't connected that yet.")
    this.name = 'NotConnectedError'
  }
}

/**
 * Dispatches one request event and returns the host's answer, or null when
 * no listener called `respondWith` during dispatch. Calling it later, or
 * twice, throws in the listener.
 */
export function request<T>(target: EventTarget, type: string, detail: object): Promise<T> | null {
  let response: Promise<T> | null = null
  let dispatching = true
  const respondWith = (value: T | PromiseLike<T>) => {
    if (!dispatching) throw new Error(`respondWith() must be called while the ${type} event is dispatched`)
    if (response) throw new Error(`respondWith() was already called for this ${type} event`)
    response = Promise.resolve(value)
  }
  target.dispatchEvent(new CustomEvent(type, { detail: { ...detail, respondWith } }))
  dispatching = false
  return response as Promise<T> | null
}

/**
 * The tool with a `preview` and a `run` that ask the host through events,
 * wherever the config has no function of its own. An unanswered preview
 * means no preview, and an unanswered run fails as not connected.
 */
export function withEvents(name: string, tool: ToolConfig | undefined, target: EventTarget): ToolConfig {
  return {
    ...tool,
    preview:
      tool?.preview ?? ((args, ctx) => request<Preview | undefined>(target, EVENT_NAMES.preview, { tool: name, args, ...ctx }) ?? undefined),
    run:
      tool?.run ??
      ((args, ctx) => {
        const answer = request<RunResult | void>(target, EVENT_NAMES.run, { tool: name, args, ...ctx })
        if (!answer) throw new NotConnectedError()
        return answer
      }),
  }
}

/** A lookup that asks the host through `fernfly:values`. Unanswered, it declines, and the words pass through. */
export function eventValues(entity: string, target: EventTarget): ValueResolver {
  return (query, { context, call }) => request<readonly LookupOption[] | null>(target, EVENT_NAMES.values, { entity, query, context, call })
}

/** Every entity the tools' arguments name. */
export function entitiesOf(tools: Readonly<Record<string, ToolConfig>> | undefined): string[] {
  const names = Object.values(tools ?? {}).flatMap((t) => Object.values(t.args ?? {}).map((a) => a.entity))
  return [...new Set(names.filter((n): n is string => !!n))]
}
