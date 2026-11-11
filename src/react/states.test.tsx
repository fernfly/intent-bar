import { cleanup, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Call, HostContext, InferResponse, LookupOption, ToolConfig, Transport } from '../core/types'
import { IntentBar, type IntentBarProps } from './IntentBar'

const members: LookupOption[] = [
  { id: 'u1', label: 'Priya Shah' },
  { id: 'u2', label: 'Sam Lee', detail: 'sam.lee@example.com' },
  { id: 'u3', label: 'Sam Ortiz', detail: 'sam.o@example.com' },
]
const STATES = ['backlog', 'todo', 'done']

/** The tools the tests share: a filter over work items, and a bulk action that confirms. */
function makeTools() {
  const undo = vi.fn()
  const tools = {
    list_issues: {
      kind: 'filter',
      label: 'Work items',
      examples: ['backlog for priya', 'my urgent bugs'],
      args: {
        state: { label: 'state', enum: STATES },
        assignee: { label: 'assignee', entity: 'member' },
        priority: { label: 'priority', enum: ['high', 'low'] },
      },
      preview: vi.fn(async () => ({ count: 4, summary: '4 work items' })),
      run: vi.fn(),
    },
    bulk_update: {
      label: 'Update work items',
      examples: ['move backlog to sam'],
      args: {
        state: { label: 'state', enum: STATES },
        set_assignee: { label: 'assign to', role: 'set', entity: 'member' },
      },
      preview: vi.fn(async () => ({
        count: 3,
        summary: 'Assign 3 work items',
        sample: ['Fix login', 'Update docs'],
        undoable: true,
        confirmLabel: 'Assign 3',
        actions: [{ label: 'Email all 3', summary: 'Email 3 assignees', run: vi.fn(async () => ({ message: 'Emailed' })) }],
      })),
      run: vi.fn(async (_args, ctx) => {
        ctx.progress(1, 3)
        await new Promise((r) => setTimeout(r, 20))
        return { message: 'Assigned 3 work items', undo }
      }),
    },
  } satisfies Record<string, ToolConfig>
  return { tools, undo }
}

/** A transport with one answer per sentence. */
function makeTransport(answers: Record<string, InferResponse | Error | { reason: string }>) {
  return {
    infer: vi.fn<Transport['infer']>(async ({ utterance }) => {
      const answer = answers[utterance]
      if (!answer) throw new Error(`no answer for "${utterance}"`)
      if (answer instanceof Error || 'reason' in answer) throw answer
      return structuredClone(answer)
    }),
    correct: vi.fn<NonNullable<Transport['correct']>>(async () => {}),
  }
}

const parsed = (call: Call): InferResponse => ({ calls: [call], latency_ms: 30, log_ref: 'ref-1' })

const host = () => document.querySelector('fernfly-intent-bar') as HTMLElement
const shadow = () => host().shadowRoot as ShadowRoot
const bar = () => within(shadow() as unknown as HTMLElement)
const active = () => shadow().activeElement as HTMLElement | null
const isOpen = () => shadow().querySelector('.overlay') !== null
const chip = (arg: string) => shadow().querySelector(`[data-arg="${arg}"]`) as HTMLButtonElement
const primary = () => shadow().querySelector('button.primary') as HTMLButtonElement
const resultLine = () => shadow().querySelector('.result-line')?.textContent

/** Renders the bar, opens it, and optionally asks one sentence. */
async function setup(answers: Parameters<typeof makeTransport>[0] = {}, props: Partial<IntentBarProps> = {}) {
  const user = userEvent.setup()
  const transport = makeTransport(answers)
  const { tools, undo } = makeTools()
  const values = { member: vi.fn(async (q: string) => members.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()))) }
  const navigate = vi.fn()
  const element = (more: Partial<IntentBarProps> = {}) => (
    <IntentBar
      transport={transport}
      tools={tools}
      values={values}
      pages={[
        { label: 'Projects', href: '/projects' },
        { label: 'Cycles', href: '/cycles' },
      ]}
      navigate={navigate}
      appName="Acme"
      hotkey="ctrl+k"
      {...props}
      {...more}
    />
  )
  const { rerender } = render(element())
  await user.keyboard('{Control>}k{/Control}')
  const ask = async (sentence: string) => {
    await user.keyboard(sentence)
    await user.keyboard('{Enter}')
  }
  /** Renders the bar again, as a host does when its own state changes. */
  const update = (more: Partial<IntentBarProps> = {}) => rerender(element(more))
  return { user, transport, tools, undo, values, navigate, ask, update }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('01 empty and 02 short query', () => {
  it('shows up to three examples, and asks the model with the one picked', async () => {
    const { user, transport } = await setup({ 'backlog for priya': parsed({ name: 'list_issues', arguments: { state: 'backlog' } }) })
    const tries = within(bar().getByRole('group', { name: 'Try' }) as HTMLElement).getAllByRole('option')
    expect(tries.map((o) => o.textContent)).toEqual(['backlog for priya', 'move backlog to sam', 'my urgent bugs'])
    await user.keyboard('{Enter}')
    await bar().findByRole('group', { name: 'Parsed request' })
    expect(transport.infer).toHaveBeenCalledTimes(1)
  })

  it('searches pages and commands with no model call, and starts a command without one', async () => {
    const { user, transport } = await setup()
    await user.keyboard('work')
    expect(bar().getAllByRole('option').map((o) => o.textContent)).toEqual(['Work items', 'Update work items'])
    await user.keyboard('{Enter}')
    await bar().findByRole('group', { name: 'Parsed request' })
    expect(transport.infer).not.toHaveBeenCalled()
    expect(shadow().querySelector('.footer')?.textContent).toContain('No model call')
  })

  it('goes to a page picked from search', async () => {
    const { user, navigate } = await setup()
    await user.keyboard('cyc{Enter}')
    expect(navigate).toHaveBeenCalledWith('/cycles')
    expect(isOpen()).toBe(false)
  })

  it('keeps search working with a one-line notice when the model is rate limited', async () => {
    const { user, ask } = await setup({ 'projects for me please': { reason: 'rate_limited' } })
    await ask('projects for me please')
    expect((await bar().findByRole('status')).textContent).toBe('Too many requests right now. Search still works.')
    await user.keyboard('{Control>}a{/Control}proj')
    expect(bar().getAllByRole('option').map((o) => o.textContent)).toEqual(['Projects'])
    expect(bar().queryByRole('status')).toBeNull()
  })

  it('reads a network failure as the model being unavailable', async () => {
    const { ask } = await setup({ 'any sentence here': new TypeError('Failed to fetch') })
    await ask('any sentence here')
    expect((await bar().findByRole('status')).textContent).toMatch(/unavailable/)
  })
})

describe('03 parsed', () => {
  it('resolves lookups, previews, and applies a filter on Enter with no confirm', async () => {
    const { user, tools, transport, ask } = await setup({
      'backlog for priya': parsed({ name: 'list_issues', arguments: { state: 'backlog', assignee: 'priya' } }),
    })
    await ask('backlog for priya')
    await waitFor(() => expect(resultLine()).toBe('4 work items'))
    expect(chip('assignee').textContent).toBe('assigneePriya Shah')
    expect(chip('assignee').dataset.role).toBe('match')
    expect(shadow().querySelector('.footer')?.textContent).toMatch(/Parsed in \d+ ms/)
    await user.keyboard('{Enter}')
    expect(tools.list_issues.run).toHaveBeenCalledWith(
      { state: 'backlog', assignee: 'u1' },
      expect.objectContaining({ raw: { state: 'backlog', assignee: 'priya' }, utterance: 'backlog for priya' }),
    )
    expect(isOpen()).toBe(false)
    expect(transport.correct).not.toHaveBeenCalled()
  })

  it('asks for a choice between several matches, and sends no correction for the pick', async () => {
    const { user, tools, transport, ask } = await setup({
      'backlog for sam now': parsed({ name: 'list_issues', arguments: { state: 'backlog', assignee: 'sam' } }),
    })
    await ask('backlog for sam now')
    await waitFor(() => expect(chip('assignee').dataset.status).toBe('choose'))
    expect(resultLine()).toBe('Choose which assignee you mean.')
    expect(primary().disabled).toBe(true)
    chip('assignee').focus()
    await user.keyboard('{Enter}')
    const options = await bar().findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Sam Leesam.lee@example.com', 'Sam Ortizsam.o@example.com', 'Remove assignee'])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(chip('assignee').textContent).toBe('assigneeSam Ortiz')
    expect(active()).toBe(chip('assignee'))
    await waitFor(() => expect(primary().disabled).toBe(false))
    primary().click()
    expect(tools.list_issues.run).toHaveBeenCalledWith({ state: 'backlog', assignee: 'u3' }, expect.anything())
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.correct).not.toHaveBeenCalled()
  })

  it('blocks the run when a lookup finds nothing', async () => {
    const { ask } = await setup({ 'backlog for zed now': parsed({ name: 'list_issues', arguments: { assignee: 'zed' } }) })
    await ask('backlog for zed now')
    await waitFor(() => expect(resultLine()).toBe('No assignee matches “zed”.'))
    expect(chip('assignee').dataset.status).toBe('missing')
    expect(primary().disabled).toBe(true)
  })

  it('resolves `none` to null and `current` from the host context', async () => {
    const { user, tools, ask } = await setup(
      { 'unassigned work for me': parsed({ name: 'list_issues', arguments: { assignee: 'none' } }) },
      { context: () => ({ current: { member: { id: 'u9', label: 'You' } } }) },
    )
    await ask('unassigned work for me')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    expect(tools.list_issues.run).toHaveBeenCalledWith({ assignee: null }, expect.anything())
  })

  it('resolves `current` from context the host gained after the bar opened', async () => {
    let current: HostContext['current'] = {}
    const { user, tools, ask } = await setup(
      { 'work assigned to me': parsed({ name: 'list_issues', arguments: { assignee: 'current' } }) },
      { context: () => ({ current }) },
    )
    current = { member: { id: 'u9', label: 'You' } }
    await ask('work assigned to me')
    await waitFor(() => expect(chip('assignee').textContent).toBe('assigneeYou'))
    await user.keyboard('{Enter}')
    expect(tools.list_issues.run).toHaveBeenCalledWith({ assignee: 'u9' }, expect.anything())
  })

  it('resolves a blocked `current` once the host renders with it, without reopening', async () => {
    let current: HostContext['current'] = {}
    const context = () => ({ current })
    const { ask, update } = await setup({ 'work assigned to me': parsed({ name: 'list_issues', arguments: { assignee: 'current' } }) }, { context })
    await ask('work assigned to me')
    await waitFor(() => expect(resultLine()).toBe('There is no current assignee here.'))
    current = { member: { id: 'u9', label: 'You' } }
    update()
    await waitFor(() => expect(chip('assignee').textContent).toBe('assigneeYou'))
    expect(primary().disabled).toBe(false)
  })

  it('keeps one context while the host’s answer reads the same, so a lookup runs once', async () => {
    const context = vi.fn(() => ({ current: {}, workspace: 'acme' }))
    const { values, ask, update } = await setup({ 'backlog for priya': parsed({ name: 'list_issues', arguments: { assignee: 'priya' } }) }, { context })
    await ask('backlog for priya')
    await waitFor(() => expect(chip('assignee').dataset.status).toBe('resolved'))
    update()
    update()
    await waitFor(() => expect(resultLine()).toBe('4 work items'))
    expect(context.mock.calls.length).toBeGreaterThan(2)
    expect(values.member).toHaveBeenCalledTimes(1)
  })

  it('says when the app has not connected a tool', async () => {
    const { ask } = await setup({ 'archive old cycles now': parsed({ name: 'archive_cycles', arguments: {} }) })
    await ask('archive old cycles now')
    await waitFor(() => expect(resultLine()).toBe("This app hasn't connected that yet."))
    expect(primary().disabled).toBe(true)
  })
})

describe('04 confirm', () => {
  const move = { 'move backlog to sam lee': parsed({ name: 'bulk_update', arguments: { state: 'backlog', set_assignee: 'sam lee' } }) }

  it('confirms an action, runs it with progress, then offers Undo', async () => {
    const { user, tools, undo, ask } = await setup(move)
    await ask('move backlog to sam lee')
    await waitFor(() => expect(primary().disabled).toBe(false))
    expect(chip('set_assignee').dataset.role).toBe('set')
    expect(primary().textContent).toBe('Assign 3… ↵')
    await user.keyboard('{Enter}')

    expect(shadow().querySelector('.confirm-title')?.textContent).toBe('Assign 3 work items')
    expect([...shadow().querySelectorAll('.sample li')].map((li) => li.textContent)).toEqual(['Fix login', 'Update docs'])
    expect(bar().getByText('and 1 more')).toBeTruthy()
    expect(bar().getByText('You can undo this afterwards.')).toBeTruthy()
    expect(active()?.textContent).toBe('Assign 3')
    expect(tools.bulk_update.run).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(shadow().querySelector('.confirm')).toBeNull()
    expect(isOpen()).toBe(true)
    await user.keyboard('{Enter}{Enter}')
    expect(tools.bulk_update.run).toHaveBeenCalledWith({ state: 'backlog', set_assignee: 'u2' }, expect.anything())
    expect(isOpen()).toBe(false)
    expect((await bar().findByText('1 of 3')).closest('.toast')).toBeTruthy()
    await bar().findByText('Assigned 3 work items')
    await user.click(bar().getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    await bar().findByText('Undone')
  })

  it('ignores a held Enter on the confirm button', async () => {
    const { user, tools, ask } = await setup(move)
    await ask('move backlog to sam lee')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter>2/}')
    expect(tools.bulk_update.run).toHaveBeenCalledTimes(1)
  })

  it('skips confirm only for a single item when the tool turns it off', async () => {
    const { tools } = makeTools()
    const single = { ...tools.bulk_update, confirm: false, preview: async () => ({ count: 1 }) }
    const { user, ask } = await setup(move, { tools: { ...tools, bulk_update: single } })
    await ask('move backlog to sam lee')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    expect(single.run).toHaveBeenCalledTimes(1)
  })

  it('still confirms bulk work when the tool turns confirm off', async () => {
    const { tools } = makeTools()
    const bulk = { ...tools.bulk_update, confirm: false }
    const { user, ask } = await setup(move, { tools: { ...tools, bulk_update: bulk } })
    await ask('move backlog to sam lee')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    expect(shadow().querySelector('.confirm')).not.toBeNull()
    expect(bulk.run).not.toHaveBeenCalled()
  })

  it('confirms a preview action, and sends no correction for it', async () => {
    const { user, transport, tools, ask } = await setup(move)
    await ask('move backlog to sam lee')
    const email = await bar().findByRole('button', { name: 'Email all 3' })
    await waitFor(() => expect(email.hasAttribute('disabled')).toBe(false))
    await user.click(email)
    expect(shadow().querySelector('.confirm-title')?.textContent).toBe('Email 3 assignees')
    await user.keyboard('{Enter}')
    await bar().findByText('Emailed')
    expect(tools.bulk_update.run).not.toHaveBeenCalled()
    expect(transport.correct).not.toHaveBeenCalled()
  })
})

describe('05 correct', () => {
  const backlog = { 'backlog for priya': parsed({ name: 'list_issues', arguments: { state: 'backlog', assignee: 'priya' } }) }

  it('sends the edited call as a correction once it runs', async () => {
    const { user, transport, ask } = await setup(backlog)
    await ask('backlog for priya')
    chip('state').focus()
    await user.keyboard('{Enter}')
    await user.keyboard('todo{Enter}')
    expect(chip('state').textContent).toBe('statetodo')
    expect(transport.correct).not.toHaveBeenCalled()
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    await waitFor(() =>
      expect(transport.correct).toHaveBeenCalledWith({ log_ref: 'ref-1', call: { name: 'list_issues', arguments: { state: 'todo', assignee: 'priya' } } }),
    )
    await bar().findByText('Saved as a correction for review')
  })

  it('sends nothing for an edit that is abandoned', async () => {
    const { user, transport, ask } = await setup(backlog)
    await ask('backlog for priya')
    chip('state').focus()
    await user.keyboard('{Enter}todo{Enter}')
    await user.keyboard('{Escape}')
    expect(isOpen()).toBe(false)
    expect(transport.correct).not.toHaveBeenCalled()
  })

  it('adds a missing argument with "+ add"', async () => {
    const { user, transport, ask } = await setup(backlog)
    await ask('backlog for priya')
    await user.click(bar().getByRole('button', { name: '+ add' }))
    expect((await bar().findAllByRole('option')).map((o) => o.textContent)).toEqual(['priority'])
    await user.keyboard('{Enter}')
    await user.keyboard('high{Enter}')
    expect(chip('priority').textContent).toBe('priorityhigh')
    expect(active()).toBe(chip('priority'))
    expect(bar().queryByRole('button', { name: '+ add' })).toBeNull()
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    await waitFor(() => expect(transport.correct).toHaveBeenCalledTimes(1))
    expect(transport.correct.mock.calls[0]![0].call.arguments).toEqual({ state: 'backlog', assignee: 'priya', priority: 'high' })
  })

  it('removes an argument', async () => {
    const { user, ask } = await setup(backlog)
    await ask('backlog for priya')
    chip('state').focus()
    await user.keyboard('{Enter}')
    await user.click(await bar().findByRole('option', { name: 'Remove state' }))
    expect(chip('state')).toBeNull()
    expect(active()?.dataset.role).toBe('tool')
  })

  it('replaces the words when a different value is searched and picked', async () => {
    const { user, transport, ask } = await setup(backlog)
    await ask('backlog for priya')
    await waitFor(() => expect(chip('assignee').dataset.status).toBe('resolved'))
    chip('assignee').focus()
    await user.keyboard('{Enter}')
    expect(bar().getByText('Type to search assignee')).toBeTruthy()
    await user.keyboard('ortiz')
    await user.click(await bar().findByRole('option', { name: /Sam Ortiz/ }))
    expect(chip('assignee').textContent).toBe('assigneeSam Ortiz')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    await waitFor(() => expect(transport.correct).toHaveBeenCalledTimes(1))
    expect(transport.correct.mock.calls[0]![0].call.arguments.assignee).toBe('Sam Ortiz')
  })

  it('switches the tool, keeping the arguments the new tool names', async () => {
    const { user, ask } = await setup(backlog)
    await ask('backlog for priya')
    await user.click(bar().getByRole('button', { name: 'Work items' }))
    await user.click(await bar().findByRole('option', { name: 'Update work items' }))
    expect(bar().getByRole('button', { name: 'Update work items' })).toBeTruthy()
    expect(chip('state').textContent).toBe('statebacklog')
    expect(chip('assignee')).toBeNull()
  })

  it('checks a typed value against the argument’s type', async () => {
    const { tools } = makeTools()
    const withTotal = { ...tools.list_issues, args: { ...tools.list_issues.args, total: { label: 'total', type: 'number' as const } } }
    const { user, ask } = await setup(
      { 'invoices over 500 dollars': parsed({ name: 'list_issues', arguments: { total: 500 } }) },
      { tools: { ...tools, list_issues: withTotal } },
    )
    await ask('invoices over 500 dollars')
    chip('total').focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Control>}a{/Control}lots{Enter}')
    expect(bar().getByText('Enter a number')).toBeTruthy()
    await user.keyboard('{Control>}a{/Control}750{Enter}')
    expect(chip('total').textContent).toBe('total750')
  })
})

describe('06 out of scope', () => {
  it('says what the app cannot do and offers related pages and examples', async () => {
    const { user, navigate, ask } = await setup({ 'what is the weather in projects': { calls: [], out_of_scope: true, reply: 'x', log_ref: 'r' } })
    await ask('what is the weather in projects')
    await bar().findByText('That is not something Acme can do.')
    expect(bar().getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Projects',
      'backlog for priya',
      'move backlog to sam',
      'my urgent bugs',
    ])
    expect(shadow().querySelector('.footer')?.textContent).toContain('Saved for review')
    await user.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledWith('/projects')
  })
})

describe('07 results', () => {
  const backlog = { 'unassigned backlog work': parsed({ name: 'list_issues', arguments: { state: 'backlog', assignee: 'none' } }) }
  const rows = [
    { label: 'Fix login', detail: 'MOB-1', href: '/items/1' },
    { label: 'Update docs', href: '/items/2' },
  ]

  /** The shared tools, with a filter whose run answers with `run`. */
  function listing(run: ToolConfig['run']) {
    const { tools } = makeTools()
    return { ...tools, list_issues: { ...tools.list_issues, run: vi.fn(run) } }
  }

  it('lists the rows a filter’s run returns, and Enter opens the selected one', async () => {
    const tools = listing(async () => ({ items: rows }))
    const { user, navigate, ask } = await setup(backlog, { tools })
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    const results = await bar().findByRole('listbox', { name: 'Results' })
    expect(within(results).getAllByRole('option').map((o) => o.textContent)).toEqual(['Fix loginMOB-1', 'Update docs'])
    expect(shadow().querySelector('[cmdk-group-heading]')?.textContent).toBe('4 work items')
    expect(shadow().querySelector('[cmdk-item][data-selected="true"]')?.textContent).toBe('Fix loginMOB-1')
    expect(active()).toBe(shadow().querySelector('[cmdk-input]'))
    expect(shadow().querySelector('.footer')?.textContent).toContain('↵ open')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(navigate).toHaveBeenCalledWith('/items/2')
    expect(isOpen()).toBe(false)
    expect(tools.list_issues.run).toHaveBeenCalledTimes(1)
  })

  it('opens a row on click, and closes on Escape', async () => {
    const tools = listing(async () => ({ items: rows }))
    const { user, navigate, ask } = await setup(backlog, { tools })
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    await user.click(await bar().findByRole('option', { name: 'Update docs' }))
    expect(navigate).toHaveBeenCalledWith('/items/2')

    await user.keyboard('{Control>}k{/Control}')
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    await bar().findByRole('listbox', { name: 'Results' })
    await user.keyboard('{Escape}')
    expect(isOpen()).toBe(false)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('waits while the run is in flight', async () => {
    let answer!: (result: { items: typeof rows }) => void
    const tools = listing(() => new Promise((resolve) => (answer = resolve)))
    const { user, ask } = await setup(backlog, { tools })
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}{Enter}')
    expect(resultLine()).toBe('Applying filter…')
    expect(primary().disabled).toBe(true)
    expect(tools.list_issues.run).toHaveBeenCalledTimes(1)
    answer({ items: rows })
    await bar().findByRole('listbox', { name: 'Results' })
  })

  it('says so when the list is empty', async () => {
    const { user, ask } = await setup(backlog, { tools: listing(async () => ({ items: [] })) })
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}')
    await bar().findByText('Nothing matches.')
    expect(bar().queryByRole('option')).toBeNull()
  })

  it('drops the rows of a run whose bar was closed meanwhile', async () => {
    let answer!: (result: { items: typeof rows }) => void
    const tools = listing(() => new Promise((resolve) => (answer = resolve)))
    const { user, ask } = await setup(backlog, { tools })
    await ask('unassigned backlog work')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.keyboard('{Enter}{Escape}')
    expect(isOpen()).toBe(false)
    await user.keyboard('{Control>}k{/Control}')
    answer({ items: rows })
    await new Promise((r) => setTimeout(r, 10))
    expect(isOpen()).toBe(true)
    expect(bar().queryByRole('listbox', { name: 'Results' })).toBeNull()
  })
})
