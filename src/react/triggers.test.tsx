import { act, cleanup, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '../core/types'
import { useIntentBar } from './controller'
import { IntentBar, type IntentBarProps } from './IntentBar'

const host = () => document.querySelector('fernfly-intent-bar') as HTMLElement
const shadow = () => host().shadowRoot as ShadowRoot
const bar = () => within(shadow() as unknown as HTMLElement)
const isOpen = () => shadow().querySelector('.overlay') !== null
const input = () => shadow().querySelector('[cmdk-input]') as HTMLInputElement

function transport() {
  return { infer: vi.fn<Transport['infer']>(async () => ({ calls: [{ name: 'list', arguments: {} }], log_ref: 'r' })) }
}

function renderBar(props: Partial<IntentBarProps> = {}) {
  const t = transport()
  render(<IntentBar transport={t} pages={[{ label: 'Projects', href: '/projects' }]} hotkey="ctrl+k" {...props} />)
  return t
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('hotkey takeover', () => {
  it('gives way to a host palette on the same key by default', async () => {
    const user = userEvent.setup()
    const paletteOpens = vi.fn()
    const palette = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'k') return
      e.preventDefault()
      paletteOpens()
    }
    document.addEventListener('keydown', palette)
    renderBar()
    await user.keyboard('{Control>}k{/Control}')
    document.removeEventListener('keydown', palette)
    expect(paletteOpens).toHaveBeenCalledTimes(1)
    expect(isOpen()).toBe(false)
  })

  it('takes the key first when asked, so the host palette never sees it, and closes on it too', async () => {
    const user = userEvent.setup()
    const paletteOpens = vi.fn()
    const palette = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'k') return
      e.preventDefault()
      paletteOpens()
    }
    document.addEventListener('keydown', palette)
    renderBar({ hotkey: { keys: 'ctrl+k', takeOver: true } })
    await user.keyboard('{Control>}k{/Control}')
    expect(isOpen()).toBe(true)
    await user.keyboard('{Control>}k{/Control}')
    document.removeEventListener('keydown', palette)
    expect(isOpen()).toBe(false)
    expect(paletteOpens).not.toHaveBeenCalled()
  })
})

describe('useIntentBar', () => {
  function Buttons() {
    const intent = useIntentBar()
    return (
      <>
        <button onClick={() => intent.open()}>plain</button>
        <button onClick={() => intent.open({ query: 'proj' })}>query</button>
        <button onClick={() => intent.open({ query: 'all my open work', ask: true })}>ask</button>
      </>
    )
  }

  it('opens the bar from anywhere in the app, with or without text', async () => {
    const user = userEvent.setup()
    const t = transport()
    render(
      <>
        <Buttons />
        <IntentBar transport={t} pages={[{ label: 'Projects', href: '/projects' }]} hotkey={false} />
      </>,
    )
    await user.click(document.querySelector('button')!)
    expect(isOpen()).toBe(true)
    expect(input().value).toBe('')
    await act(async () => useIntentBar().close())
    expect(isOpen()).toBe(false)

    await user.click([...document.querySelectorAll('button')][1]!)
    expect(input().value).toBe('proj')
    expect(bar().getAllByRole('option').map((o) => o.textContent)).toEqual(['Projects'])
    await act(async () => useIntentBar().close())

    await user.click([...document.querySelectorAll('button')][2]!)
    await bar().findByRole('group', { name: 'Your request' })
    expect(t.infer).toHaveBeenCalledWith({ utterance: 'all my open work', meta: { source: 'intent-bar' } })
  })

  it('starts fresh on a plain open after an open with text', async () => {
    const user = userEvent.setup()
    renderBar()
    await act(async () => useIntentBar().open({ query: 'proj' }))
    await user.keyboard('{Escape}')
    await user.keyboard('{Control>}k{/Control}')
    expect(input().value).toBe('')
  })
})

describe('attach', () => {
  it('opens with the field’s text on focus, and returns focus without reopening', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<input id="search" value="proj">'
    renderBar({ attach: '#search' })
    const field = document.getElementById('search') as HTMLInputElement
    await user.click(field)
    expect(isOpen()).toBe(true)
    expect(input().value).toBe('proj')
    await user.keyboard('{Escape}')
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(field)
  })

  it('reopens on a click right after closing, which only the returning focus must not do', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<input id="search">'
    renderBar({ attach: '#search' })
    const field = document.getElementById('search') as HTMLInputElement
    await user.click(field)
    await user.keyboard('{Escape}')
    expect(isOpen()).toBe(false)
    await user.click(field)
    expect(isOpen()).toBe(true)
  })

  it('asks the model when Enter is pressed on a sentence in the field', async () => {
    document.body.innerHTML = '<form><input id="search"></form>'
    const t = renderBar({ attach: '#search' })
    const field = document.getElementById('search') as HTMLInputElement
    field.value = 'backlog for priya'
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    field.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    await bar().findByRole('group', { name: 'Your request' })
    expect(t.infer).toHaveBeenCalledWith({ utterance: 'backlog for priya', meta: { source: 'intent-bar' } })
  })
})

describe('launcher', () => {
  it('is off by default', () => {
    renderBar()
    expect(shadow().querySelector('.launcher')).toBeNull()
  })

  it('opens the bar and shows the hotkey, and hides while the bar is open', async () => {
    const user = userEvent.setup()
    renderBar({ launcher: true })
    const launcher = await bar().findByRole('button', { name: /^Ask/ })
    expect(launcher.querySelector('kbd')?.textContent).toMatch(/K$/)
    await user.click(launcher)
    expect(isOpen()).toBe(true)
    expect(shadow().querySelector('.launcher')).toBeNull()
  })
})
