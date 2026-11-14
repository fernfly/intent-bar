import { describe, expect, it } from 'vitest'
import {
  autoRunSeconds,
  coerce,
  examplesFrom,
  isCorrection,
  kindOf,
  missingArgs,
  needsConfirm,
  optionsFor,
  removeArg,
  setArg,
  switchTool,
  typeOf,
  valueLabel,
} from './call'
import type { Call, ToolConfig } from './types'

const model: Call = { name: 'list_issues', arguments: { state: 'backlog', assignee: 'priya' } }

describe('kindOf and needsConfirm', () => {
  it('treats a tool with no kind as an action', () => {
    expect(kindOf(undefined)).toBe('action')
    expect(kindOf({})).toBe('action')
  })

  it('never confirms a filter or navigation, and always confirms an action by default', () => {
    expect(needsConfirm({ kind: 'filter' }, { count: 40 })).toBe(false)
    expect(needsConfirm({ kind: 'navigate' }, undefined)).toBe(false)
    expect(needsConfirm({}, { count: 1 })).toBe(true)
    expect(needsConfirm(undefined, undefined)).toBe(true)
  })

  it('lets an action skip confirm only for a single item', () => {
    expect(needsConfirm({ confirm: false }, { count: 1 })).toBe(false)
    expect(needsConfirm({ confirm: false }, { count: 0 })).toBe(false)
    expect(needsConfirm({ confirm: false }, { count: 2 })).toBe(true)
    expect(needsConfirm({ confirm: false }, {})).toBe(true)
    expect(needsConfirm({ confirm: false }, undefined)).toBe(true)
  })
})

describe('autoRunSeconds', () => {
  it('counts a navigation down 3 seconds, and waits for Enter on anything else', () => {
    expect(autoRunSeconds({ kind: 'navigate' })).toBe(3)
    expect(autoRunSeconds({ kind: 'filter' })).toBe(false)
    expect(autoRunSeconds({})).toBe(false)
    expect(autoRunSeconds(undefined)).toBe(false)
  })

  it('takes the tool’s own seconds, but never runs an action by itself', () => {
    expect(autoRunSeconds({ kind: 'navigate', autoRun: 5 })).toBe(5)
    expect(autoRunSeconds({ kind: 'navigate', autoRun: false })).toBe(false)
    expect(autoRunSeconds({ kind: 'filter', autoRun: 2 })).toBe(2)
    expect(autoRunSeconds({ kind: 'action', autoRun: 2 })).toBe(false)
    expect(autoRunSeconds({ autoRun: 2 })).toBe(false)
  })

  it('rounds up to whole seconds, at least 1, and ignores a number that isn’t one', () => {
    expect(autoRunSeconds({ kind: 'navigate', autoRun: 1.2 })).toBe(2)
    expect(autoRunSeconds({ kind: 'navigate', autoRun: 0 })).toBe(1)
    expect(autoRunSeconds({ kind: 'navigate', autoRun: -1 })).toBe(false)
    expect(autoRunSeconds({ kind: 'navigate', autoRun: Number.NaN })).toBe(false)
    expect(autoRunSeconds({ kind: 'navigate', autoRun: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

describe('editing a call', () => {
  it('returns new calls and leaves the model’s untouched', () => {
    const edited = removeArg(setArg(model, 'state', 'done'), 'assignee')
    expect(edited).toEqual({ name: 'list_issues', arguments: { state: 'done' } })
    expect(model.arguments).toEqual({ state: 'backlog', assignee: 'priya' })
  })

  it('keeps only the arguments the new tool names when switching', () => {
    const target: ToolConfig = { args: { assignee: {}, set_state: {} } }
    expect(switchTool(model, 'bulk_update', target)).toEqual({ name: 'bulk_update', arguments: { assignee: 'priya' } })
    expect(switchTool(model, 'other', undefined)).toEqual({ name: 'other', arguments: {} })
  })

  it('lists the configured arguments the call lacks', () => {
    expect(missingArgs(model, { args: { state: {}, assignee: {}, priority: {}, cycle: {} } })).toEqual(['priority', 'cycle'])
    expect(missingArgs(model, undefined)).toEqual([])
  })
})

describe('isCorrection', () => {
  it('counts a changed value, an added or removed argument, and a switched tool', () => {
    expect(isCorrection(model, setArg(model, 'state', 'todo'))).toBe(true)
    expect(isCorrection(model, setArg(model, 'priority', 'high'))).toBe(true)
    expect(isCorrection(model, removeArg(model, 'state'))).toBe(true)
    expect(isCorrection(model, { ...model, name: 'bulk_update' })).toBe(true)
  })

  it('ignores an unchanged call, argument order, and a call with no model behind it', () => {
    expect(isCorrection(model, { name: 'list_issues', arguments: { assignee: 'priya', state: 'backlog' } })).toBe(false)
    expect(isCorrection(model, setArg(setArg(model, 'state', 'done'), 'state', 'backlog'))).toBe(false)
    expect(isCorrection(undefined, model)).toBe(false)
  })

  it('compares nested values deeply', () => {
    const withList: Call = { name: 'x', arguments: { labels: ['bug', 'p1'] } }
    expect(isCorrection(withList, { name: 'x', arguments: { labels: ['bug', 'p1'] } })).toBe(false)
    expect(isCorrection(withList, { name: 'x', arguments: { labels: ['bug'] } })).toBe(true)
  })
})

describe('values on chips and in editors', () => {
  it('converts typed text to the argument’s type', () => {
    expect(typeOf(undefined, 500)).toBe('integer')
    expect(typeOf(undefined, 2.5)).toBe('number')
    expect(typeOf({ type: 'number' }, 'x')).toBe('number')
    expect(coerce(' 500 ', 'integer')).toBe(500)
    expect(coerce('2.5', 'integer')).toBeUndefined()
    expect(coerce('abc', 'number')).toBeUndefined()
    expect(coerce('yes', 'boolean')).toBe(true)
    expect(coerce('  ', 'string')).toBeUndefined()
  })

  it('offers an enum, or yes and no for a boolean, as a list', () => {
    expect(optionsFor({ enum: ['a', 'b'] }, 'a')).toEqual(['a', 'b'])
    expect(optionsFor(undefined, true)).toEqual([true, false])
    expect(optionsFor(undefined, 'free text')).toBeNull()
  })

  it('labels values for chips', () => {
    expect(valueLabel('in_progress', { optionLabels: { in_progress: 'in progress' } })).toBe('in progress')
    expect(valueLabel(null, undefined)).toBe('none')
    expect(valueLabel(['a', 'b'], undefined)).toBe('a, b')
    expect(valueLabel(false, undefined)).toBe('no')
  })
})

describe('examplesFrom', () => {
  it('takes each tool’s first example before any tool’s second, up to three', () => {
    const tools: Record<string, ToolConfig> = {
      a: { examples: ['a1', 'a2', 'a3'] },
      b: { examples: ['b1'] },
      c: {},
    }
    expect(examplesFrom(tools)).toEqual(['a1', 'b1', 'a2'])
    expect(examplesFrom(undefined)).toEqual([])
  })
})
