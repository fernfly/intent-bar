/**
 * Git and Conventional Commits helpers for the release scripts.
 * `releaseCommits` is the one list of a release's commits: `npm run bump
 * auto` counts it, `--dry-run` previews it, and the release notes print the
 * part `notedCommits` keeps.
 */
import { execFileSync } from 'node:child_process'

/**
 * The commits in a release, newest first, as `{ hash, subject, kind }`:
 * every commit since the last release tag, leaving out merges. Given the
 * release's own `tag`, it counts from the tag before that one and leaves out
 * the `chore: release <tag>` commit, so the list is the same before the bump
 * and after it.
 */
export function releaseCommits(tag) {
  const log = git('log', '--no-merges', '--format=%h %B%x00', sinceLast(lastTag(tag)))
  return log
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [, hash, message] = /^(\S+) ?([\s\S]*)$/.exec(entry)
      return { hash, subject: message.split('\n')[0], kind: kindOf(message) }
    })
    .filter(({ subject }) => !tag || subject !== `chore: release ${tag}`)
}

/**
 * The commits the release notes list: the ones that change the version, a
 * breaking change, feat, fix or perf. Docs, chore and the other types are
 * left out. A release with none of them, forced with `npm run bump patch`,
 * lists every commit instead, so its notes still say what changed.
 */
export function notedCommits(commits) {
  const noted = commits.filter(({ kind }) => kind !== 'other')
  return noted.length ? noted : commits
}

/**
 * Sorts a commit message by its Conventional Commits type: `breaking` for a
 * `!` or a `BREAKING CHANGE:` footer whatever the type, then `feat`, `fix`
 * for a fix or perf, and `other` for the rest.
 */
function kindOf(message) {
  const [, type, bang] = /^(\w+)(?:\([^)]*\))?(!)?: /.exec(message) ?? []
  if (bang || /^BREAKING[ -]CHANGE: /m.test(message)) return 'breaking'
  if (type === 'feat') return 'feat'
  if (type === 'fix' || type === 'perf') return 'fix'
  return 'other'
}

/**
 * The latest release tag reachable from HEAD, or an empty string before the
 * first release. `except` skips a tag, such as the one on HEAD being released.
 */
export function lastTag(except) {
  const exclude = except ? ['--exclude', except] : []
  return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...exclude)
}

/** The `git log` range from a release tag to HEAD, or all of HEAD's history without one. */
function sinceLast(tag) {
  return tag ? `${tag}..HEAD` : 'HEAD'
}

/** Runs git and returns its output, or an empty string if it fails. */
export function git(...args) {
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
