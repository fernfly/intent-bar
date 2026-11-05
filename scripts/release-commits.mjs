/**
 * Lists the commits in the release at HEAD as Markdown, for the release
 * notes: the same list `npm run bump --dry-run` previewed for it. The release
 * workflow adds it after `npm run size`. It needs the full history and tags,
 * so CI checks out with `fetch-depth: 0`.
 */
import { readFile } from 'node:fs/promises'
import { releaseCommits } from './git.mjs'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const commits = releaseCommits(`v${pkg.version}`)

if (commits.length) {
  process.stdout.write(`
Commits in this release:

${commits.map((line) => `- ${line}`).join('\n')}
`)
}
