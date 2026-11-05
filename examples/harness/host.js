/**
 * The host page's side of the harness. It copies the hazards Plane puts in
 * the bar's way: a ⌘K palette of its own, single-key shortcuts and a `g p`
 * sequence bound on `document` behind Plane's own "ignore while typing" guard,
 * and dark mode switched by a class and `data-theme`. It then mounts the bar
 * from the script-tag build (`?mode=script`) or a React host app (default).
 *
 * Query params: `mode=react|script`, `vars=propel|propel-custom|plane|shadcn`,
 * `dark=1`, `palette=off` (the page ignores ⌘K), `hotkey=<spec>`,
 * `takeover=1` (the bar takes its hotkey before the page), `launcher=1`.
 *
 * The fake model answers by pattern: "weather" is out of scope, "slow down"
 * is rate limited, "move backlog … to sam lee" is a bulk update that
 * confirms, and anything else lists work items ("… for sam" finds two Sams).
 */
;(() => {
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode') === 'script' ? 'script' : 'react'
  const paletteOn = params.get('palette') !== 'off'
  const html = document.documentElement
  const events = { shortcuts: [], navigations: [], paletteOpens: 0, reactKeydowns: 0, inferCalls: 0, corrections: [], runs: [], undos: 0 }
  window.hostEvents = events

  /** Shows something the page did in the on-screen log. */
  function note(what) {
    const li = document.createElement('li')
    li.textContent = what
    document.getElementById('log').append(li)
  }

  /** Records a page shortcut firing, on screen and in `window.hostEvents`. */
  function fire(what) {
    events.shortcuts.push(what)
    note(what)
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

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const members = [
    { id: 'u-priya', label: 'Priya Shah', detail: 'priya@example.com' },
    { id: 'u-sam-lee', label: 'Sam Lee', detail: 'sam.lee@example.com' },
    { id: 'u-sam-ortiz', label: 'Sam Ortiz', detail: 'sam.ortiz@example.com' },
    { id: 'u-alex', label: 'Alex Kim', detail: 'you' },
  ]
  const cycles = [
    { id: 'c-6', label: 'Cycle 6' },
    { id: 'c-7', label: 'Cycle 7' },
  ]
  const workItems = [
    ['Fix login redirect', 'backlog', 'high', 'u-priya'],
    ['Rate limit the export', 'backlog', 'high', 'u-priya'],
    ['Empty state for views', 'backlog', 'high', 'u-sam-lee'],
    ['Flaky upload test', 'backlog', 'high', 'u-sam-ortiz'],
    ['Dark mode contrast', 'backlog', 'high', 'u-alex'],
    ['Update onboarding copy', 'backlog', 'low', null],
    ['Cycle burndown chart', 'todo', 'high', 'u-priya'],
    ['Webhook retries', 'in_progress', 'urgent', 'u-sam-lee'],
    ['Archive old drafts', 'done', 'medium', 'u-alex'],
  ].map(([title, state, priority, assignee]) => ({ title, state, priority, assignee }))

  /** The work items an argument set matches. An unset argument matches everything, and a null assignee matches the unassigned. */
  const matching = (args) =>
    workItems.filter(
      (w) =>
        (args.state === undefined || w.state === args.state) &&
        (args.priority === undefined || w.priority === args.priority) &&
        (args.assignee === undefined || w.assignee === args.assignee),
    )

  /** Stands in for the infer endpoint, by pattern: weather is out of scope, "slow down" is rate limited, "move … to …" is a bulk update, and anything else lists work items. */
  const transport = {
    async infer({ utterance }) {
      events.inferCalls++
      await sleep(120)
      if (/weather/i.test(utterance)) return { calls: [], out_of_scope: true, reply: 'Out of scope', log_ref: 'fake-oos' }
      if (/slow down/i.test(utterance)) throw Object.assign(new Error('Too many requests'), { reason: 'rate_limited' })
      const move = /move (\w+) .*to ([\w ]+)$/i.exec(utterance)
      if (move) {
        return { calls: [{ name: 'bulk_update_work_items', arguments: { state: move[1], set_assignee: move[2] } }], latency_ms: 91, log_ref: 'fake-move' }
      }
      const assignee = /for (\w+)/i.exec(utterance)?.[1] ?? 'current'
      return { calls: [{ name: 'list_work_items', arguments: { state: 'backlog', priority: 'high', assignee } }], latency_ms: 84, log_ref: 'fake-list' }
    },
    async correct(request) {
      events.corrections.push(request)
      note(`correction sent: ${JSON.stringify(request.call)}`)
    },
  }

  const STATES = { enum: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'], optionLabels: { in_progress: 'in progress' } }

  const pageNames = [
    'Projects', 'Cycles', 'Modules', 'Views', 'Pages', 'Inbox', 'Analytics', 'Settings', 'Members', 'Labels',
    'States', 'Estimates', 'Integrations', 'Webhooks', 'API tokens', 'Billing', 'Profile', 'Notifications',
    'Archives', 'Drafts',
  ]
  const hotkeyKeys = params.get('hotkey') ?? 'mod+k'

  window.harness = {
    transport,
    appName: 'Plane',
    hotkey: params.get('takeover') === '1' ? { keys: hotkeyKeys, takeOver: true } : hotkeyKeys,
    attach: '#attached-search',
    launcher: params.get('launcher') === '1',
    pages: pageNames.map((label) => ({ label, href: `#/${label.toLowerCase().replace(/\s+/g, '-')}` })),
    context: () => ({ current: { member: members[3], cycle: cycles[1] } }),
    values: {
      member: async (q) => {
        await sleep(40)
        return members.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()))
      },
      cycle: (q) => cycles.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    },
    tools: {
      list_work_items: {
        kind: 'filter',
        label: 'Work items',
        examples: ['backlog items for priya', 'urgent work in the current cycle'],
        args: {
          state: { label: 'state', ...STATES },
          priority: { label: 'priority', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
          assignee: { label: 'assignee', entity: 'member' },
          cycle: { label: 'cycle', entity: 'cycle' },
        },
        preview: async (args) => {
          await sleep(60)
          const count = matching(args).length
          return { count, summary: `${count} work item${count === 1 ? '' : 's'}` }
        },
        run: (args, ctx) => {
          events.runs.push({ tool: 'list_work_items', args, raw: ctx.raw })
          note(`ran Work items: ${JSON.stringify(args)}`)
        },
      },
      bulk_update_work_items: {
        label: 'Update work items',
        examples: ['move backlog items to sam lee'],
        args: {
          state: { label: 'state', ...STATES },
          set_assignee: { label: 'assign to', role: 'set', entity: 'member' },
        },
        preview: async (args) => {
          await sleep(60)
          const items = matching({ state: args.state })
          const who = members.find((m) => m.id === args.set_assignee)?.label ?? 'nobody'
          return {
            count: items.length,
            summary: `Assign ${items.length} work items to ${who}`,
            sample: items.slice(0, 3).map((w) => w.title),
            undoable: true,
            confirmLabel: `Assign ${items.length}`,
          }
        },
        run: async (args, ctx) => {
          const items = matching({ state: args.state })
          const before = items.map((w) => w.assignee)
          for (const [i, item] of items.entries()) {
            await sleep(150)
            item.assignee = args.set_assignee
            ctx.progress(i + 1, items.length)
          }
          events.runs.push({ tool: 'bulk_update_work_items', args, raw: ctx.raw })
          note(`ran Update work items: ${JSON.stringify(args)}`)
          return {
            message: `Assigned ${items.length} work items`,
            undo: () => {
              items.forEach((item, i) => (item.assignee = before[i]))
              events.undos++
              note('undo')
            },
          }
        },
      },
    },
    navigate: (href) => {
      events.navigations.push(href)
      note(`went to ${href}`)
      location.hash = href.slice(1)
    },
  }

  html.dataset.vars = params.get('vars') ?? 'propel'
  setDark(params.get('dark') === '1')
  const varsSelect = document.getElementById('vars')
  varsSelect.value = html.dataset.vars
  varsSelect.addEventListener('change', () => (html.dataset.vars = varsSelect.value))
  document.getElementById('dark').addEventListener('click', () => setDark(!html.classList.contains('dark')))
  document.getElementById('mode').textContent = `mode: ${mode}, page palette: ${paletteOn ? 'on' : 'off'}${params.get('takeover') === '1' ? ', takeover' : ''}`

  const script = document.createElement('script')
  if (mode === 'script') {
    script.src = '/dist/intent-bar.global.js'
    script.addEventListener('load', () => {
      window.FernflyIntentBar.init(window.harness)
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
