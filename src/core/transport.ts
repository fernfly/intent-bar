import type { Call, InferResponse, Transport } from './types'

/** Where a project's public endpoints live when no `endpoint` is given. */
export const FERNFLY_ORIGIN = 'https://fernfly.com'

/** Why a request failed, as far as the bar's notice cares. */
export type FailureReason = 'rate_limited' | 'quota_exceeded' | 'unavailable'

/** A failed request to Fernfly. `status` is the HTTP status, when there was a response. */
export class TransportError extends Error {
  readonly reason: FailureReason
  readonly status?: number

  constructor(reason: FailureReason, status?: number, message?: string) {
    super(message ?? reason)
    this.name = 'TransportError'
    this.reason = reason
    this.status = status
  }
}

/** Options for the default transport. One of `project` and `endpoint` is required. */
export interface TransportOptions {
  /** The project's public id. Requests go to `https://fernfly.com/api/p/<project>`. */
  project?: string
  /** A base URL that takes `/infer` and `/corrections`, such as the host's own proxy for a project with an API key. */
  endpoint?: string
  /** Replaces the global `fetch`. */
  fetch?: typeof fetch
}

/**
 * The reason behind a failure, read by shape rather than class so a custom
 * transport, or another copy of this package, can report it too.
 */
export function failureReason(error: unknown): FailureReason {
  const reason = (error as { reason?: unknown } | null)?.reason
  return reason === 'rate_limited' || reason === 'quota_exceeded' ? reason : 'unavailable'
}

/** The failure a non-2xx response stands for. A 429 names its cause in the body. */
function failureFor(status: number, body: unknown): TransportError {
  const b = (body ?? {}) as { error?: unknown; rate_limited?: unknown; quota_exceeded?: unknown }
  const message = typeof b.error === 'string' ? b.error : `HTTP ${status}`
  if (status === 429) return new TransportError(b.quota_exceeded ? 'quota_exceeded' : 'rate_limited', status, message)
  return new TransportError('unavailable', status, message)
}

/** Whether a value has the shape of a call. */
function isCall(value: unknown): value is Call {
  const c = value as Call | null
  return !!c && typeof c.name === 'string' && !!c.arguments && typeof c.arguments === 'object' && !Array.isArray(c.arguments)
}

/** Checks an infer response's shape, keeping only well-formed calls. */
export function parseInferResponse(body: unknown): InferResponse {
  const b = body as Partial<InferResponse> | null
  if (!b || typeof b !== 'object' || !Array.isArray(b.calls)) {
    throw new TransportError('unavailable', undefined, 'The infer response had no calls')
  }
  return { ...b, calls: b.calls.filter(isCall) }
}

/**
 * The default transport: JSON posts to `<base>/infer` and
 * `<base>/corrections`. A network error and any non-2xx answer throw a
 * `TransportError`.
 */
export function createTransport(options: TransportOptions): Transport {
  const base = (options.endpoint ?? (options.project ? `${FERNFLY_ORIGIN}/api/p/${encodeURIComponent(options.project)}` : ''))
    .replace(/\/+$/, '')
  if (!base) throw new Error('The intent bar needs `project`, `endpoint` or `transport`')

  async function post(path: string, body: unknown): Promise<unknown> {
    const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    let res: Response
    try {
      res = options.fetch ? await options.fetch(`${base}/${path}`, init) : await fetch(`${base}/${path}`, init)
    } catch (err) {
      throw new TransportError('unavailable', undefined, err instanceof Error ? err.message : String(err))
    }
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) throw failureFor(res.status, data)
    return data
  }

  return {
    infer: async (request) => parseInferResponse(await post('infer', request)),
    correct: async (request) => {
      await post('corrections', request)
    },
  }
}
