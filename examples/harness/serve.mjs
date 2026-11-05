/**
 * Serves the harness at http://127.0.0.1:<port>/examples/harness/ after
 * building its React host app. Every response carries a strict CSP (no inline
 * scripts or styles), which the bar must work under.
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
