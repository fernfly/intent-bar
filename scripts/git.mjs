/**
 * Git helpers for the release scripts. `releaseCommits` is the one list of a
 * release's commits, which `npm run bump --dry-run` previews and the release
 * notes print.
 */
import { execFileSync } from 'node:child_process'

/**
 * The commits in the release `tag`, newest first, as `hash subject` lines:
 * every commit since the release tag before it, leaving out merges and the
 * `chore: release <tag>` commit itself. Before the bump, when neither the tag
 * nor its commit exists yet, it is the commits the bump would release.
 */
export function releaseCommits(tag) {
  const log = git('log', '--no-merges', '--format=%h %s', sinceLast(lastTag(tag)))
  return log
    .split('\n')
    .filter((line) => line && line.slice(line.indexOf(' ') + 1) !== `chore: release ${tag}`)
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
export function sinceLast(tag) {
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
