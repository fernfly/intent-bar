/**
 * Lists the changes in the release at HEAD as Markdown, for the release
 * notes: its breaking, feat, fix and perf commits, as `notedCommits` picks
 * and `npm run bump --dry-run` previewed. A breaking change says so, since a
 * `BREAKING CHANGE:` footer doesn't show in the subject. The release workflow
 * adds it after `npm run size`. It needs the full history and tags, so CI
 * checks out with `fetch-depth: 0`.
 */
import { readFile } from 'node:fs/promises'
import { notedCommits, releaseCommits } from './git.mjs'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const commits = notedCommits(releaseCommits(`v${pkg.version}`))

if (commits.length) {
  process.stdout.write(`
Changes in this release:

${commits.map(({ hash, subject, kind }) => `- ${hash} ${subject}${kind === 'breaking' ? ' (breaking change)' : ''}`).join('\n')}
`)
}
