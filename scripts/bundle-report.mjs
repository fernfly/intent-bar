/**
 * Reports on the script-tag build as Markdown: its size raw, gzipped and
 * with Brotli, and the pinned script tag with its integrity hash. CI adds it
 * to the run summary, and the release workflow starts the release notes with
 * it, followed by `scripts/release-commits.mjs`. Run `npm run build` first.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const file = 'dist/intent-bar.global.js'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const code = await readFile(new URL(`../${file}`, import.meta.url))
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const integrity = `sha384-${createHash('sha384').update(code).digest('base64')}`

process.stdout.write(`## ${pkg.name} ${pkg.version}

| \`${file}\` | Size |
|---|---|
| Raw | ${kb(code.length)} |
| Gzip | ${kb(gzipSync(code, { level: 9 }).length)} |
| Brotli | ${kb(brotliCompressSync(code).length)} |

The script tag for this version:

\`\`\`html
<script
  src="https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/${file}"
  integrity="${integrity}"
  crossorigin="anonymous"
  data-project="YOUR_PUBLIC_ID"
></script>
\`\`\`
`)
