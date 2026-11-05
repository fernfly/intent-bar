/**
 * The theme step. CSS does most of the work: the shadow host inherits `font`
 * and `color`, and the stylesheet reads `--fernfly-*` overrides. This step
 * covers what CSS can't: it finds which of the page's variables carry the
 * accent, surface and text colours, wraps channel triplets so they become
 * colours, and decides dark or light from the page's surface. It runs once
 * per open, with no MutationObserver.
 */

export type Scheme = 'light' | 'dark'

/** sRGB channels from 0 to 255, then alpha from 0 to 1. */
export type RGBA = readonly [number, number, number, number]

/**
 * Where each colour is looked for, first match wins. The lists cover an
 * explicit override, then Plane (propel's oklch tokens, then the older RGB
 * triplets), then shadcn's HSL triplets, then generic names. `--accent` comes
 * last because shadcn uses it for a muted hover surface, not the brand.
 */
export const THEME_SOURCES = {
  accent: ['--fernfly-accent', '--brand-default', '--color-primary-100', '--primary', '--brand', '--accent'],
  surface: ['--fernfly-surface', '--bg-surface-1', '--color-background-100', '--popover', '--background'],
  text: ['--fernfly-text', '--txt-primary', '--color-text-100', '--popover-foreground', '--foreground'],
} as const

type Token = keyof typeof THEME_SOURCES

/** Every property the theme step writes onto the host, so a later open can clear them. */
export const THEME_PROPERTIES = ['--fb-accent', '--fb-surface', '--fb-text', '--fb-on-accent'] as const

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`
const SEP = String.raw`\s*[,\s]\s*`
const RGB_TRIPLET = new RegExp(`^${NUM}${SEP}${NUM}${SEP}${NUM}$`)
const HSL_TRIPLET = new RegExp(`^${NUM}(?:deg)?${SEP}${NUM}%${SEP}${NUM}%$`)
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])

/** Whether the browser accepts a value as a colour. False where `CSS.supports` is missing. */
function supportsColor(value: string): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', value)
}

/**
 * Classifies a custom property's value: an RGB triplet (`63, 118, 255` or
 * `63 118 255`), an HSL triplet (`222 47% 11%`), a colour CSS can use as it
 * is, or neither.
 */
export function valueKind(value: string, isColor: (v: string) => boolean = supportsColor): 'rgb' | 'hsl' | 'color' | null {
  const v = value.trim()
  if (!v || CSS_WIDE.has(v.toLowerCase())) return null
  if (RGB_TRIPLET.test(v)) return 'rgb'
  if (HSL_TRIPLET.test(v)) return 'hsl'
  return isColor(v) ? 'color' : null
}

/**
 * A colour expression for a variable that keeps tracking it: `rgb(var(--x))`
 * for an RGB triplet, `hsl(var(--x))` for an HSL one, `var(--x)` for a colour.
 * Written onto the host, it re-themes live when the page changes the variable.
 */
export function colorExpression(name: string, value: string, isColor?: (v: string) => boolean): string | null {
  switch (valueKind(value, isColor)) {
    case 'rgb':
      return `rgb(var(${name}))`
    case 'hsl':
      return `hsl(var(${name}))`
    case 'color':
      return `var(${name})`
    default:
      return null
  }
}

/** A variable's value as a concrete colour: triplets wrapped in `rgb()` or `hsl()`, colours passed through. */
export function normalizeColor(value: string, isColor?: (v: string) => boolean): string | null {
  const v = value.trim()
  switch (valueKind(v, isColor)) {
    case 'rgb':
      return `rgb(${v})`
    case 'hsl':
      return `hsl(${v})`
    case 'color':
      return v
    default:
      return null
  }
}

/** HSL (degrees, percentages) to sRGB channels. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** A channel or alpha argument, which may be a percentage. */
function channel(arg: string, scale: number): number {
  return arg.endsWith('%') ? (parseFloat(arg) / 100) * scale : parseFloat(arg)
}

/**
 * Parses hex, `rgb()`/`rgba()` and `hsl()`/`hsla()` in comma or space syntax.
 * Anything else, such as `oklch()` or `color-mix()`, returns null and is left
 * to the browser.
 */
export function parseColor(color: string): RGBA | null {
  const c = color.trim().toLowerCase()
  if (c === 'transparent') return [0, 0, 0, 0]
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(c)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1]
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(c)
  if (!fn?.[1] || fn[2] === undefined) return null
  const args = fn[2].split(/[\s,/]+/).filter(Boolean)
  if (args.length < 3 || args.length > 4) return null
  const alpha = args[3] === undefined ? 1 : channel(args[3], 1)
  const [a, b, d] = args as [string, string, string]
  const rgb = fn[1].startsWith('rgb') ? [channel(a, 255), channel(b, 255), channel(d, 255)] : hslToRgb(parseFloat(a), parseFloat(b), parseFloat(d))
  if ([...rgb, alpha].some((x) => Number.isNaN(x))) return null
  return [rgb[0]!, rgb[1]!, rgb[2]!, alpha]
}

/** Resolves any colour the browser understands by painting one pixel. Null without a 2D canvas, or for an invalid colour. */
function paintColor(color: string, doc: Document): RGBA | null {
  const ctx = doc.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const sentinel = '#010203'
  ctx.fillStyle = sentinel
  ctx.fillStyle = color
  if (ctx.fillStyle === sentinel) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b, a / 255]
}

/** WCAG relative luminance of an sRGB colour, from 0 (black) to 1 (white). */
export function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Below this luminance, white text contrasts better than black, so the surface counts as dark. */
const CONTRAST_PIVOT = 0.179

/**
 * Above this luminance, text on the accent turns black. Higher than the
 * contrast pivot because apps pair mid-tone brand colours with white text,
 * and WCAG 2's midpoint would pick black on Plane's blue.
 */
const ON_ACCENT_PIVOT = 0.4

/** Dark or light for a surface colour. */
export function schemeFor(surface: RGBA): Scheme {
  return luminance(surface) < CONTRAST_PIVOT ? 'dark' : 'light'
}

/** What the theme step reads from the page. Injectable so it can be tested without a layout engine. */
export interface ThemeEnv {
  readVar(name: string): string
  pageBackgrounds(): string[]
  textColor(): string
  toRgba(color: string): RGBA | null
}

/** The theme environment as seen from the bar's host element, which inherits the page's variables. */
export function browserThemeEnv(host: Element): ThemeEnv {
  const doc = host.ownerDocument
  const view = doc.defaultView
  if (!view) throw new Error('The intent bar needs a window')
  const style = view.getComputedStyle(host)
  return {
    readVar: (name) => style.getPropertyValue(name).trim(),
    pageBackgrounds: () => [doc.body, doc.documentElement].map((el) => view.getComputedStyle(el).backgroundColor),
    textColor: () => style.color,
    toRgba: (color) => parseColor(color) ?? paintColor(color, doc),
  }
}

/** The result of one theme reading: the scheme, and the `--fb-*` properties to write onto the host. */
export interface ThemeReading {
  scheme: Scheme
  properties: Partial<Record<(typeof THEME_PROPERTIES)[number], string>>
}

/**
 * Reads the page's theme. The scheme comes from the first opaque page
 * background (body, then html), then the surface variable, then the text
 * colour (light text means a dark page).
 */
export function readTheme(env: ThemeEnv): ThemeReading {
  const properties: ThemeReading['properties'] = {}
  const resolved: Partial<Record<Token, string>> = {}
  for (const token of Object.keys(THEME_SOURCES) as Token[]) {
    for (const name of THEME_SOURCES[token]) {
      const value = env.readVar(name)
      const expression = value ? colorExpression(name, value) : null
      if (!expression) continue
      properties[`--fb-${token}`] = expression
      resolved[token] = normalizeColor(value) ?? undefined
      break
    }
  }

  const opaque = (c: RGBA | null): c is RGBA => c !== null && c[3] >= 0.5
  const page = env.pageBackgrounds().map(env.toRgba).find(opaque)
  const surface = page ?? (resolved.surface ? env.toRgba(resolved.surface) : null)
  const text = env.toRgba(env.textColor())
  const scheme: Scheme = opaque(surface) ? schemeFor(surface) : text && luminance(text) > 0.5 ? 'dark' : 'light'

  const accent = resolved.accent ? env.toRgba(resolved.accent) : null
  if (accent) properties['--fb-on-accent'] = luminance(accent) > ON_ACCENT_PIVOT ? '#000' : '#fff'
  return { scheme, properties }
}

/** Writes a reading onto the host: clears the previous one, sets the properties found, and marks the scheme. */
export function applyTheme(host: HTMLElement, reading: ThemeReading): void {
  for (const name of THEME_PROPERTIES) host.style.removeProperty(name)
  for (const [name, value] of Object.entries(reading.properties)) host.style.setProperty(name, value)
  host.setAttribute('data-scheme', reading.scheme)
}
