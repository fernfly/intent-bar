import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENT_NAMES, NotConnectedError, entitiesOf, eventValues, request, withEvents } from './events'
import type { HandlerContext, RunContext } from './types'

const target = new EventTarget()
const listeners: [string, EventListener][] = []

/** Listens on the shared target until the test ends. */
function on(type: string, listener: (e: CustomEvent) => void) {
  target.addEventListener(type, listener as EventListener)
  listeners.push([type, listener as EventListener])
}

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) target.removeEventListener(type, listener)
})

const ctx: HandlerContext = {
  call: { name: 'list', arguments: { who: 'priya' } },
  raw: { who: 'priya' },
  utterance: 'work for priya',
  context: { workspace: 'acme' },
}

describe('request', () => {
  it('returns the answer a listener gave with respondWith', async () => {
    on('x', (e) => e.detail.respondWith(Promise.resolve(42)))
    await expect(request(target, 'x', {})).resolves.toBe(42)
  })

  it('returns null when nobody answers', () => {
    on('x', () => {})
    expect(request(target, 'x', {})).toBeNull()
  })

  it('refuses an answer after dispatch, or a second answer', () => {
    let late: ((v: unknown) => void) | undefined
    let second: unknown
    on('x', (e) => {
      late = e.detail.respondWith
      e.detail.respondWith(1)
      try {
        e.detail.respondWith(2)
      } catch (err) {
        second = err
      }
    })
    request(target, 'x', {})
    expect(String(second)).toMatch(/already called/)
    expect(() => late!(3)).toThrow(/while the x event is dispatched/)
  })
})

describe('withEvents', () => {
  it('asks for a preview with the call’s details', async () => {
    const seen = vi.fn()
    on(EVENT_NAMES.preview, (e) => {
      seen(e.detail)
      e.detail.respondWith({ count: 3 })
    })
    const tool = withEvents('list', { label: 'List' }, target)
    expect(tool.label).toBe('List')
    await expect(tool.preview!({ who: 'u1' }, ctx)).resolves.toEqual({ count: 3 })
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ tool: 'list', args: { who: 'u1' }, raw: { who: 'priya' }, utterance: 'work for priya' }))
  })

  it('treats an unanswered preview as no preview', () => {
    expect(withEvents('list', undefined, target).preview!({}, ctx)).toBeUndefined()
  })

  it('runs through the event, passing progress along', async () => {
    const progress = vi.fn()
    on(EVENT_NAMES.run, (e) => {
      e.detail.progress(1, 2)
      e.detail.respondWith({ message: 'Done it' })
    })
    const run = withEvents('list', undefined, target).run!({}, { ...ctx, progress } as RunContext)
    await expect(run).resolves.toEqual({ message: 'Done it' })
    expect(progress).toHaveBeenCalledWith(1, 2)
  })

  it('fails an unanswered run as not connected', () => {
    expect(() => withEvents('list', undefined, target).run!({}, { ...ctx, progress: () => {} })).toThrow(NotConnectedError)
  })

  it('leaves the host’s own functions alone', async () => {
    const heard = vi.fn()
    on(EVENT_NAMES.preview, heard)
    on(EVENT_NAMES.run, heard)
    const tool = withEvents('list', { preview: () => ({ count: 1 }), run: () => ({ message: 'own' }) }, target)
    expect(await tool.preview!({}, ctx)).toEqual({ count: 1 })
    expect(await tool.run!({}, { ...ctx, progress: () => {} })).toEqual({ message: 'own' })
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('eventValues', () => {
  it('asks for values by entity, and declines when unanswered', async () => {
    const lookup = eventValues('member', target)
    const call = { name: 'assign', arguments: { assignee: 'sam' } }
    expect(lookup('sam', { context: {}, call })).toBeNull()
    on(EVENT_NAMES.values, (e) => e.detail.respondWith(e.detail.entity === 'member' ? [{ id: 'u2', label: `${e.detail.query} lee` }] : []))
    await expect(lookup('sam', { context: {}, call })).resolves.toEqual([{ id: 'u2', label: 'sam lee' }])
  })

  it('hands the listener the call', () => {
    const heard: unknown[] = []
    on(EVENT_NAMES.values, (e) => heard.push(e.detail.call))
    const call = { name: 'list', arguments: { project: 'web', label: 'bug' } }
    eventValues('label', target)('bug', { context: {}, call })
    expect(heard).toEqual([call])
  })
})

describe('entitiesOf', () => {
  it('lists each entity the tools name once', () => {
    const tools = { a: { args: { x: { entity: 'member' }, y: {} } }, b: { args: { z: { entity: 'member' }, w: { entity: 'cycle' } } }, c: {} }
    expect(entitiesOf(tools)).toEqual(['member', 'cycle'])
  })
})
