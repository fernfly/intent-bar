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

/** Pages whose label shares a word with the sentence, for the out-of-scope state. Short words are skipped. */
export function relatedPages(utterance: string, pages: readonly BarPage[], max = 3): BarPage[] {
  const words = wordsOf(utterance.toLowerCase()).filter((w) => w.length >= 4)
  return pages
    .filter((page) => {
      const label = page.label.toLowerCase()
      return words.some((w) => label.includes(w) || w.includes(label))
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
