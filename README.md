# Fernfly intent bar

An intent bar for web apps. A user types what they want, a small model fine-tuned on your app's API turns it into a call, and the bar shows that call as editable chips with a live preview. Your app runs it only after that, and anything that changes data asks first.

```
unpaid invoices over $500 from Europe this quarter

Invoices   status unpaid   total > $500   region Europe, all   issued this quarter
51 invoices                                        [ Email all 51 ]  [ Apply filter ↵ ]
```

- **Your app runs every call**, through your own code and with the signed-in user's permissions. The model only predicts.
- **Short queries search your pages instantly**, with no model call. Sentences go to the model.
- **Fixes teach the model.** When a user corrects a chip before running it, the bar sends the correction to your [Fernfly Studio](https://fernfly.com) project for you to review and retrain on.
- **It looks like your app.** The bar renders in Shadow DOM and takes your app's fonts and colours from its CSS.

It ships as a React component and as a script tag for apps that don't use React.

## Status

Early. The package is on npm, and the API may change before 1.0.

## Install

### React

```bash
npm install @fernfly/intent-bar
```

React 18.2 or later, or React 19, is a peer dependency.

### Script tag

```html
<script
  src="https://cdn.jsdelivr.net/npm/@fernfly/intent-bar@0.1.0/dist/intent-bar.global.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-project="YOUR_PUBLIC_ID"
></script>
```

Pin the version, and copy the `integrity` hash from that version's release notes, which give the whole tag. The file includes React, so the page needs nothing else.

## Quick start

### React

```tsx
'use client'
import { IntentBar } from '@fernfly/intent-bar'

export function AppIntentBar() {
  const router = useRouter()
  return (
    <IntentBar
      project="YOUR_PUBLIC_ID"
      appName="Acme"
      tools={{
        list_invoices: {
          kind: 'filter',
          label: 'Invoices',
          examples: ['unpaid invoices over $500 this quarter'],
          args: {
            status: { label: 'status', enum: ['draft', 'unpaid', 'paid'] },
            customer: { label: 'customer', entity: 'customer' },
            min_total: { label: 'total over', type: 'number' },
          },
          preview: async (args) => {
            const count = await api.countInvoices(args)
            return { count, summary: `${count} invoices` }
          },
          run: (args) => router.push(invoicesUrl(args)),
        },
      }}
      values={{
        customer: async (query) => (await api.searchCustomers(query)).map((c) => ({ id: c.id, label: c.name })),
      }}
    />
  )
}
```

Render it once, inside the signed-in part of your app. It mounts at the end of `<body>` in a shadow root of its own, so where it sits in your tree doesn't affect layout. Render it from a client component, since tools and lookups are functions. The package touches nothing in the page when it's imported, so it's safe in server-rendered apps.

### Script tag

With `data-project` on the tag, the bar mounts as the page loads. Your page answers its events:

```js
addEventListener('fernfly:run', (e) => {
  if (e.detail.tool === 'list_invoices') e.detail.respondWith(showInvoices(e.detail.args))
})
```

Or set it up in JavaScript, with the same options as the React props:

```js
FernflyIntentBar.init({ project: 'YOUR_PUBLIC_ID', appName: 'Acme', tools: { list_invoices: { kind: 'filter', run: showInvoices } } })
```

[`examples/vanilla`](examples/vanilla) is a complete page that does both.

## How it works

1. **Search.** Short queries search your pages and tool names on every keystroke, with no model call. From three words, or when nothing matches, an "Ask" item is pinned first, and Enter sends the sentence to the model.
2. **Chips.** The model's call shows as chips: the tool, then one chip per argument. Lookups turn the user's words into your app's values, and the tool's `preview` counts what the call would touch.
3. **Run.** A filter or a navigation runs on Enter. Anything else confirms first, with the preview's summary and sample rows, then runs with progress, and with Undo when your run returns one. A filter your own list can't show can hand its matching rows back for the bar to list.
4. **Correct.** Tab moves through the chips and Enter opens one, to change its value or remove it. "+ add" adds an argument the model missed, and the tool chip switches tools. Running an edited call sends it to Fernfly as a correction.

The bar's own words are written for the person typing, so they never mention the model or how long it took. While a sentence is being answered, the bar shows "Working on it…", which screen readers announce. The footer reads "Powered by Fernfly", linking to fernfly.com in a new tab, beside the keys for the current step. After a sentence your app can't handle, it adds "Saved for review".

## Connecting to Fernfly

| Prop | Use it for |
|---|---|
| `project` | A project with no API key. The bar calls `https://fernfly.com/api/p/<project>/infer` and `/corrections` from the browser, and Fernfly checks the request's origin against the project's allowed origins, so add your app's origin to the project. |
| `endpoint` | A project with an API key. The bar posts to `<endpoint>/infer` and `<endpoint>/corrections` on your own server, which adds the key, so the key never reaches the browser. |
| `transport` | Tests and demos: `{ infer(request), correct?(request) }` replaces the network. |

A proxy is a few lines. This one is a Next.js route handler:

```ts
// app/api/fernfly/[route]/route.ts
export async function POST(req: Request, ctx: { params: Promise<{ route: string }> }) {
  const { route } = await ctx.params
  if (route !== 'infer' && route !== 'corrections') return new Response(null, { status: 404 })
  // Check your own session here, so only signed-in users spend your quota.
  const upstream = await fetch(`https://fernfly.com/api/p/${process.env.FERNFLY_PROJECT}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.FERNFLY_API_KEY! },
    body: await req.text(),
  })
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } })
}
```

Then pass `endpoint="/api/fernfly"`.

When the bar can't answer a sentence, it says so in one line and search keeps working. "Ask" is styled as the pinned Ask item is:

| When | The bar says |
|---|---|
| The project hits its rate limit | Ask is busy right now. Search still works. |
| The project hits its daily quota | Ask has reached today's limit. Search still works. |
| Fernfly can't be reached, or answers with an error | Ask isn't available right now. Search still works. |

## Tools

Each key of `tools` is a tool name from your Fernfly project.

```ts
tools={{
  bulk_update_issues: {
    label: 'Work items',
    examples: ['move unassigned bugs in this cycle to Priya'],
    args: {
      cycle: { label: 'cycle', entity: 'cycle' },
      assignee: { label: 'assignee', entity: 'member' },
      set_assignee: { label: 'assign to', role: 'set', entity: 'member' },
    },
    preview: async (args) => {
      const items = await api.findIssues(args)
      return { count: items.length, summary: `Assign ${items.length} work items`, sample: items.map((i) => i.title), undoable: true }
    },
    run: async (args, ctx) => {
      const done = await api.assignIssues(args, ctx.progress)
      return { message: `Assigned ${done.length} work items`, undo: () => api.unassign(done) }
    },
  },
}}
```

| Field | What it does |
|---|---|
| `kind` | `'filter'` and `'navigate'` run on Enter. `'action'`, the default, confirms first, so a tool with no kind confirms. |
| `label` | The tool chip's text, and the name instant search finds. A tool with no label isn't in search. |
| `examples` | Sentences shown on the empty bar, up to three across all tools. |
| `args` | How each argument reads and is edited. See below. |
| `preview(args, ctx)` | What the call would touch. It runs whenever the chips change and every value has resolved, and may return nothing. |
| `run(args, ctx)` | Runs the call, and may return `{ message, undo }`. A filter's run may also return `items`, the rows for the bar to list. See [A filter's rows](#a-filters-rows). |
| `confirm` | `false` skips the confirm step for an action, but only when the preview counts one item or fewer. Bulk work always confirms. |

`args` holds the resolved arguments: an entity argument holds the matched value's `id`, or `null` for `none`. `ctx` holds `raw` (the arguments in the user's words, before lookups), `call`, `utterance` and `context`. In `run`, `ctx.progress(done, total)` shows progress while a long run goes.

A call to a tool that `tools` doesn't list, or that has no `run`, can't run, and the bar says "This app hasn't connected that yet." `fallbackTool(name)` returns a config for tools `tools` doesn't list, such as one handler for every tool.

### Arguments

| Field | What it does |
|---|---|
| `label` | The chip's label. Defaults to the argument's name. |
| `role` | `'match'`, the default, picks what the call applies to, and its chip is tinted. `'set'` is what the call will change, and its chip is outlined. |
| `entity` | Workspace data, found through `values[entity]`. See [Lookups](#lookups). |
| `enum` | A fixed list of values, offered when the chip is edited. |
| `optionLabels` | How enum values read, such as `{ in_progress: 'in progress' }`. |
| `type` | `'string'`, `'number'`, `'integer'` or `'boolean'`: what a typed value is converted to. Defaults to the type of the model's value. |

### Preview

| Field | What it does |
|---|---|
| `count` | How many items the call touches. |
| `summary` | One line, such as "Assign 12 work items to Priya", shown under the chips and as the confirm step's title. |
| `sample` | A few rows of what the call touches, shown when confirming. |
| `undoable` | Adds "You can undo this afterwards." to the confirm step. |
| `confirmLabel` | The run button's label. Defaults to "Run". |
| `actions` | More buttons beside the run button, such as "Email all 51": `{ label, summary?, undoable?, run(ctx) }`. They always confirm. |

### A filter's rows

Sometimes your own list can't show a filter, such as "unassigned bugs" in an app whose filters have no "is empty". The filter's `run` can then return the matching rows, and the bar lists them:

```ts
run: async (args) => {
  if (canFilter(args)) return applyFilter(args)
  const issues = await api.findIssues(args)
  return { items: issues.map((i) => ({ label: i.title, detail: i.key, href: `/issues/${i.id}` })) }
},
```

| Field | What it does |
|---|---|
| `label` | The row's text. |
| `detail` | Text beside the label, such as an id or a state. |
| `href` | Where the row goes. Enter or a click passes it to `navigate`. |

The bar stays open while a filter runs. Then it lists the rows under the preview's summary, or their count, with the first one selected: the arrow keys move through them, and Escape closes the bar. An empty list reads "Nothing matches." A run that returns no `items` closes the bar. Only a filter's run lists rows.

## Lookups

For workspace data, such as people, projects or cycles, the model returns the user's words, and `values` finds them in your app:

```ts
values={{
  member: async (query, { context }) =>
    (await api.searchMembers(context.workspace, query)).map((m) => ({ id: m.id, label: m.name, detail: m.email })),
}}
```

One match resolves the chip. Several ask the user to choose, and `detail` tells them apart. None blocks the run until the user picks a value. A lookup can return `null` to let the words through unchanged, and an entity with no lookup does the same.

A lookup also gets `call`, the call as it stands, for a value that belongs to another argument, such as a label in the project the sentence names:

```ts
label: async (query, { call, context }) => {
  const project = await findProject(call.arguments.project ?? 'current', context)
  return (await api.searchLabels(project.id, query)).map((l) => ({ id: l.id, label: l.name }))
},
```

The call's arguments are in the user's words, as the model returned them, so `project` here may be "web" or `current`, or missing. The bar sees which arguments a lookup reads, and runs the lookup again when the user changes one of them. A choice between that lookup's matches holds only while those arguments stay the same.

Two words are reserved for what a model can't know:

- `none` resolves to `null`, as in "unassigned".
- `current` resolves from your `context`, as in "this cycle":

```ts
context={() => ({ current: { cycle: { id: cycle.id, label: cycle.name } }, workspace: slug })}
```

The bar reads `context` whenever it redraws and again for each preview and run, and passes it to lookups and handlers. A `current` your app loads after the bar opens resolves at the next redraw: when the model answers, when the user edits a chip, or when your app renders the bar again. Keep `context` quick and free of side effects, since the bar calls it often.

## Corrections

When a user changes a chip and then runs the call, the bar sends the edited call to your project as a correction and tells the user "Saved as a correction for review". You review corrections in Fernfly Studio, and only you turn one into training data.

| Sent | Not sent |
|---|---|
| A changed value | A pick between two matches for the same words |
| An added or removed argument | An edit the user abandons |
| A switched tool | A call run as the model returned it |
| | A preview action, such as "Email all 51" |

A correction is sent only after the run succeeds.

## Opening the bar

- **Hotkey.** `hotkey` is `'mod+k'` by default, which is ⌘K on Apple platforms and Ctrl+K elsewhere. Any combination works, such as `'ctrl+shift+p'` or `'/'`, or `false` for none. A single-key hotkey doesn't fire while the user types in a field. If your app handles the same key first and calls `preventDefault()`, the bar stays shut. To take the key from your app's own palette instead, pass `hotkey={{ keys: 'mod+k', takeOver: true }}`.
- **From your code.** `useIntentBar().open()` opens it, `open({ query })` starts it with text, and `open({ query, ask: true })` also sends that text to the model. `close()` closes it.
- **Your search field.** `attach="#search"` takes a selector or an element. Focusing or clicking the field opens the bar with its text, and Enter on a sentence in it asks the model straight away.
- **Launcher.** `launcher` adds a floating "Ask" button with the hotkey. It's off by default.
- **Controlled.** `open` and `onOpenChange`, or `defaultOpen`.

The other props are `pages`, the `{ label, href }` pages for instant search, which default to the links in your `<nav>`; `navigate(href)`, which defaults to `location.assign`; `appName`, as in "That is not something {appName} can do"; and `placeholder`.

## The script tag

### Data attributes

| Attribute | What it does |
|---|---|
| `data-project` | The project's public id. |
| `data-endpoint` | Your proxy, instead of `data-project`. |
| `data-app-name` | Your app's name. |
| `data-hotkey` | The hotkey, or `false` for none. |
| `data-hotkey-takeover` | Takes the hotkey from your page's own listeners. |
| `data-attach` | A selector for your search field. |
| `data-launcher` | Shows the launcher. |

A tag with neither `data-project` nor `data-endpoint` mounts nothing and waits for `init()`.

### JavaScript

`window.FernflyIntentBar` has four functions:

- `init(options)` mounts the bar with the same options as the React props, except open state. It replaces any bar already mounted, including the one the tag mounted.
- `open(options?)` takes `{ query, ask }`, as `useIntentBar().open()` does.
- `close()`.
- `destroy()` removes the bar.

### Events

Any tool or lookup you give no function for asks your page through an event on `window`. Answer with `event.detail.respondWith(answer)`, once and during the listener, with a value or a promise, the way a service worker answers a fetch.

| Event | `detail` | Answer | If nobody answers |
|---|---|---|---|
| `fernfly:preview` | `tool`, `args`, `raw`, `call`, `utterance`, `context` | A preview | No preview |
| `fernfly:run` | The same, plus `progress(done, total)` | `{ message, undo, items }`, or nothing | "This app hasn't connected that yet." |
| `fernfly:values` | `entity`, `query`, `context`, `call` | An array of `{ id, label, detail }`, or `null` | The words pass through |

```js
addEventListener('fernfly:values', (e) => {
  if (e.detail.entity === 'member') e.detail.respondWith(searchMembers(e.detail.query))
})

addEventListener('fernfly:run', (e) => {
  if (e.detail.tool !== 'bulk_update_issues') return
  const { args, progress } = e.detail
  e.detail.respondWith(assignIssues(args, progress).then((n) => ({ message: `Assigned ${n} work items` })))
})
```

Events cover tools that `init()` lists without functions and tools it doesn't list at all. The bar can't tell ahead of time whether a listener will answer, so an action nobody answers still shows its confirm step first.

If your page's code is TypeScript, install the package as a dev dependency and add `import type {} from '@fernfly/intent-bar'` once. The events are then typed on `window`.

## Theming

The bar renders in Shadow DOM, so your CSS can't break it and its CSS can't leak into your page. It still looks like your app:

- It inherits `font` and `color` from the page.
- Each time it opens, it reads your CSS variables for an accent, a surface and a text colour. The first one set wins:

  | Colour | Variables, in order |
  |---|---|
  | Accent | `--fernfly-accent`, `--brand-default`, `--color-primary-100`, `--primary`, `--brand`, `--accent` |
  | Surface | `--fernfly-surface`, `--bg-surface-1`, `--color-background-100`, `--popover`, `--background` |
  | Text | `--fernfly-text`, `--txt-primary`, `--color-text-100`, `--popover-foreground`, `--foreground` |

  A value can be any CSS colour, `oklch()` and `color-mix()` included, or a bare channel triplet such as `222 47% 11%` or `63, 118, 255`.
- It picks dark or light from your page's background colour, so it follows however your app switches.

To set colours yourself, define `--fernfly-accent`, `--fernfly-surface`, `--fernfly-text` or `--fernfly-danger` in your CSS.

## Content Security Policy

The bar adds no `<style>` element and runs no inline script: its styles are stylesheets adopted into its shadow root. A strict policy needs only:

- `script-src`: `https://cdn.jsdelivr.net` for the script tag, or wherever you host the file.
- `connect-src`: `https://fernfly.com`, or your proxy's origin when you use `endpoint`.

It doesn't need `style-src 'unsafe-inline'`.

## Browser support

Any browser with constructable stylesheets: Chrome and Edge 79 and later, Firefox 101 and later, and Safari 16.4 and later.

## Keyboard

| Key | What it does |
|---|---|
| ⌘K or Ctrl+K | Opens or closes the bar |
| Enter | Picks an item, asks the model from the "Ask" item, or runs the parsed call |
| Tab, Shift+Tab | Moves through the input, the chips, the buttons and the footer's Fernfly link |
| Enter on a chip | Edits it |
| Esc | Closes a chip's editor, leaves the confirm step, or closes the bar |

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run harness   # serves the test pages and examples/vanilla at http://127.0.0.1:4319
npm run smoke     # browser checks; needs `npx playwright-core install --only-shell chromium` once
npm run size      # the script tag's size and integrity hash
npm run bump auto   # or patch, minor, major, an exact version: commits and tags it on main; pushing the tag publishes
npm run bump auto --dry-run  # previews the bump and writes nothing
```

## License

MIT
