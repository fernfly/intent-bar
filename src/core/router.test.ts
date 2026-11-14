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

  const labels = (utterance: string, list: { label: string; href: string }[] = pages) =>
    relatedPages(utterance, list).map((p) => p.label)

  it('finds pages that share a word with the sentence', () => {
    expect(labels('show cycle velocity for projects')).toEqual(['Cycles', 'Projects'])
    expect(labels('what is the weather')).toEqual([])
  })

  it('never matches a label inside a longer word, either way round', () => {
    const api = [{ label: 'API', href: '/#api' }]
    expect(labels('what is the capital of France', api)).toEqual([])
    expect(labels('show me the apis', api)).toEqual(['API'])
    expect(labels('what is a setting sun', [{ label: 'Set', href: '/set' }])).toEqual([])
    expect(labels('open sets', [{ label: 'Settings', href: '/settings' }])).toEqual([])
  })

  it('matches a plural to its singular, both ways', () => {
    const list = [
      { label: 'Upcoming webinars', href: '/webinars' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Class', href: '/class' },
    ]
    expect(labels('book a webinar on pricing', list)).toEqual(['Upcoming webinars'])
    expect(labels('show me the policies', list)).toEqual(['Privacy policy'])
    expect(labels('which classes run today', list)).toEqual(['Class'])
    expect(labels('cycle?')).toEqual(['Cycles'])
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
