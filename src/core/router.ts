/**
 * Query routing. Instant search runs on every keystroke with no network
 * call. A sentence goes to the model only on Enter, from the pinned Ask item.
 */
import type { BarPage } from './types'

/** From this many words, the Ask item is pinned first even when search finds something. */
export const ASK_MIN_WORDS = 3

/** The words of a query. */
export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/** Whether to pin the Ask item: once there are enough words, or when nothing matches. */
export function shouldAsk(search: string, anythingMatches: boolean): boolean {
  const count = wordsOf(search).length
  return count >= ASK_MIN_WORDS || (count > 0 && !anythingMatches)
}

/** The lower-case words of a text, split on anything that isn't a letter or a digit. */
function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Whether `plural` is an English plural of `single`: "webinars", "classes", "policies". */
function isPluralOf(plural: string, single: string): boolean {
  return (
    plural === `${single}s` ||
    plural === `${single}es` ||
    (single.endsWith('y') && plural === `${single.slice(0, -1)}ies`)
  )
}

/** Whether two words are the same word, or one is the other's plural. */
function sameWord(a: string, b: string): boolean {
  return a === b || isPluralOf(a, b) || isPluralOf(b, a)
}

/**
 * Pages whose label shares a whole word with the sentence, for the out-of-scope
 * state. A word matches the same word or its plural, never a part of a longer
 * word, so "capital" doesn't match a page called "API". The sentence's short
 * words are skipped.
 */
export function relatedPages(utterance: string, pages: readonly BarPage[], max = 3): BarPage[] {
  const words = tokensOf(utterance).filter((w) => w.length >= 4)
  return pages
    .filter((page) => {
      const label = tokensOf(page.label)
      return words.some((w) => label.some((l) => sameWord(w, l)))
    })
    .slice(0, max)
}

/** The links in the page's `<nav>` elements, used when the host passes no `pages`. Read at call time. */
export function pagesFromNav(doc: Document): BarPage[] {
  const seen = new Set<string>()
  const pages: BarPage[] = []
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('nav a[href]')) {
    const label = a.textContent?.replace(/\s+/g, ' ').trim()
    const href = a.getAttribute('href')
    if (!label || !href || href === '#' || seen.has(href)) continue
    seen.add(href)
    pages.push({ label, href })
  }
  return pages
}
