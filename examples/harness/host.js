/**
 * The host page's side of the harness. It copies the hazards Plane puts in
 * the bar's way: a ⌘K palette of its own, single-key shortcuts and a `g p`
 * sequence bound on `document` behind Plane's own "ignore while typing" guard,
 * and dark mode switched by a class and `data-theme`. It then mounts the bar
 * from the script-tag build (`?mode=script`) or a React host app (default).
 *
 * Query params: `mode=react|script`, `vars=propel|propel-custom|plane|shadcn`,
 * `dark=1`, `palette=off` (the page ignores ⌘K), `hotkey=<spec>`.
 */
;(() => {
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode') === 'script' ? 'script' : 'react'
  const paletteOn = params.get('palette') !== 'off'
  const html = document.documentElement
  const events = { shortcuts: [], navigations: [], paletteOpens: 0, reactKeydowns: 0, inferCalls: 0 }
  window.hostEvents = events

  /** Records something the page did, on screen and in `window.hostEvents`. */
  function fire(what) {
    events.shortcuts.push(what)
    const li = document.createElement('li')
    li.textContent = what
    document.getElementById('log').append(li)
  }

  /** Sets dark mode both ways Plane and shadcn read it. */
  function setDark(dark) {
    html.classList.toggle('dark', dark)
    if (dark) html.setAttribute('data-theme', 'dark')
    else html.removeAttribute('data-theme')
  }
  window.setDark = setDark

  /** Mirrors Plane's "ignore while typing" guard. It sees only `e.target`, which shadow DOM retargets to the host. */
  function isTypingInInput(target) {
    if (!(target instanceof Element)) return false
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
      return true
    if (target instanceof HTMLElement && target.isContentEditable) return true
    const role = target.getAttribute('role')
    if (role && ['textbox', 'searchbox', 'combobox', 'listbox', 'option', 'menu', 'menuitem'].includes(role)) return true
    return target.closest('[role="dialog"], [role="menu"], [role="listbox"], .ProseMirror') !== null
  }

  const palette = document.getElementById('palette')
  const paletteInput = document.getElementById('palette-input')

  /** Opens or closes the page's own palette. */
  function togglePalette(open = palette.hidden) {
    palette.hidden = !open
    if (open) {
      events.paletteOpens++
      paletteInput.focus()
    }
  }
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') togglePalette(false)
  })

  let sequence = ''
  let sequenceTimer
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (!paletteOn) return
      e.preventDefault()
      togglePalette()
      return
    }
    if (e.defaultPrevented || isTypingInInput(e.target)) {
      sequence = ''
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
    sequence += e.key.toLowerCase()
    clearTimeout(sequenceTimer)
    if (sequence === 'gp') {
      fire('g p: go to projects')
      sequence = ''
    } else if (sequence === 'g') {
      sequenceTimer = setTimeout(() => (sequence = ''), 1000)
    } else {
      if (sequence === 'c') fire('c: create work item')
      sequence = ''
    }
  })

  /** Stands in for the infer endpoint: one call for any sentence, out of scope for weather. */
  async function fakeTransport({ utterance }) {
    events.inferCalls++
    await new Promise((resolve) => setTimeout(resolve, 120))
    if (/weather/i.test(utterance)) {
      return { calls: [], out_of_scope: true, reply: 'That is not something Plane can do.', log_ref: 'fake' }
    }
    const assignee = /for (\w+)/i.exec(utterance)?.[1] ?? 'me'
    return {
      calls: [{ name: 'list_work_items', arguments: { state: 'backlog', priority: 'high', assignee } }],
      latency_ms: 84,
      log_ref: 'fake',
    }
  }

  const pageNames = [
    'Projects', 'Cycles', 'Modules', 'Views', 'Pages', 'Inbox', 'Analytics', 'Settings', 'Members', 'Labels',
    'States', 'Estimates', 'Integrations', 'Webhooks', 'API tokens', 'Billing', 'Profile', 'Notifications',
    'Archives', 'Drafts',
  ]

  window.harness = {
    transport: fakeTransport,
    hotkey: params.get('hotkey') ?? 'mod+k',
    pages: pageNames.map((label) => ({ label, href: `#/${label.toLowerCase().replace(/\s+/g, '-')}` })),
    tools: {
      list_work_items: {
        label: 'Work items',
        args: {
          state: { label: 'state', enum: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] },
          priority: { label: 'priority', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
          assignee: { label: 'assignee' },
        },
      },
    },
    navigate: (href) => {
      events.navigations.push(href)
      location.hash = href.slice(1)
    },
  }

  html.dataset.vars = params.get('vars') ?? 'propel'
  setDark(params.get('dark') === '1')
  const varsSelect = document.getElementById('vars')
  varsSelect.value = html.dataset.vars
  varsSelect.addEventListener('change', () => (html.dataset.vars = varsSelect.value))
  document.getElementById('dark').addEventListener('click', () => setDark(!html.classList.contains('dark')))
  document.getElementById('mode').textContent = `mode: ${mode}, page palette: ${paletteOn ? 'on' : 'off'}`

  const script = document.createElement('script')
  if (mode === 'script') {
    script.src = '/dist/intent-bar.global.js'
    script.addEventListener('load', () => {
      const { transport, hotkey, pages, tools, navigate } = window.harness
      window.FernflyIntentBar.init({ transport, hotkey, pages, tools, navigate })
      window.harnessReady = true
    })
    document.getElementById('open-bar').addEventListener('click', () => window.FernflyIntentBar.open())
  } else {
    script.type = 'module'
    script.src = './.build/react-app.js'
    document.getElementById('open-bar').addEventListener('click', () => dispatchEvent(new Event('harness:open')))
  }
  document.head.append(script)
})()
