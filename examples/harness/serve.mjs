/**
 * Serves the harness at http://127.0.0.1:<port>/examples/harness/ after
 * building its React host app. Every response carries a strict CSP (no inline
 * scripts or styles), which the bar must work under. `/fake-api/infer` and
 * `/fake-api/corrections` stand in for a project's endpoints, for the page
 * that installs the bar with its script tag alone.
 *
 * Run `npm run build` first for the script-tag mode, then:
 * `node examples/harness/serve.mjs [port]`
 *
 * `REACT_FROM=<node_modules dir>` builds the React host app against another
 * React, such as an 18.x install, so both supported majors can be checked.
 */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = normalize(join(here, '../..'))
const served = [join(repo, 'examples') + sep, join(repo, 'dist') + sep]
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }

/** What the fake API has been sent, for the smoke test to read. */
export const fakeApi = { requests: [] }

/** Answers like the infer endpoint, by pattern: "slow down" is rate limited, "archive" is a tool no page handles, and anything else moves work items. */
function fakeInfer(utterance) {
  if (/slow down/i.test(utterance)) return [429, { error: 'Too many requests', rate_limited: true }]
  if (/archive/i.test(utterance)) return [200, { calls: [{ name: 'archive_cycles', arguments: {} }], latency_ms: 70, log_ref: 'api-archive' }]
  const assignee = /for (\w+)/i.exec(utterance)?.[1] ?? 'me'
  return [200, { calls: [{ name: 'update_work_items', arguments: { state: 'backlog', assignee } }], latency_ms: 80, log_ref: 'api-update' }]
}

/** Answers a POST to the fake API and records it. */
async function answerFakeApi(req, res, pathname) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString() || 'null')
  fakeApi.requests.push({ path: pathname, body })
  const [status, answer] =
    pathname === '/fake-api/infer'
      ? fakeInfer(String(body?.utterance ?? ''))
      : pathname === '/fake-api/corrections'
        ? [200, { ok: true }]
        : [404, { error: 'Not found' }]
  res.writeHead(status, { 'content-type': 'application/json', 'content-security-policy': CSP }).end(JSON.stringify(answer))
}

/** Builds the React host app, then starts the server and resolves with it. */
export async function serve(port = 4319) {
  const reactFrom = process.env.REACT_FROM
  await build({
    alias: reactFrom ? { react: join(reactFrom, 'react'), 'react-dom': join(reactFrom, 'react-dom') } : {},
    entryPoints: [join(here, 'react-app.tsx')],
    outfile: join(here, '.build/react-app.js'),
    bundle: true,
    format: 'esm',
    sourcemap: true,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'warning',
  })

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === '/') {
      res.writeHead(302, { location: '/examples/harness/' }).end()
      return
    }
    if (req.method === 'POST' && pathname.startsWith('/fake-api/')) {
      await answerFakeApi(req, res, pathname)
      return
    }
    const file = normalize(join(repo, decodeURIComponent(pathname), pathname.endsWith('/') ? 'index.html' : ''))
    if (!served.some((dir) => file.startsWith(dir))) {
      res.writeHead(404).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return server
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 4319)
  await serve(port)
  process.stdout.write(`Harness on http://127.0.0.1:${port}/examples/harness/ (add ?mode=script for the IIFE)\n`)
}
