/**
 * `npm run bump <patch|minor|major|x.y.z|auto>` bumps the version with
 * `npm version`, which works out the new version by semver rules, commits
 * package.json and the lockfile as `chore: release vX.Y.Z` and tags it.
 * Nothing is pushed: pushing the tag is what publishes.
 *
 * The same file is npm's `preversion` and `postversion` hook. Before the
 * bump, it checks that the release workflow can publish the new version.
 * After it, it says how to push the tag.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

switch (process.env.npm_lifecycle_event) {
  case 'bump':
    bump(process.argv.slice(2))
    break
  case 'preversion':
    check(process.env.npm_new_version)
    break
  case 'postversion':
    report(process.env.npm_new_version)
    break
  default:
    fail('Run this through `npm run bump`, not on its own.')
}

/** Runs `npm version` with the release type or version given, or the type `auto` picks. */
function bump(args) {
  if (args.length !== 1) fail('Usage: npm run bump <patch|minor|major|x.y.z|auto>')
  const type = args[0] === 'auto' ? autoType() : args[0]
  const { status } = spawnSync('npm', ['version', type, '-m', 'chore: release v%s'], { stdio: 'inherit' })
  process.exit(status ?? 1)
}

/**
 * Picks the release type from the Conventional Commits since the last release
 * tag: a breaking change is major, a feat is minor, and a fix or perf is
 * patch. Before 1.0 a breaking change is minor, so 1.0 is always a deliberate
 * `npm run bump major`. Other types alone, such as docs or chore, release
 * nothing.
 */
function autoType() {
  const last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*')
  const since = last || 'the first commit'
  const log = git('log', '--no-merges', '--format=%B%x00', last ? `${last}..HEAD` : 'HEAD')
  const count = { breaking: 0, feat: 0, fix: 0, other: 0 }
  for (const message of log.split('\0').map((m) => m.trim()).filter(Boolean)) {
    const [, type, bang] = /^(\w+)(?:\([^)]*\))?(!)?: /.exec(message) ?? []
    if (bang || /^BREAKING[ -]CHANGE: /m.test(message)) count.breaking++
    else if (type === 'feat') count.feat++
    else if (type === 'fix' || type === 'perf') count.fix++
    else count.other++
  }
  console.log(
    `\nSince ${since}: ${count.breaking} breaking, ${count.feat} feat, ${count.fix} fix or perf, ${count.other} other.`,
  )

  const beforeOne = pkg.version.startsWith('0.')
  if (count.breaking && !beforeOne) return pick('major', 'A breaking change is a major release.')
  if (count.breaking) return pick('minor', 'Before 1.0, a breaking change is a minor release.')
  if (count.feat) return pick('minor', 'A feat is a minor release.')
  if (count.fix) return pick('patch', 'A fix or perf is a patch release.')
  fail(`Nothing to release since ${since}. Run \`npm run bump patch\` to release anyway.`)
}

/** Says which release type `auto` picked and why, then returns it. */
function pick(type, reason) {
  console.log(`${reason} Bumping ${type}.\n`)
  return type
}

/**
 * Stops the bump, before anything is written, unless the release workflow
 * can publish the version: the package is not private, the version is not a
 * prerelease, HEAD is on main and the tag is new.
 */
function check(version) {
  const tag = `v${version}`
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

/** Says how to push the new tag, and how to undo the bump before pushing. */
function report(version) {
  const tag = `v${version}`
  console.log(`
Committed and tagged ${tag}. Pushing the tag publishes it to npm:

  git push origin main ${tag}

To undo it before pushing:

  git tag -d ${tag} && git reset --keep HEAD~1
`)
}

/** Runs git and returns its output, or an empty string if it fails. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** Prints why the bump can't go ahead and stops it. */
function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
