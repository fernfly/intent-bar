import { describe, expect, it, vi } from 'vitest'
import { TransportError, createTransport, failureReason, parseInferResponse } from './transport'

/** A fetch that answers every request with one status and body, and records what it was sent. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
}

describe('createTransport', () => {
  it('posts the sentence to the project endpoint', async () => {
    const fetch = fakeFetch(200, { calls: [{ name: 'list', arguments: {} }], log_ref: 'r1' })
    const res = await createTransport({ project: 'p 1', fetch }).infer({ utterance: 'hi', meta: { source: 'intent-bar' } })
    expect(res).toMatchObject({ calls: [{ name: 'list' }], log_ref: 'r1' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://fernfly.com/api/p/p%201/infer')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ utterance: 'hi', meta: { source: 'intent-bar' } })
  })

  it('sends corrections to the host proxy when an endpoint is given', async () => {
    const fetch = fakeFetch(200, { ok: true })
    await createTransport({ endpoint: '/api/fernfly/', fetch }).correct!({ log_ref: 'r1', call: { name: 'x', arguments: { a: 1 } } })
    expect(fetch.mock.calls[0]![0]).toBe('/api/fernfly/corrections')
  })

  it('names the cause of a 429', async () => {
    const limited = createTransport({ project: 'p', fetch: fakeFetch(429, { error: 'slow down', rate_limited: true }) })
    await expect(limited.infer({ utterance: 'x' })).rejects.toMatchObject({ reason: 'rate_limited', status: 429 })
    const quota = createTransport({ project: 'p', fetch: fakeFetch(429, { quota_exceeded: true }) })
    await expect(quota.infer({ utterance: 'x' })).rejects.toMatchObject({ reason: 'quota_exceeded' })
  })

  it('reports a network error or other failure as unavailable', async () => {
    const offline = createTransport({ project: 'p', fetch: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) })
    await expect(offline.infer({ utterance: 'x' })).rejects.toMatchObject({ reason: 'unavailable' })
    const broken = createTransport({ project: 'p', fetch: fakeFetch(500, { error: 'boom' }) })
    await expect(broken.infer({ utterance: 'x' })).rejects.toMatchObject({ reason: 'unavailable', status: 500, message: 'boom' })
  })

  it('needs a project or an endpoint', () => {
    expect(() => createTransport({})).toThrow(/project/)
  })
})

describe('parseInferResponse', () => {
  it('keeps well-formed calls and rejects a body without calls', () => {
    expect(parseInferResponse({ calls: [{ name: 'a', arguments: {} }, { name: 'b' }, null] }).calls).toEqual([{ name: 'a', arguments: {} }])
    expect(() => parseInferResponse({ error: 'x' })).toThrow(TransportError)
  })
})

describe('failureReason', () => {
  it('reads the reason by shape, so a custom transport can report one', () => {
    expect(failureReason({ reason: 'rate_limited' })).toBe('rate_limited')
    expect(failureReason(new Error('x'))).toBe('unavailable')
    expect(failureReason(null)).toBe('unavailable')
  })
})
