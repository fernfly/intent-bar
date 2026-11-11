/**
 * Browser smoke test for the harness. Drives Chromium through both ways of
 * mounting the bar (React portal, script tag) and prints one line per check;
 * exits non-zero if any fails.
 *
 * Run `npm run build` first. Uses playwright-core's own Chromium unless
 * CHROMIUM_PATH is set, and writes screenshots to SMOKE_OUT (default
 * examples/harness/.build).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { fakeApi, serve } from './serve.mjs'

const port = Number(process.env.SMOKE_PORT ?? 4320)
const out = process.env.SMOKE_OUT ?? fileURLToPath(new URL('./.build/', import.meta.url))
const MODES = ['react', 'script']
const VARS = {
  propel: 'var(--brand-default)',
  'propel-custom': 'var(--brand-default)',
  plane: 'rgb(var(--color-primary-100))',
  shadcn: 'hsl(var(--primary))',
}

/** In-page helpers, installed before the page's own scripts. */
function installHelpers() {
  window.cspViolations = []
  document.addEventListener('securitypolicyviolation', (e) => window.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`))
  const host = () => document.querySelector('fernfly-intent-bar')
  const lum = (color) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return +(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(3)
  }
  window.t = {
    q: (selector) => host()?.shadowRoot?.querySelector(selector) ?? null,
    text: (selector) => host()?.shadowRoot?.querySelector(selector)?.textContent ?? null,
    isOpen: () => !!host()?.shadowRoot?.querySelector('.overlay'),
    input: () => host().shadowRoot.querySelector('.panel > [cmdk-root] > [cmdk-input]'),
    active() {
      const el = host()?.shadowRoot?.activeElement
      if (!el) return null
      if (el.hasAttribute('cmdk-input')) return el.closest('.picker') ? `picker:${el.placeholder}` : 'input'
      return el.dataset.arg ? `chip:${el.dataset.arg}` : el.dataset.role ? `chip:${el.dataset.role}` : el.tagName
    },
    pageActive: () => document.activeElement?.id || document.activeElement?.tagName,
    theme() {
      const panel = host().shadowRoot.querySelector('.panel')
      const style = getComputedStyle(panel)
      return {
        scheme: host().dataset.scheme,
        accent: host().style.getPropertyValue('--fb-accent'),
        surface: host().style.getPropertyValue('--fb-surface'),
        panelLum: lum(style.backgroundColor),
        textLum: lum(style.color),
        accentLum: lum(getComputedStyle(host()).getPropertyValue('--fb-accent')),
        fontMatches: style.fontFamily === getComputedStyle(document.body).fontFamily,
      }
    },
  }
}

const results = []

/** Records one check. */
function check(mode, name, ok, detail = '') {
  results.push({ mode, name, ok: Boolean(ok), detail })
}

/** Opens the harness in a fresh page and waits for the bar's host element. */
async function openPage(browser, mode, query = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`))
  await page.addInitScript(installHelpers)
  await page.goto(`http://127.0.0.1:${port}/examples/harness/?mode=${mode}${query}`)
  await page.waitForFunction(() => window.harnessReady && document.querySelector('fernfly-intent-bar'))
  const t = (fn, arg) => page.evaluate(fn, arg)
  return {
    page,
    errors,
    t,
    events: () => t(() => window.hostEvents),
    reset: () =>
      t(() =>
        Object.assign(window.hostEvents, { shortcuts: [], navigations: [], paletteOpens: 0, reactKeydowns: 0, inferCalls: 0, corrections: [], runs: [], undos: 0 }),
      ),
    isOpen: () => t(() => window.t.isOpen()),
    active: () => t(() => window.t.active()),
    pageActive: () => t(() => window.t.pageActive()),
    openBar: async () => {
      await t((m) => (m === 'script' ? window.FernflyIntentBar.open() : dispatchEvent(new Event('harness:open'))), mode)
      await page.waitForFunction(() => window.t.isOpen())
    },
    value: () => t(() => window.t.input().value),
    ask: async (sentence) => {
      await page.keyboard.type(sentence)
      await page.keyboard.press('Enter')
    },
    runnable: () => page.waitForFunction(() => window.t.q('button.primary')?.disabled === false),
  }
}

/** The checks with the page's own ⌘K palette on, as in Plane today. */
async function withPagePalette(browser, mode) {
  const h = await openPage(browser, mode)
  const { page } = h

  await page.keyboard.press('c')
  await page.keyboard.press('g')
  await page.keyboard.press('p')
  let ev = await h.events()
  check(mode, 'control: page shortcuts fire while the bar is closed', ev.shortcuts.length === 2, ev.shortcuts.join(', '))

  await h.reset()
  await page.keyboard.press('ControlOrMeta+k')
  ev = await h.events()
  check(mode, '⌘K on the page opens the page palette, not the bar', ev.paletteOpens === 1 && !(await h.isOpen()))
  await page.keyboard.press('Escape')

  await page.locator('#page-search').focus()
  await h.openBar()
  check(mode, 'opening focuses the bar input', (await h.active()) === 'input')
  await h.reset()
  await page.keyboard.type('c g p create')
  ev = await h.events()
  check(
    mode,
    'typing in the bar fires no page shortcut and no React ancestor handler',
    ev.shortcuts.length === 0 && ev.paletteOpens === 0 && ev.reactKeydowns === 0 && (await h.value()) === 'c g p create',
    `shortcuts=${ev.shortcuts.length} palette=${ev.paletteOpens} reactKeydowns=${ev.reactKeydowns} value="${await h.value()}"`,
  )

  await page.keyboard.press('ControlOrMeta+k')
  ev = await h.events()
  check(mode, '⌘K inside the bar closes it without reaching the page', !(await h.isOpen()) && ev.paletteOpens === 0)
  check(mode, 'focus returns to the page field after closing', (await h.pageActive()) === 'page-search', await h.pageActive())

  await h.openBar()
  await page.keyboard.press('Escape')
  check(mode, 'Escape closes and focus returns to the page field', !(await h.isOpen()) && (await h.pageActive()) === 'page-search')

  await h.openBar()
  await page.keyboard.type('pro')
  await page.locator('.footer').click()
  const afterFooter = await h.active()
  await page.locator('[cmdk-group-heading]', { hasText: 'Pages' }).click()
  const afterHeading = await h.active()
  await page.keyboard.type('j')
  check(
    mode,
    'clicks on non-focusable parts keep focus in the input',
    afterFooter === 'input' && afterHeading === 'input' && (await h.value()) === 'proj',
    `${afterFooter}, ${afterHeading}, "${await h.value()}"`,
  )

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => document.querySelector('fernfly-intent-bar').shadowRoot.querySelectorAll('[cmdk-item]').length === 23)
  await page.mouse.move(5, 5)
  const selected = () =>
    h.t(() => {
      const root = document.querySelector('fernfly-intent-bar').shadowRoot
      const list = root.querySelector('[cmdk-list]').getBoundingClientRect()
      const item = root.querySelector('[cmdk-item][data-selected="true"]')
      const box = item.getBoundingClientRect()
      return { index: [...root.querySelectorAll('[cmdk-item]')].indexOf(item), visible: box.top >= list.top && box.bottom <= list.bottom }
    })
  const trail = [(await selected()).index]
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowDown')
    trail.push((await selected()).index)
  }
  const scroll = await selected()
  check(mode, 'arrow keys scroll the selected item into view', scroll.visible && scroll.index === 15, `visible=${scroll.visible} trail ${trail.join(' ')}`)

  await page.keyboard.type('backlog items for priya')
  const askFirst = await h.t(() => document.querySelector('fernfly-intent-bar').shadowRoot.querySelector('[cmdk-item][data-selected="true"]')?.textContent)
  await page.keyboard.press('Enter')
  await page.locator('.chips').waitFor()
  check(mode, 'Ask is pinned first and Enter sends the sentence', askFirst === 'Askbacklog items for priya' && (await h.events()).inferCalls === 1, askFirst)

  await h.runnable()
  const order = []
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab')
    order.push(await h.active())
  }
  await page.keyboard.press('Shift+Tab')
  order.push(await h.active())
  const hostKeptFocus = await h.t(() => document.activeElement?.tagName === 'FERNFLY-INTENT-BAR')
  check(
    mode,
    'Tab moves through the chips and buttons and wraps, never leaving the bar',
    order.join(' ') === 'chip:tool chip:state chip:priority chip:assignee chip:add BUTTON input BUTTON' && hostKeptFocus,
    order.join(' '),
  )

  await page.locator('[data-arg="state"]').focus()
  await page.keyboard.press('Enter')
  const inPicker = await h.active()
  await page.keyboard.type('done')
  await page.keyboard.press('Enter')
  const stateText = await page.locator('[data-arg="state"]').textContent()
  check(mode, 'a chip dropdown (second Command) picks a value', inPicker === 'picker:state' && stateText === 'statedone' && (await h.active()) === 'chip:state', `${inPicker}, ${stateText}`)

  await page.locator('[data-arg="priority"]').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  check(
    mode,
    'Escape in a chip dropdown closes only the dropdown',
    (await h.isOpen()) && (await page.locator('.picker').count()) === 0 && (await h.active()) === 'chip:priority',
  )

  if (mode === 'react') await page.screenshot({ path: join(out, 'propel-light-chips.png') })

  await page.locator('.panel > [cmdk-root] > [cmdk-input]').focus()
  const ime = await h.t(() => {
    const input = window.t.input()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, composed: true, cancelable: true }))
    const openAfterEscape = window.t.isOpen()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true, composed: true, cancelable: true }))
    return { openAfterEscape, activeAfterTab: window.t.active() }
  })
  check(mode, 'Escape and Tab are left to an IME while it composes', ime.openAfterEscape && ime.activeAfterTab === 'input', JSON.stringify(ime))
  await page.keyboard.press('Escape')

  for (const [vars, accent] of Object.entries(VARS)) {
    await h.t((v) => {
      document.documentElement.dataset.vars = v
      window.setDark(false)
    }, vars)
    await h.openBar()
    const light = await h.t(() => window.t.theme())
    await page.keyboard.press('Escape')
    await h.t(() => window.setDark(true))
    await h.openBar()
    const dark = await h.t(() => window.t.theme())
    if (mode === 'react' && vars === 'propel') await page.screenshot({ path: join(out, 'propel-dark.png') })
    if (mode === 'react' && vars === 'shadcn') await page.screenshot({ path: join(out, 'shadcn-dark.png') })
    await h.t(() => window.setDark(false))
    const live = await h.t(() => window.t.theme())
    await page.keyboard.press('Escape')
    check(
      mode,
      `theme (${vars}): accent read, light then dark on reopen, font inherited`,
      light.accent === accent && light.scheme === 'light' && light.panelLum > 0.6 && dark.scheme === 'dark' && dark.panelLum < 0.1 && dark.textLum > 0.5 && light.fontMatches,
      `accent=${light.accent} panel ${light.panelLum}/${dark.panelLum} text ${light.textLum}/${dark.textLum} accentLum ${light.accentLum}/${dark.accentLum}`,
    )
    check(
      mode,
      `theme (${vars}): colours follow a live switch while open`,
      live.panelLum > 0.6 && live.scheme === 'dark',
      `panel ${live.panelLum}, scheme stays ${live.scheme} until the next open`,
    )
  }

  await h.t(() => scrollTo(0, 400))
  await h.openBar()
  await page.mouse.move(30, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(150)
  const locked = await h.t(() => ({ y: scrollY, overflow: document.documentElement.style.overflow }))
  await page.keyboard.press('Escape')
  const unlocked = await h.t(() => document.documentElement.style.overflow)
  check(mode, 'page scroll is locked while open and restored after', locked.y === 400 && locked.overflow === 'hidden' && unlocked === '', JSON.stringify(locked))

  const csp = await h.t(() => window.cspViolations)
  check(mode, 'no CSP violations under a strict policy', csp.length === 0, csp.join('; '))
  check(mode, 'no page errors or console warnings', h.errors.length === 0, h.errors.join(' | ').slice(0, 300))
  await page.close()
}

/** The states past parsing: lookups, corrections, confirm, notices and out of scope. */
async function withStates(browser, mode) {
  const h = await openPage(browser, mode, '&palette=off')
  const { page } = h

  await h.openBar()
  await h.ask('backlog items for sam')
  await page.waitForFunction(() => window.t.q('[data-arg="assignee"]')?.dataset.status === 'choose')
  const blocked = await h.t(() => ({ line: window.t.text('.result-line'), disabled: window.t.q('button.primary').disabled }))
  if (mode === 'react') await page.screenshot({ path: join(out, 'propel-light-choose.png') })
  await page.locator('[data-arg="assignee"]').click()
  await page.locator('.picker [cmdk-item]').first().waitFor()
  const options = await page.locator('.picker [cmdk-item]').allTextContents()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await h.runnable()
  await page.locator('button.primary').click()
  let ev = await h.events()
  check(
    mode,
    'two matches ask for a choice and block the run, and the pick runs without a correction',
    blocked.disabled &&
      blocked.line === 'Choose which assignee you mean.' &&
      options[0] === 'Sam Leesam.lee@example.com' &&
      ev.runs[0]?.args.assignee === 'u-sam-ortiz' &&
      ev.corrections.length === 0 &&
      !(await h.isOpen()),
    `${blocked.line} | ${options.join(', ')} | ran ${JSON.stringify(ev.runs[0]?.args)}`,
  )

  await h.reset()
  await h.openBar()
  await h.ask('backlog items for priya')
  await h.runnable()
  await page.locator('[data-arg="state"]').click()
  await page.keyboard.type('todo')
  await page.keyboard.press('Enter')
  await h.runnable()
  await page.locator('button.primary').click()
  await page.locator('.toast-note').waitFor()
  ev = await h.events()
  check(
    mode,
    'an edited call sends one correction once it runs',
    ev.corrections.length === 1 &&
      ev.corrections[0].log_ref === 'fake-list' &&
      ev.corrections[0].call.arguments.state === 'todo' &&
      ev.runs.length === 1 &&
      (await page.locator('.toast-note').textContent()) === 'Saved as a correction for review',
    JSON.stringify(ev.corrections[0]?.call),
  )

  await h.reset()
  await h.openBar()
  await h.ask('unassigned work items please')
  await page.waitForFunction(() => window.t.text('.result-line') === '2 work items')
  await page.keyboard.press('Enter')
  await page.locator('[cmdk-list][aria-label="Results"] [cmdk-item]').first().waitFor()
  const listed = await h.t(() => ({
    heading: window.t.text('[cmdk-group-heading]'),
    rows: [...window.t.q('[cmdk-list]').querySelectorAll('[cmdk-item]')].map((i) => i.textContent),
    selected: window.t.text('[cmdk-item][data-selected="true"]'),
    focus: window.t.active(),
  }))
  if (mode === 'react') await page.screenshot({ path: join(out, 'propel-light-results.png') })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  ev = await h.events()
  check(
    mode,
    'a filter that returns rows lists them, and Enter opens the selected one',
    listed.heading === '2 work items' &&
      listed.rows.join() === 'Update onboarding copyPLN-6,Triage new signupsPLN-10' &&
      listed.selected === listed.rows[0] &&
      listed.focus === 'input' &&
      ev.navigations.join() === '#/work-items/pln-10' &&
      !(await h.isOpen()),
    `${listed.heading} | ${listed.rows.join(', ')} | selected ${listed.selected} | focus ${listed.focus} | went to ${ev.navigations.join()}`,
  )

  await h.reset()
  await h.openBar()
  await h.ask('move backlog items to sam lee')
  await h.runnable()
  const runLabel = await page.locator('button.primary').textContent()
  await page.keyboard.press('Enter')
  await page.locator('.confirm').waitFor()
  const confirm = await h.t(() => ({
    title: window.t.text('.confirm-title'),
    sample: window.t.q('.sample').children.length,
    undo: window.t.text('.confirm').includes('You can undo this afterwards.'),
    focused: window.t.q('.confirm button.primary') === document.querySelector('fernfly-intent-bar').shadowRoot.activeElement,
  }))
  if (mode === 'react') await page.screenshot({ path: join(out, 'propel-light-confirm.png') })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\d of \d/.test(window.t.text('.toast') ?? ''))
  const progress = await h.t(() => window.t.text('.toast'))
  await page.locator('.toast button').waitFor()
  const done = await h.t(() => window.t.text('.toast'))
  await page.locator('.toast button').click()
  await page.waitForFunction(() => window.hostEvents.undos === 1)
  ev = await h.events()
  check(
    mode,
    'an action confirms, shows progress while it runs, then offers Undo',
    runLabel === 'Assign 6… ↵' &&
      confirm.title === 'Assign 6 work items to Sam Lee' &&
      confirm.sample === 3 &&
      confirm.undo &&
      confirm.focused &&
      ev.runs[0]?.args.set_assignee === 'u-sam-lee' &&
      ev.corrections.length === 0,
    `${runLabel} | ${confirm.title} | ${progress} | ${done}`,
  )

  await h.openBar()
  await h.ask('slow down please now')
  await page.locator('.notice').waitFor()
  const notice = await h.t(() => window.t.text('.notice'))
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('proj')
  const found = await page.locator('[cmdk-item]').allTextContents()
  check(mode, 'a rate limit leaves search working, with a one-line notice', notice === 'Too many requests right now. Search still works.' && found.join() === 'Projects', `${notice} | ${found.join(', ')}`)

  await page.keyboard.press('ControlOrMeta+a')
  await h.ask('what is the weather today')
  await page.locator('.note', { hasText: 'not something' }).waitFor()
  const scope = await h.t(() => ({ note: window.t.text('.note'), footer: window.t.text('.footer') }))
  check(mode, 'out of scope says so, in the app’s name', scope.note === 'That is not something Plane can do.' && scope.footer.startsWith('Saved for review'), scope.note)
  await page.keyboard.press('Escape')

  await h.t(() => (document.getElementById('attached-search').value = 'proj'))
  await page.locator('#attached-search').click()
  await page.waitForFunction(() => window.t.isOpen())
  const carried = await h.value()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check(
    mode,
    'an attached field opens the bar with its text, and gets focus back without reopening',
    carried === 'proj' && !(await h.isOpen()) && (await h.pageActive()) === 'attached-search',
    `"${carried}", focus on ${await h.pageActive()}`,
  )

  check(mode, 'no page errors (states)', h.errors.length === 0, h.errors.join(' | ').slice(0, 300))
  await page.close()
}

/** Hotkey takeover with the page palette on, and the launcher. */
async function withTriggers(browser, mode) {
  const h = await openPage(browser, mode, '&takeover=1')
  await h.page.keyboard.press('ControlOrMeta+k')
  const opened = await h.isOpen()
  await h.page.keyboard.press('ControlOrMeta+k')
  check(
    mode,
    'takeover: ⌘K opens the bar before the page palette sees it, and closes it',
    opened && !(await h.isOpen()) && (await h.events()).paletteOpens === 0,
  )
  await h.page.close()

  const l = await openPage(browser, mode, '&launcher=1&palette=off')
  await l.page.locator('.launcher').waitFor()
  const launcher = await l.t(() => ({ text: window.t.text('.launcher'), accent: document.querySelector('fernfly-intent-bar').style.getPropertyValue('--fb-accent') }))
  await l.page.locator('.launcher').click()
  check(
    mode,
    'launcher: themed from the page, and opens the bar',
    (await l.isOpen()) && launcher.accent === 'var(--brand-default)' && /^Ask.+K$/.test(launcher.text),
    JSON.stringify(launcher),
  )
  check(mode, 'no page errors (triggers)', h.errors.length === 0 && l.errors.length === 0, [...h.errors, ...l.errors].join(' | ').slice(0, 300))
  await l.page.close()
}

/**
 * The install with no JavaScript of the page's: the script tag's data
 * attributes mount the bar, the default transport posts to the fake API,
 * and the page answers the bar's events.
 */
async function withScriptTag(browser) {
  const mode = 'tag'
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`))
  await page.addInitScript(installHelpers)
  fakeApi.requests.length = 0
  await page.goto(`http://127.0.0.1:${port}/examples/harness/script-tag.html`)
  await page.waitForFunction(() => window.harnessReady && document.querySelector('fernfly-intent-bar'))
  const t = (fn, arg) => page.evaluate(fn, arg)
  const runnable = () => page.waitForFunction(() => window.t.q('button.primary')?.disabled === false)
  const ask = async (sentence) => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForFunction(() => window.t.isOpen())
    await page.keyboard.type(sentence)
    await page.keyboard.press('Enter')
    await page.locator('.chips').waitFor()
    await runnable()
  }

  await ask('move backlog for priya')
  const line = await t(() => window.t.text('.result-line'))
  await page.keyboard.press('Enter')
  await page.locator('.confirm').waitFor()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\d of \d/.test(window.t.text('.toast') ?? ''))
  await page.locator('.toast', { hasText: 'Moved 3 items' }).waitFor()
  const infer = fakeApi.requests[0]
  check(
    mode,
    'the tag alone mounts the bar; it asks the endpoint over fetch, and the page answers preview and run events',
    infer?.path === '/fake-api/infer' &&
      infer.body.utterance === 'move backlog for priya' &&
      infer.body.meta?.source === 'intent-bar' &&
      line === 'Move 3 backlog items to priya' &&
      (await t(() => window.hostEvents.runs.length)) === 1,
    `${JSON.stringify(infer?.body)} | ${line}`,
  )

  await ask('move backlog for priya')
  await page.locator('[data-arg="state"]').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('todo')
  await page.keyboard.press('Enter')
  await runnable()
  await page.locator('button.primary').click()
  await page.locator('.confirm').waitFor()
  await page.keyboard.press('Enter')
  await page.locator('.toast-note').waitFor()
  const correction = fakeApi.requests.find((r) => r.path === '/fake-api/corrections')
  check(
    mode,
    'an edited call posts its correction to the endpoint once it runs',
    correction?.body.log_ref === 'api-update' && correction.body.call.arguments.state === 'todo' && correction.body.call.name === 'update_work_items',
    JSON.stringify(correction?.body),
  )

  await ask('archive old cycles now')
  await page.keyboard.press('Enter')
  const title = await t(() => window.t.text('.confirm-title'))
  await page.keyboard.press('Enter')
  await page.locator('.toast', { hasText: "This app hasn't connected that yet." }).waitFor()
  check(mode, 'a tool nothing answers confirms by its name, then says it is not connected', title === 'Run archive_cycles?', title)

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('slow down please now')
  await page.keyboard.press('Enter')
  await page.locator('.notice').waitFor()
  check(mode, 'a 429 from the endpoint leaves search working, with a notice', (await t(() => window.t.text('.notice'))) === 'Too many requests right now. Search still works.')

  const csp = await t(() => window.cspViolations)
  check(mode, 'no CSP violations, fetch included', csp.length === 0, csp.join('; '))
  const unexpected = errors.filter((e) => !/status of 429/.test(e)) // Chrome logs the 429 this page asks for
  check(mode, 'no page errors (script tag only)', unexpected.length === 0, unexpected.join(' | ').slice(0, 300))
  await page.close()
}

/** examples/vanilla, the copyable example: a filter from init(), an action answered through events, and theming. */
async function withVanilla(browser) {
  const mode = 'vanilla'
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`))
  await page.addInitScript(installHelpers)
  await page.goto(`http://127.0.0.1:${port}/examples/vanilla/`)
  await page.waitForFunction(() => document.querySelector('fernfly-intent-bar'))
  const t = (fn, arg) => page.evaluate(fn, arg)
  const list = () => t(() => ({ summary: document.getElementById('summary').textContent, rows: document.querySelectorAll('#tasks li').length }))
  const ask = async (sentence) => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForFunction(() => window.t.isOpen())
    await page.keyboard.type(sentence)
    await page.keyboard.press('Enter')
    await page.locator('.chips').waitFor()
    await page.waitForFunction(() => window.t.q('button.primary')?.disabled === false)
  }

  await ask('open tasks for ana')
  const accent = await t(() => document.querySelector('fernfly-intent-bar').style.getPropertyValue('--fb-accent'))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.t.isOpen())
  const filtered = await list()
  check(
    mode,
    'a filter passed to init() updates the page, and the accent comes from its --brand',
    filtered.summary === '2 open tasks for Ana Silva' && filtered.rows === 2 && accent === 'var(--brand)',
    `${JSON.stringify(filtered)} accent=${accent}`,
  )

  await ask("complete ana's tasks")
  await page.keyboard.press('Enter')
  await page.locator('.confirm').waitFor()
  const title = await t(() => window.t.text('.confirm-title'))
  await page.keyboard.press('Enter')
  await page.locator('.toast button').waitFor()
  const completed = await list()
  await page.locator('.toast button').click()
  await page.waitForFunction(() => document.querySelectorAll('#tasks li').length === 2)
  check(
    mode,
    'an action answered through events confirms, runs and undoes',
    title === 'Complete 2 tasks' && completed.rows === 0,
    `${title} | after run: ${completed.summary}`,
  )

  const csp = await t(() => window.cspViolations)
  check(mode, 'no CSP violations or page errors', csp.length === 0 && errors.length === 0, [...csp, ...errors].join(' | ').slice(0, 300))
  await page.close()
}

/** The checks with the page palette off, so the bar takes ⌘K, as it would if it replaced Power K. */
async function withoutPagePalette(browser, mode) {
  const h = await openPage(browser, mode, '&palette=off')
  const { page } = h
  await page.keyboard.press('ControlOrMeta+k')
  const opened = await h.isOpen()
  await page.keyboard.press('ControlOrMeta+k')
  check(mode, '⌘K opens the bar and, inside it, closes it', opened && !(await h.isOpen()) && (await h.events()).paletteOpens === 0)

  await page.locator('#page-search').focus()
  await page.keyboard.press('ControlOrMeta+k')
  const fromField = await h.isOpen()
  await page.keyboard.press('Escape')
  check(mode, '⌘K opens from a page field, and focus returns to it', fromField && (await h.pageActive()) === 'page-search')
  check(mode, 'no page errors (palette off)', h.errors.length === 0, h.errors.join(' | ').slice(0, 300))
  await page.close()
}

await mkdir(out, { recursive: true })
const server = await serve(port)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const mode of MODES) {
    await withPagePalette(browser, mode)
    await withoutPagePalette(browser, mode)
    await withStates(browser, mode)
    await withTriggers(browser, mode)
  }
  await withScriptTag(browser)
  await withVanilla(browser)
} finally {
  await browser.close()
  server.close()
}

for (const r of results) {
  process.stdout.write(`[${r.mode.padEnd(6)}] ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}\n`)
}
const failed = results.filter((r) => !r.ok).length
process.stdout.write(`\n${results.length - failed}/${results.length} passed. Screenshots in ${out}\n`)
process.exit(failed ? 1 : 0)
