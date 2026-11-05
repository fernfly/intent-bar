import { afterEach, describe, expect, it } from 'vitest'
import { pagesFromNav, relatedPages, shouldAsk } from './router'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shouldAsk', () => {
  it('pins Ask from three words, or when nothing matches', () => {
    expect(shouldAsk('', false)).toBe(false)
    expect(shouldAsk('proj', true)).toBe(false)
    expect(shouldAsk('zzz', false)).toBe(true)
    expect(shouldAsk('backlog for priya', true)).toBe(true)
  })
})

describe('relatedPages', () => {
  const pages = [
    { label: 'Cycles', href: '/cycles' },
    { label: 'Projects', href: '/projects' },
    { label: 'Settings', href: '/settings' },
  ]

  it('finds pages that share a word with the sentence', () => {
    expect(relatedPages('show cycle velocity for projects', pages).map((p) => p.label)).toEqual(['Cycles', 'Projects'])
    expect(relatedPages('what is the weather', pages)).toEqual([])
  })
})

describe('pagesFromNav', () => {
  it('reads labelled links from nav elements, once each', () => {
    document.body.innerHTML = `
      <nav><a href="/projects"> Projects </a><a href="/cycles">Cycles</a><a href="#">Menu</a></nav>
      <nav><a href="/projects">Projects again</a><a href="/blank"></a></nav>
      <a href="/outside">Outside</a>`
    expect(pagesFromNav(document)).toEqual([
      { label: 'Projects', href: '/projects' },
      { label: 'Cycles', href: '/cycles' },
    ])
  })
})
