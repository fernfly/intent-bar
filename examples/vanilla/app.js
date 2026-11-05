/**
 * A small task list that uses the intent bar's script-tag build.
 *
 * The model is mocked so the page runs with no network. In your app, drop
 * `transport` and pass `project: 'YOUR_PUBLIC_ID'` instead, or install the
 * bar with the script tag's `data-project` attribute and no `init()` call.
 *
 * Tools can be handled two ways, and this page shows both. `filter_tasks`
 * passes its functions to `init()`. `complete_tasks` has none, so the bar
 * asks for it through `fernfly:preview` and `fernfly:run` events, which is
 * how a page with only the script tag would answer.
 */
;(() => {
  const people = [
    { id: 'ana', label: 'Ana Silva' },
    { id: 'ben-o', label: 'Ben Okafor', detail: 'Design' },
    { id: 'ben-c', label: 'Ben Cho', detail: 'Support' },
    { id: 'you', label: 'You' },
  ]
  const tasks = [
    { title: 'Write the launch post', status: 'open', assignee: 'ana', due: 'this_week' },
    { title: 'Review the pricing page', status: 'open', assignee: 'ana', due: 'later' },
    { title: 'Fix the signup email', status: 'open', assignee: 'ben-o', due: 'today' },
    { title: 'Answer the backlog of tickets', status: 'open', assignee: 'ben-c', due: 'this_week' },
    { title: 'Plan the team offsite', status: 'open', assignee: 'you', due: 'later' },
    { title: 'Update the roadmap', status: 'done', assignee: 'you', due: 'today' },
  ]
  const DUE = { today: 'today', this_week: 'this week', later: 'later' }
  let filter = { status: 'open' }

  /** Whether a task matches a set of arguments. An argument left out matches everything. */
  const matches = (task, args) => Object.entries(args).every(([name, value]) => task[name] === value)

  /** Shows the tasks the current filter matches. */
  function render() {
    const shown = tasks.filter((task) => matches(task, filter))
    const who = people.find((p) => p.id === filter.assignee)?.label
    document.getElementById('summary').textContent =
      `${shown.length} ${filter.status ?? ''} task${shown.length === 1 ? '' : 's'}${who ? ` for ${who}` : ''}`.replace(/\s+/g, ' ')
    document.getElementById('tasks').replaceChildren(
      ...shown.map((task) => {
        const li = document.createElement('li')
        li.dataset.status = task.status
        const title = document.createElement('span')
        title.textContent = task.title
        const meta = document.createElement('span')
        meta.className = 'meta'
        meta.textContent = `${people.find((p) => p.id === task.assignee)?.label}, ${DUE[task.due]}`
        li.append(title, meta)
        return li
      }),
    )
  }

  /** A stand-in for Fernfly's model: a few patterns, enough to try the bar. */
  const mockModel = {
    async infer({ utterance }) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      const text = utterance.toLowerCase()
      if (/weather|joke/.test(text)) return { calls: [], out_of_scope: true, log_ref: 'mock' }
      const args = {}
      const who = /\bfor (\w+)/.exec(text)?.[1] ?? /\b(\w+)'s\b/.exec(text)?.[1]
      if (who) args.assignee = who
      if (/\bmy\b/.test(text)) args.assignee = 'current'
      if (/this week/.test(text)) args.due = 'this_week'
      if (/today/.test(text)) args.due = 'today'
      if (/\b(complete|finish)\b/.test(text)) return { calls: [{ name: 'complete_tasks', arguments: args }], latency_ms: 40, log_ref: 'mock' }
      return { calls: [{ name: 'filter_tasks', arguments: { status: /\bdone\b/.test(text) ? 'done' : 'open', ...args } }], latency_ms: 40, log_ref: 'mock' }
    },
    async correct(correction) {
      console.info('The correction the bar would send to Fernfly:', correction)
    },
  }

  const assignee = { label: 'assignee', entity: 'person' }
  const due = { label: 'due', enum: Object.keys(DUE), optionLabels: DUE }

  window.FernflyIntentBar.init({
    transport: mockModel,
    appName: 'Tasks',
    attach: '#search',
    context: () => ({ current: { person: people.find((p) => p.id === 'you') } }),
    values: {
      person: (query) => people.filter((p) => p.label.toLowerCase().includes(query.toLowerCase())),
    },
    tools: {
      filter_tasks: {
        kind: 'filter',
        label: 'Tasks',
        examples: ['open tasks for ana', 'tasks for ben due this week'],
        args: { status: { label: 'status', enum: ['open', 'done'] }, assignee, due },
        preview: (args) => {
          const count = tasks.filter((task) => matches(task, args)).length
          return { count, summary: `${count} task${count === 1 ? '' : 's'}` }
        },
        run: (args) => {
          filter = args
          render()
        },
      },
      complete_tasks: {
        label: 'Complete tasks',
        examples: ["complete ana's tasks"],
        args: { assignee, due },
      },
    },
  })

  /** The open tasks `complete_tasks` would complete. */
  const toComplete = (args) => tasks.filter((task) => task.status === 'open' && matches(task, args))

  addEventListener('fernfly:preview', (e) => {
    if (e.detail.tool !== 'complete_tasks') return
    const found = toComplete(e.detail.args)
    e.detail.respondWith({
      count: found.length,
      summary: `Complete ${found.length} task${found.length === 1 ? '' : 's'}`,
      sample: found.slice(0, 3).map((task) => task.title),
      undoable: true,
      confirmLabel: `Complete ${found.length}`,
    })
  })

  addEventListener('fernfly:run', (e) => {
    if (e.detail.tool !== 'complete_tasks') return
    const done = toComplete(e.detail.args)
    for (const task of done) task.status = 'done'
    render()
    e.detail.respondWith({
      message: `Completed ${done.length} task${done.length === 1 ? '' : 's'}`,
      undo: () => {
        for (const task of done) task.status = 'open'
        render()
      },
    })
  })

  render()
})()
