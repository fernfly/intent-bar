import { describe, expect, it } from 'vitest'
import {
  applyTheme,
  colorExpression,
  luminance,
  normalizeColor,
  parseColor,
  readTheme,
  schemeFor,
  valueKind,
  type ThemeEnv,
} from './theme'

const anyColor = (v: string) => /^(#|rgb|hsl|oklch|color-mix|[a-z]+$)/.test(v)

describe('valueKind', () => {
  it('reads Plane-style RGB triplets', () => {
    expect(valueKind('63, 118, 255', anyColor)).toBe('rgb')
    expect(valueKind(' 63 118 255 ', anyColor)).toBe('rgb')
  })

  it('reads shadcn-style HSL triplets', () => {
    expect(valueKind('222.2 47.4% 11.2%', anyColor)).toBe('hsl')
    expect(valueKind('0 0% 100%', anyColor)).toBe('hsl')
    expect(valueKind('210deg, 40%, 96%', anyColor)).toBe('hsl')
  })

  it('passes real colours through and rejects everything else', () => {
    expect(valueKind('oklch(0.48 0.12 243)', anyColor)).toBe('color')
    expect(valueKind('#3f76ff', anyColor)).toBe('color')
    expect(valueKind('', anyColor)).toBeNull()
    expect(valueKind('inherit', anyColor)).toBeNull()
    expect(valueKind('12px', anyColor)).toBeNull()
    expect(valueKind('63, 118', anyColor)).toBeNull()
  })
})

describe('colorExpression and normalizeColor', () => {
  it('wraps triplets so the expression keeps tracking the variable', () => {
    expect(colorExpression('--color-primary-100', '63, 118, 255', anyColor)).toBe('rgb(var(--color-primary-100))')
    expect(colorExpression('--primary', '222 47% 11%', anyColor)).toBe('hsl(var(--primary))')
    expect(colorExpression('--brand-default', 'oklch(0.48 0.12 243)', anyColor)).toBe('var(--brand-default)')
    expect(colorExpression('--x', '4px', anyColor)).toBeNull()
  })

  it('normalises triplets into concrete colours', () => {
    expect(normalizeColor('63, 118, 255', anyColor)).toBe('rgb(63, 118, 255)')
    expect(normalizeColor('222 47% 11%', anyColor)).toBe('hsl(222 47% 11%)')
    expect(normalizeColor('#fff', anyColor)).toBe('#fff')
  })
})

describe('parseColor', () => {
  it('parses hex, rgb and hsl in either syntax', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#3f76ff80')?.[3]).toBeCloseTo(0.5, 2)
    expect(parseColor('rgb(63, 118, 255)')).toEqual([63, 118, 255, 1])
    expect(parseColor('rgb(63 118 255 / 0.5)')).toEqual([63, 118, 255, 0.5])
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0])
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0])
    const [r, g, b] = parseColor('hsl(0 0% 100%)')!
    expect([r, g, b].map(Math.round)).toEqual([255, 255, 255])
    const navy = parseColor('hsl(222.2 47.4% 11.2%)')!
    expect(navy.slice(0, 3).map(Math.round)).toEqual([15, 23, 42])
  })

  it('leaves colours it cannot parse to the browser', () => {
    expect(parseColor('oklch(0.48 0.12 243)')).toBeNull()
    expect(parseColor('nonsense')).toBeNull()
  })
})

describe('schemeFor', () => {
  it('calls dark surfaces dark and light ones light', () => {
    expect(schemeFor([25, 25, 25, 1])).toBe('dark')
    expect(schemeFor([255, 255, 255, 1])).toBe('light')
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1)
  })
})

/** A theme environment over a plain map of variables, as a page's computed style would report them. */
function env(vars: Record<string, string>, backgrounds: string[] = [], text = 'rgb(0, 0, 0)'): ThemeEnv {
  return {
    readVar: (name) => vars[name] ?? '',
    pageBackgrounds: () => backgrounds,
    textColor: () => text,
    toRgba: parseColor,
  }
}

describe('readTheme', () => {
  it('reads Plane-style triplets', () => {
    const light = readTheme(env({ '--color-primary-100': '63, 118, 255', '--color-background-100': '255, 255, 255' }))
    expect(light.scheme).toBe('light')
    expect(light.properties).toMatchObject({
      '--fb-accent': 'rgb(var(--color-primary-100))',
      '--fb-surface': 'rgb(var(--color-background-100))',
      '--fb-on-accent': '#fff',
    })
    const dark = readTheme(env({ '--color-primary-100': '63, 118, 255', '--color-background-100': '25, 25, 25' }))
    expect(dark.scheme).toBe('dark')
  })

  it('reads shadcn-style triplets, preferring --primary over --accent', () => {
    const t = readTheme(env({ '--primary': '210 40% 98%', '--accent': '217.2 32.6% 17.5%', '--background': '222.2 84% 4.9%' }))
    expect(t.properties['--fb-accent']).toBe('hsl(var(--primary))')
    expect(t.properties['--fb-on-accent']).toBe('#000')
    expect(t.scheme).toBe('dark')
  })

  it('takes the scheme from an opaque page background before the variables', () => {
    const t = readTheme(env({ '--background': '0 0% 100%' }, ['rgba(0, 0, 0, 0)', 'rgb(20, 20, 20)']))
    expect(t.scheme).toBe('dark')
  })

  it('falls back to the text colour when nothing has a background', () => {
    expect(readTheme(env({}, ['rgba(0, 0, 0, 0)'], 'rgb(240, 240, 240)')).scheme).toBe('dark')
    expect(readTheme(env({}, [], 'rgb(20, 20, 20)')).scheme).toBe('light')
  })

  it('lets an explicit --fernfly-accent win', () => {
    const t = readTheme(env({ '--fernfly-accent': '#b4501f', '--primary': '222 47% 11%' }))
    expect(t.properties['--fb-accent']).toBe('var(--fernfly-accent)')
  })
})

describe('applyTheme', () => {
  it('replaces the previous reading on the host', () => {
    const host = document.createElement('div')
    applyTheme(host, { scheme: 'dark', properties: { '--fb-accent': 'var(--primary)', '--fb-surface': 'var(--popover)' } })
    applyTheme(host, { scheme: 'light', properties: { '--fb-accent': 'rgb(var(--color-primary-100))' } })
    expect(host.getAttribute('data-scheme')).toBe('light')
    expect(host.style.getPropertyValue('--fb-accent')).toBe('rgb(var(--color-primary-100))')
    expect(host.style.getPropertyValue('--fb-surface')).toBe('')
  })
})
