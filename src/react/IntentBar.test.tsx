import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolConfig, Transport } from '../core/types'
import { IntentBar } from './IntentBar'

const tools: Record<string, ToolConfig> = {
  list_issues: {
    label: 'Work items',
    args: { state: { label: 'state', enum: ['backlog', 'todo', 'done'] }, assignee: { label: 'assignee' } },
  },
}
const pages = [
  { label: 'Projects', href: '/projects' },
  { label: 'Cycles', href: '/cycles' },
]

/** A transport that answers every sentence with the same call, after a tick. */
function fakeTransport(): Transport {
  return vi.fn(async () => ({
    calls: [{ name: 'list_issues', arguments: { state: 'backlog', assignee: 'Priya' } }],
    latency_ms: 40,
    log_ref: 'ref',
  }))
}

const host = () => document.querySelector('fernfly-intent-bar') as HTMLElement
const shadow = () => host().shadowRoot as ShadowRoot
const bar = () => within(shadow() as unknown as HTMLElement)
const active = () => shadow().activeElement

/** Renders the bar with a deterministic hotkey and opens it from the page. */
async function openBar(extra: Partial<Parameters<typeof IntentBar>[0]> = {}) {
  const user = userEvent.setup()
  const transport = fakeTransport()
  render(<IntentBar transport={transport} pages={pages} tools={tools} hotkey="ctrl+k" navigate={() => {}} {...extra} />)
  await user.keyboard('{Control>}k{/Control}')
  return { user, transport }
}

/** Types a sentence and asks the model, leaving the parsed chips on screen. */
async function parse(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('backlog for priya')
  await user.keyboard('{Enter}')
  await bar().findByRole('group', { name: 'Parsed request' })
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('IntentBar', () => {
  it('renders in a shadow root with an adopted stylesheet and no style element', () => {
    render(<IntentBar transport={fakeTransport()} hotkey="ctrl+k" />)
    expect(shadow().adoptedStyleSheets).toHaveLength(1)
    expect(document.querySelectorAll('style')).toHaveLength(0)
    expect(shadow().querySelectorAll('style')).toHaveLength(0)
  })

  it('opens on its hotkey, focuses the input and runs the theme step', async () => {
    await openBar()
    expect(bar().getByRole('dialog', { name: 'Intent bar' })).toBeTruthy()
    expect(active()?.hasAttribute('cmdk-input')).toBe(true)
    expect(host().getAttribute('data-scheme')).toMatch(/^(light|dark)$/)
  })

  it('stays shut when the page already handled the hotkey', async () => {
    const pagePalette = vi.fn((e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') e.preventDefault()
    })
    document.addEventListener('keydown', pagePalette)
    await openBar()
    document.removeEventListener('keydown', pagePalette)
    expect(pagePalette).toHaveBeenCalled()
    expect(shadow().querySelector('.overlay')).toBeNull()
  })

  it('keeps typed keys from the page and from the host app’s React tree', async () => {
    const user = userEvent.setup()
    const pageShortcut = vi.fn()
    const reactAncestor = vi.fn()
    render(
      <div onKeyDown={reactAncestor}>
        <IntentBar transport={fakeTransport()} pages={pages} hotkey="ctrl+k" />
      </div>,
    )
    await user.keyboard('{Control>}k{/Control}')
    document.addEventListener('keydown', pageShortcut)
    await user.keyboard('cgp')
    document.removeEventListener('keydown', pageShortcut)
    expect((active() as HTMLInputElement).value).toBe('cgp')
    expect(pageShortcut).not.toHaveBeenCalled()
    expect(reactAncestor).not.toHaveBeenCalled()
  })

  it('closes on its own hotkey from inside, without reaching the page', async () => {
    const pagePalette = vi.fn()
    const { user } = await openBar()
    document.addEventListener('keydown', pagePalette)
    await user.keyboard('{Control>}k{/Control}')
    document.removeEventListener('keydown', pagePalette)
    expect(shadow().querySelector('.overlay')).toBeNull()
    expect(pagePalette).not.toHaveBeenCalled()
  })

  it('closes on Escape and returns focus to where it was', async () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    const { user } = await openBar()
    expect(document.activeElement).toBe(host())
    await user.keyboard('{Escape}')
    expect(shadow().querySelector('.overlay')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('returns focus to the page under StrictMode, which runs the open effect twice', async () => {
    const user = userEvent.setup()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    render(
      <StrictMode>
        <IntentBar transport={fakeTransport()} hotkey="ctrl+k" />
      </StrictMode>,
    )
    await user.keyboard('{Control>}k{/Control}')
    expect(active()?.hasAttribute('cmdk-input')).toBe(true)
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(field)
  })

  it('returns focus into another shadow root', async () => {
    const widget = document.createElement('div')
    document.body.append(widget)
    const inner = document.createElement('button')
    widget.attachShadow({ mode: 'open' }).append(inner)
    inner.focus()
    const { user } = await openBar()
    await user.keyboard('{Escape}')
    expect(widget.shadowRoot?.activeElement).toBe(inner)
  })

  it('leaves Escape to an IME that is composing', async () => {
    await openBar()
    fireEvent.keyDown(active()!, { key: 'Escape', isComposing: true })
    expect(shadow().querySelector('.overlay')).not.toBeNull()
  })

  it('pins Ask first for a sentence and sends it on Enter', async () => {
    const { user, transport } = await openBar()
    await user.keyboard('backlog for priya')
    const options = bar().getAllByRole('option')
    expect(options[0]?.textContent).toBe('Askbacklog for priya')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{Enter}')
    expect(transport).toHaveBeenCalledWith({ utterance: 'backlog for priya' })
    await bar().findByRole('group', { name: 'Parsed request' })
  })

  it('cycles Tab through the input and chips, and wraps both ways', async () => {
    const { user } = await openBar()
    await parse(user)
    const input = active()
    const [tool, state, assignee] = bar().getAllByRole('button')
    await user.keyboard('{Tab}')
    expect(active()).toBe(tool)
    await user.keyboard('{Tab}')
    expect(active()).toBe(state)
    await user.keyboard('{Tab}')
    expect(active()).toBe(assignee)
    await user.keyboard('{Tab}')
    expect(active()).toBe(input)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(active()).toBe(assignee)
  })

  it('opens a chip’s dropdown, which takes Escape before the bar', async () => {
    const { user } = await openBar()
    await parse(user)
    const state = bar().getByRole('button', { name: /state/ })
    state.focus()
    await user.keyboard('{Enter}')
    expect(state.getAttribute('aria-expanded')).toBe('true')
    expect(active()?.getAttribute('placeholder')).toBe('state')
    await user.keyboard('{Tab}')
    expect(active()?.getAttribute('placeholder')).toBe('state')
    await user.keyboard('{Escape}')
    expect(shadow().querySelector('.picker')).toBeNull()
    expect(shadow().querySelector('.overlay')).not.toBeNull()
    expect(active()).toBe(state)
  })

  it('changes a chip’s value from its dropdown', async () => {
    const { user } = await openBar()
    await parse(user)
    const state = bar().getByRole('button', { name: /state/ })
    state.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('done{Enter}')
    expect(state.textContent).toBe('statedone')
    expect(active()).toBe(state)
  })

  it('locks the page scroll while open', async () => {
    const { user } = await openBar()
    expect(document.documentElement.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('removes its host on unmount', () => {
    const { unmount } = render(<IntentBar transport={fakeTransport()} />)
    expect(host()).not.toBeNull()
    unmount()
    expect(host()).toBeNull()
  })
})

describe('the script-tag build', () => {
  it('mounts the same bar, driven by open() and close()', async () => {
    const bar = await import('../global/index')
    await act(async () => bar.init({ transport: fakeTransport(), hotkey: false }))
    expect(host()).not.toBeNull()
    await act(async () => bar.open())
    expect(shadow().querySelector('.overlay')).not.toBeNull()
    await act(async () => bar.close())
    expect(shadow().querySelector('.overlay')).toBeNull()
    await act(async () => bar.destroy())
    expect(host()).toBeNull()
  })
})
