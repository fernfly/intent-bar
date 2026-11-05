import { styleSheetFor } from './styles'

/** The tag of the bar's host element. A custom element name keeps page rules like `body > div` off it. */
export const HOST_TAG = 'fernfly-intent-bar'

/** Key events that must not reach the page while the user types in the bar. */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'keypress'] as const

/** The bar's place in the page: the host element, its shadow root, and the node React renders into. */
export interface ShadowMount {
  host: HTMLElement
  root: ShadowRoot
  container: HTMLDivElement
  destroy(): void
}

/**
 * Creates the bar's host at the end of `document.body`, with an open shadow
 * root and the stylesheet adopted (never a `<style>` element, so a strict CSP
 * still applies). Key events are stopped at the host: past it they are
 * retargeted to the host element, so the page's "ignore while typing" guards
 * would not recognise the bar's input and its single-key shortcuts would fire.
 */
export function createShadowMount(doc: Document = document): ShadowMount {
  const host = doc.createElement(HOST_TAG)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [styleSheetFor(doc)]
  const container = doc.createElement('div')
  root.append(container)
  const stop = (e: Event) => e.stopPropagation()
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, stop)
  doc.body.append(host)
  return {
    host,
    root,
    container,
    destroy() {
      for (const type of ISOLATED_EVENTS) host.removeEventListener(type, stop)
      host.remove()
    },
  }
}
