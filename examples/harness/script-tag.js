/**
 * The host side of the script-tag page. It answers the bar's events for the
 * fake `update_work_items` tool and calls nothing on `FernflyIntentBar`, so
 * any other tool goes unanswered.
 */
;(() => {
  const events = { previews: 0, runs: [] }
  window.hostEvents = events
  const items = ['Fix login redirect', 'Rate limit the export', 'Empty state for views']

  /** Shows something the page did in the on-screen log. */
  function note(what) {
    const li = document.createElement('li')
    li.textContent = what
    document.getElementById('log').append(li)
  }

  addEventListener('fernfly:preview', (e) => {
    if (e.detail.tool !== 'update_work_items') return
    events.previews++
    const { state, assignee } = e.detail.args
    e.detail.respondWith({
      count: items.length,
      summary: `Move ${items.length} ${state} items to ${assignee}`,
      sample: items,
      confirmLabel: `Move ${items.length}`,
    })
  })

  addEventListener('fernfly:run', (e) => {
    if (e.detail.tool !== 'update_work_items') return
    const { args, progress } = e.detail
    e.detail.respondWith(
      (async () => {
        for (let done = 1; done <= items.length; done++) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          progress(done, items.length)
        }
        events.runs.push(args)
        note(`ran update_work_items: ${JSON.stringify(args)}`)
        return { message: `Moved ${items.length} items` }
      })(),
    )
  })

  window.harnessReady = true
})()
