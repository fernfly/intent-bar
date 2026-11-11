import { describe, expect, it } from 'vitest'
import { fromMatches, lookupKey, readsHold, readsWithout, resolveLocally, watchReads } from './lookup'
import type { ArgConfig, ValueResolver } from './types'

const member: ArgConfig = { entity: 'member' }
const values: Record<string, ValueResolver> = { member: () => [] }
const label = String

describe('resolveLocally', () => {
  it('resolves an argument that is not an entity to its own value', () => {
    expect(resolveLocally('backlog', { enum: ['backlog'] }, values, {}, label)).toEqual({ status: 'resolved', value: 'backlog', label: 'backlog' })
  })

  it('resolves `none` to null without a lookup', () => {
    expect(resolveLocally('none', member, values, {}, label)).toMatchObject({ status: 'resolved', value: null })
  })

  it('resolves `current` from the host context, and blocks when there is none', () => {
    const context = { current: { member: { id: 'u1', label: 'Me' } } }
    expect(resolveLocally('current', member, values, context, label)).toEqual({ status: 'resolved', value: 'u1', label: 'Me' })
    expect(resolveLocally('current', member, values, {}, label)).toEqual({ status: 'missing' })
  })

  it('passes the words through when the host has no resolver for the entity', () => {
    expect(resolveLocally('mobile', { entity: 'project' }, values, {}, label)).toMatchObject({ status: 'resolved', value: 'mobile' })
  })

  it('asks for a lookup otherwise', () => {
    expect(resolveLocally('priya', member, values, {}, label)).toBeNull()
  })
})

describe('fromMatches', () => {
  it('resolves one match, asks for a choice among several, and blocks on none', () => {
    const sam = { id: 's1', label: 'Sam Lee' }
    const sam2 = { id: 's2', label: 'Sam Ortiz' }
    expect(fromMatches([sam], 'sam', label)).toEqual({ status: 'resolved', value: 's1', label: 'Sam Lee' })
    expect(fromMatches([sam, sam2], 'sam', label)).toEqual({ status: 'choose', options: [sam, sam2] })
    expect(fromMatches([], 'sam', label)).toEqual({ status: 'missing' })
  })

  it('passes the words through when the lookup declines', () => {
    expect(fromMatches(null, 'sam', label)).toEqual({ status: 'resolved', value: 'sam', label: 'sam' })
  })
})

describe('lookupKey', () => {
  it('separates entities and value types', () => {
    expect(lookupKey('member', '1')).not.toBe(lookupKey('member', 1))
    expect(lookupKey('member', 'x')).not.toBe(lookupKey('project', 'x'))
  })
})

describe('watchReads', () => {
  const call = { name: 'list', arguments: { project: 'web', label: 'bug' } }

  it('reads like the call, and records the arguments read, absent ones included', () => {
    const watched = watchReads(call, ['cycle'])
    expect(watched.call.arguments.project).toBe('web')
    expect(watched.call.arguments.cycle).toBeUndefined()
    expect(Object.keys(watched.call.arguments)).toEqual(['project', 'label'])
    expect(watched.reads()).toEqual({ args: { project: 'web', cycle: undefined } })
  })

  it('records the tool name, and everything a copy reads', () => {
    const watched = watchReads(call)
    expect(JSON.parse(JSON.stringify(watched.call))).toEqual(call)
    expect(structuredClone(watched.call)).toEqual(call)
    expect(watched.reads('label')).toEqual({ name: 'list', args: { project: 'web' } })
  })

  it('is read-only', () => {
    const watched = watchReads(call)
    expect(() => ((watched.call.arguments as Record<string, unknown>).project = 'mobile')).toThrow()
    expect(call.arguments.project).toBe('web')
  })
})

describe('readsHold', () => {
  const call = { name: 'list', arguments: { project: 'web', label: 'bug' } }

  it('holds while the arguments read keep their values', () => {
    expect(readsHold({ args: { project: 'web' } }, { ...call, arguments: { ...call.arguments, label: 'ui' } })).toBe(true)
    expect(readsHold(undefined, call)).toBe(true)
    expect(readsHold({ args: {} }, { name: 'other', arguments: {} })).toBe(true)
  })

  it('fails when an argument read changes, is added or is removed, or the tool read changes', () => {
    expect(readsHold({ args: { project: 'web' } }, { ...call, arguments: { project: 'mobile' } })).toBe(false)
    expect(readsHold({ args: { cycle: undefined } }, { ...call, arguments: { ...call.arguments, cycle: 'c7' } })).toBe(false)
    expect(readsHold({ args: { project: 'web' } }, { ...call, arguments: { label: 'bug' } })).toBe(false)
    expect(readsHold({ name: 'list', args: {} }, { ...call, name: 'update' })).toBe(false)
  })

  it('can leave out the argument being looked up', () => {
    expect(readsWithout({ name: 'list', args: { project: 'web', label: 'bug' } }, 'label')).toEqual({ name: 'list', args: { project: 'web' } })
  })
})
