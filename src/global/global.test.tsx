import { act, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InferResponse, Transport } from '../core/types'
import { optionsFromScript } from './setup'

const host = () => document.querySelector('fernfly-intent-bar') as HTMLElement
const shadow = () => host().shadowRoot as ShadowRoot
const bar = () => within(shadow() as unknown as HTMLElement)
const primary = () => shadow().querySelector('button.primary') as HTMLButtonElement
const chip = (arg: string) => shadow().querySelector(`[data-arg="${arg}"]`) as HTMLButtonElement

const listeners: [string, EventListener][] = []
function on(type: keyof WindowEventMap, listener: (e: CustomEvent) => void) {
  window.addEventListener(type, listener as EventListener)
  listeners.push([type, listener as EventListener])
}

function transport(answer: InferResponse) {
  return { infer: vi.fn<Transport['infer']>(async () => structuredClone(answer)), correct: vi.fn(async () => {}) }
}

afterEach(async () => {
  for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener)
  const bar = await import('./index')
  await act(async () => bar.destroy())
  cleanup()
  document.body.innerHTML = ''
})

/** Mounts the script-tag build with these options, opens it, and asks one sentence. */
async function ask(options: Parameters<typeof import('./index').init>[0], sentence: string) {
  const user = userEvent.setup()
  const global = await import('./index')
  await act(async () => global.init(options))
  await act(async () => global.open({ query: sentence, ask: true }))
  await bar().findByRole('group', { name: 'Parsed request' })
  return user
}

describe('the script-tag build’s events', () => {
  it('previews, looks up and runs through events when the host passed no functions', async () => {
    const progress: unknown[] = []
    on('fernfly:values', (e) => e.detail.respondWith(e.detail.query === 'sam' ? [{ id: 'u2', label: 'Sam Lee' }] : []))
    on('fernfly:preview', (e) => e.detail.respondWith({ count: 2, summary: `2 items for ${e.detail.args.assignee}` }))
    on('fernfly:run', (e) => {
      e.detail.progress(1, 2)
      progress.push(e.detail.args)
      e.detail.respondWith({ message: 'Moved 2 items' })
    })
    const t = transport({ calls: [{ name: 'move', arguments: { assignee: 'sam' } }], log_ref: 'r' })
    const user = await ask(
      { transport: t, hotkey: false, tools: { move: { label: 'Move', args: { assignee: { label: 'to', entity: 'member' } } } } },
      'move my work to sam',
    )
    await waitFor(() => expect(shadow().querySelector('.result-line')?.textContent).toBe('2 items for u2'))
    expect(chip('assignee').textContent).toBe('toSam Lee')
    await user.click(primary())
    await user.click(primary())
    await bar().findByText('Moved 2 items')
    expect(progress).toEqual([{ assignee: 'u2' }])
  })

  it('reaches a tool the host never listed, and says so when nothing answers', async () => {
    const t = transport({ calls: [{ name: 'archive_cycles', arguments: {} }], log_ref: 'r' })
    const user = await ask({ transport: t, hotkey: false }, 'archive old cycles now')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    expect(shadow().querySelector('.confirm-title')?.textContent).toBe('Run archive_cycles?')
    await user.click(primary())
    await bar().findByText("This app hasn't connected that yet.")
  })

  it('passes the words through when no lookup answers', async () => {
    const run = vi.fn()
    on('fernfly:run', (e) => {
      run(e.detail.args)
      e.detail.respondWith(undefined)
    })
    const t = transport({ calls: [{ name: 'list', arguments: { assignee: 'priya' } }], log_ref: 'r' })
    const user = await ask({ transport: t, hotkey: false, tools: { list: { kind: 'filter', args: { assignee: { entity: 'member' } } } } }, 'work for priya now')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    expect(run).toHaveBeenCalledWith({ assignee: 'priya' })
  })

  it('lists the rows a filter’s run answers with', async () => {
    on('fernfly:run', (e) => e.detail.respondWith({ items: [{ label: 'Fix login', href: '#/items/1' }] }))
    const navigate = vi.fn()
    const t = transport({ calls: [{ name: 'list', arguments: {} }], log_ref: 'r' })
    const user = await ask({ transport: t, hotkey: false, navigate, tools: { list: { kind: 'filter' } } }, 'unassigned bugs this cycle')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    await user.click(await bar().findByRole('option', { name: 'Fix login' }))
    expect(navigate).toHaveBeenCalledWith('#/items/1')
  })

  it('uses the host’s own functions over events', async () => {
    const heard = vi.fn()
    on('fernfly:run', heard)
    const own = vi.fn()
    const t = transport({ calls: [{ name: 'list', arguments: {} }], log_ref: 'r' })
    const user = await ask({ transport: t, hotkey: false, tools: { list: { kind: 'filter', run: own } } }, 'list it all now')
    await waitFor(() => expect(primary().disabled).toBe(false))
    await user.click(primary())
    expect(own).toHaveBeenCalledTimes(1)
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('optionsFromScript', () => {
  const tag = (attrs: Record<string, string>) => {
    const script = document.createElement('script')
    for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value)
    return script
  }

  it('reads the install options from data attributes', () => {
    expect(optionsFromScript(tag({ 'data-project': 'p1', 'data-app-name': 'Acme', 'data-attach': '#q', 'data-launcher': '' }))).toEqual({
      project: 'p1',
      endpoint: undefined,
      appName: 'Acme',
      hotkey: 'mod+k',
      attach: '#q',
      launcher: true,
    })
    expect(optionsFromScript(tag({ 'data-endpoint': '/api/fernfly', 'data-hotkey': 'false' }))).toMatchObject({ endpoint: '/api/fernfly', hotkey: false, launcher: false })
    expect(optionsFromScript(tag({ 'data-project': 'p1', 'data-hotkey': '/', 'data-hotkey-takeover': '' }))?.hotkey).toEqual({ keys: '/', takeOver: true })
  })

  it('mounts nothing without a project or an endpoint', () => {
    expect(optionsFromScript(tag({ 'data-app-name': 'Acme' }))).toBeNull()
    expect(optionsFromScript(null)).toBeNull()
  })
})
