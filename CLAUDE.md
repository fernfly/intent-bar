# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`@fernfly/intent-bar`: the intent bar SDK for web apps. A sentence becomes an editable row of chips with a live preview, and the host app runs the result. It ships as a React component built on cmdk, and as a script-tag build (one IIFE) that mounts the bar in Shadow DOM.

The bar talks to the Fernfly API through a project's public endpoints:

- `POST /api/p/<public_id>/infer` with `{utterance, meta}` answers `{calls, latency_ms, log_ref}`, `{calls: [], out_of_scope: true, reply, log_ref}` or `{calls, needs_fallback: true, log_ref}`. A 429 carries `rate_limited` or `quota_exceeded`.
- `POST /api/p/<public_id>/corrections` with `{log_ref, call}` stores a user's fix for the project owner to review. It answers 200, or 409 (already corrected), 410 (older than 24 hours), 422 with `violations`, 404 (unknown ref) or 413 (over 8 KB).

A project with no API key is judged by its origin allow-list. A project with a key is called through the host's own proxy, so the key never reaches the browser.

**Not published yet.** `"private": true` in `package.json` stays until the package is ready for its first npm release.

## Commands

```bash
npm run build      # tsup: ESM + CJS for React, plus dist/intent-bar.global.js for a script tag
npm run typecheck  # tsc --noEmit
npm run test       # vitest (happy-dom)
npm run harness    # serves examples/ at http://127.0.0.1:4319: the harness, its script-tag page, examples/vanilla
npm run smoke      # browser checks in Chromium, after a build; REACT_FROM=<node_modules> runs the React page on another React
npm run size       # the script-tag build's size and integrity hash, after a build
npm run bump auto  # or patch, minor, major, an exact version: commits it on main and tags it, never pushes
```

The browser checks use Playwright's headless Chromium (`npx playwright-core install --only-shell chromium`), or the binary at `CHROMIUM_PATH`. CI runs them on React 19 and 18.3.

Node and npm are pinned by `.nvmrc` and `devEngines`.

## Principles

1. **Fernfly predicts, the host runs it.** The bar never executes a call itself. It hands the call to the host's callbacks (React) or DOM events (script tag), which run it with the signed-in user's permissions. The confirm step is UX safety, not a security boundary.
2. **The model extracts, the bar resolves.** For workspace data (people, projects, cycles) the model returns the user's words, and the host's lookups resolve them to ids at runtime. Only fixed vocabularies are enums. `none` and `current` are reserved tokens resolved against host context, and relative dates are enum tokens, never computed dates.
3. **Branding is read, not configured.** The bar inherits `font` and `color` through the shadow root and reads accent variables at open time. No button sniffing, no MutationObserver.

## Rules

- **Anything that isn't `kind: 'filter'` or `'navigate'` confirms**, and a tool with no kind is an action. Confirm can be turned off only for a single-item write, never when the preview count is above 1.
- **A sentence goes to the model on Enter**, from the pinned "Ask" item. Instant search runs on every keystroke with no network call.
- **Send a correction only when the edited call runs**, and only for a change to what the model returned: a value, an added or removed argument, or a switched tool. A pick between lookup matches, an abandoned edit or an unchanged call sends nothing. Copy says "Saved as a correction for review", never "Next time…".
- **Hotkey:**
  - The bar defers to the host by default: the listener skips an event the page already handled (`e.defaultPrevented`), a held key and IME input.
  - Taking over a host's hotkey is a setting, off by default, such as `hotkey: { keys: 'mod+k', takeOver: true }`. With it on, the bar listens on `window` in the capture phase, opens, and stops the event, so a host palette bound on `document` never sees the key.
  - Only a bare-key hotkey, such as `/`, skips editable fields, read from `composedPath()[0]` because `target` is retargeted to the outermost shadow host. A hotkey with a modifier types nothing, so it opens from a field too.
- **Theme:** each colour is read from an ordered list of variable names, `THEME_SOURCES` in `src/core/theme.ts`, and the first that holds a colour wins, starting with the `--fernfly-*` override. Support another design system by adding its names there, not with a CSS `var()` fallback chain, which can't tell a channel triplet from a colour. Values may be RGB or HSL triplets or any CSS colour, `oklch()` and `color-mix()` included. Dark or light is measured from the page's resolved colours, never read from a class or attribute such as `.dark` or `data-theme`.
- **Shadow DOM:**
  - Stop key events at the shadow host, or the host app's single-key shortcuts fire while the user types.
  - Own the overlay: focus trap, Escape, focus return through `shadowRoot.activeElement`, scroll lock. Radix's outside-click and focus-scope code listens on `document`, where retargeting breaks it, so use cmdk's bare `Command`, never `Command.Dialog`.
  - Return focus in a microtask queued from the bar's cleanup, not in the cleanup itself. React ends the commit that removes the bar by re-focusing whatever had focus when the commit began, which from the page's side is the shadow host.
  - Prevent `mousedown` on the bar's non-focusable parts, so a click there keeps focus in the input. cmdk's refocus reads `document.activeElement`, which inside a shadow root is only the host.
  - Chips sit outside `Command`, whose root `onKeyDown` takes the arrows and Enter. A chip's dropdown is a nested `Command`.
  - Every Enter and Tab handler checks `isComposing`.
- **Styles go in through `adoptedStyleSheets` only**, never a `<style>` element, so strict CSPs keep working.
- **Script tag:** anything the host passes no function for goes out as a `fernfly:preview`, `fernfly:run` or `fernfly:values` event on `window`, answered with `detail.respondWith()` during dispatch. Unanswered, a lookup passes the words through, a preview is skipped, and a run says the app hasn't connected it.
- **Build:** never touch `document` at import time, except the IIFE reading its own `<script>` tag, which is only known while it runs; keep React a peer (`^18.2 || ^19`) and test on both; the IIFE defines `process.env.NODE_ENV`.

## Code style

- Document exported or non-trivial functions with a JSDoc block. Below that level, default to no comment.
- Never mention an issue id in a code comment.
- Prose (README, docs, UI copy) uses plain language and no em dashes.

## Releasing

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: it checks the tag against `package.json`, tests, builds, publishes to npm with provenance, and writes the GitHub release notes from `npm run size`, which give the pinned script tag and its integrity hash. It needs an `NPM_TOKEN` secret.

To release, run `npm run bump <patch|minor|major|x.y.z|auto>` on a clean `main`. `auto` reads the commits since the last `v*` tag: a breaking change (`!` or a `BREAKING CHANGE:` footer) is major, `feat` is minor, `fix` or `perf` is patch, and anything else alone releases nothing. Before 1.0 a breaking change is minor, so 1.0 takes an explicit `major`. `scripts/bump.mjs` hands the type to `npm version`, and as its `preversion` hook it refuses a private package, a prerelease, another branch or an existing tag, then runs typecheck and tests. npm then commits `chore: release vX.Y.Z` (package.json and the lockfile) and tags it. For the first release, remove `"private": true` in its own commit on `main` first. Nothing is pushed: `git push origin main vX.Y.Z` publishes, and tags are pushes, so only when the user asks.

## Commits

Conventional Commits (`type: lowercase description`). Work on a feature branch. Commit there once the work is done and checked, without waiting for a review, then give the user steps to test it. The user reviews after the commit, and their feedback comes back as follow-up commits on the same branch.

Merge into `main` with `git merge --no-ff` only when the user explicitly says to merge, never as the last step of finishing the work. Push only when asked.

**This repository is public.** Nothing committed here, commit messages included, may name private repositories, local paths, internal issue numbers or people's accounts. Working notes that need them stay uncommitted.
