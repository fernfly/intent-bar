/**
 * The `preversion` and `postversion` hooks for `npm version`, which
 * `npm run bump` calls. npm has already worked out the new version by
 * semver rules and checked that the working tree is clean.
 *
 * Before the bump, it checks that the release workflow can publish the new
 * version: the package is not private, the version is not a prerelease, HEAD
 * is on main and the tag is new. After the bump, it says how to push the tag,
 * which is what publishes it.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const version = process.env.npm_new_version
if (!version) fail('Run this through `npm run bump`, not on its own.')
const tag = `v${version}`

if (process.env.npm_lifecycle_event === 'postversion') {
  console.log(`
Committed and tagged ${tag}. Pushing the tag publishes it to npm:

  git push origin main ${tag}

To undo it before pushing:

  git tag -d ${tag} && git reset --keep HEAD~1
`)
} else {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  if (pkg.private) {
    fail(`package.json still has "private": true, so npm would refuse to publish ${tag}. Remove it in a commit on main first.`)
  }
  if (version.includes('-')) {
    fail(`${tag} is a prerelease. The release workflow publishes without --tag, which npm refuses for a prerelease.`)
  }
  const branch = git('symbolic-ref', '--short', '-q', 'HEAD')
  if (branch !== 'main') {
    fail(`Releases are cut from main, but HEAD is ${branch ? `on ${branch}` : 'detached'}.`)
  }
  if (git('tag', '--list', tag)) fail(`The tag ${tag} already exists.`)
}

/** Runs git and returns its output, or an empty string if it fails. */
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** Prints why the bump can't go ahead and stops it before anything is written. */
function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
