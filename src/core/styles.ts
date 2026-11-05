/**
 * The bar's one stylesheet, adopted into its shadow root. Tokens are
 * `--fb-*`: the theme step writes the page's colours onto the host, and
 * `--fernfly-*` lets a page override any of them in plain CSS.
 */
export const CSS = `
:host {
  all: initial;
  font: inherit;
  color: inherit;
  --fb-accent: var(--fernfly-accent, #15734a);
  --fb-on-accent: #fff;
  --fb-surface: var(--fernfly-surface, #fff);
  --fb-backdrop: rgb(15 20 18 / 0.28);
  --fb-shadow: 0 18px 50px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08);
  --fb-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
:host([data-scheme="dark"]) {
  color-scheme: dark;
  --fb-surface: var(--fernfly-surface, #1b1d1f);
  --fb-backdrop: rgb(0 0 0 / 0.55);
  --fb-shadow: 0 18px 50px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.06);
}
*, *::before, *::after { box-sizing: border-box; }
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 16px 16px;
  background: var(--fb-backdrop);
}
.panel {
  --fb-border: color-mix(in srgb, currentColor 14%, transparent);
  --fb-muted: color-mix(in srgb, currentColor 62%, transparent);
  --fb-hover: color-mix(in srgb, currentColor 8%, transparent);
  width: min(640px, 100%);
  max-height: min(72vh, 600px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--fb-text, currentColor);
  background: var(--fb-surface);
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  box-shadow: var(--fb-shadow);
}
[cmdk-root] { display: flex; flex-direction: column; min-height: 0; outline: none; }
[cmdk-input] {
  width: 100%;
  padding: 14px 16px;
  font: inherit;
  font-size: 16px;
  color: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--fb-border);
  outline: none;
}
[cmdk-input]::placeholder { color: var(--fb-muted); }
[cmdk-list] { max-height: 320px; overflow: auto; overscroll-behavior: contain; padding: 6px; }
[cmdk-group-heading] {
  padding: 8px 10px 4px;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fb-muted);
}
[cmdk-item] {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}
[cmdk-item][data-selected="true"] { background: var(--fb-hover); }
[cmdk-empty] { padding: 12px 10px; color: var(--fb-muted); }
.ask-key { font-family: var(--fb-mono); font-size: 12px; color: var(--fb-accent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px; }
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 9px;
  font: inherit;
  font-size: 13px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  cursor: pointer;
}
.chip:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
.chip[data-role="tool"] { color: var(--fb-on-accent); background: var(--fb-accent); border-color: var(--fb-accent); }
.chip[data-role="match"] { background: color-mix(in srgb, var(--fb-accent) 14%, transparent); border-color: transparent; }
.chip-key { font-family: var(--fb-mono); font-size: 11px; opacity: 0.75; }
.picker { margin: 0 12px 12px; border: 1px solid var(--fb-border); border-radius: 8px; }
.picker [cmdk-input] { padding: 8px 10px; font-size: 14px; }
.picker [cmdk-list] { max-height: 180px; }
.note { padding: 12px 16px; color: var(--fb-muted); }
.footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fb-muted);
  border-top: 1px solid var(--fb-border);
}
kbd { font-family: var(--fb-mono); font-size: 11px; }
`

const sheets = new WeakMap<Document, CSSStyleSheet>()

/**
 * The stylesheet for a document, built on first use and shared by every bar
 * in it. A constructed sheet can only be adopted into roots of the document
 * whose window built it, hence one per document.
 */
export function styleSheetFor(doc: Document): CSSStyleSheet {
  let sheet = sheets.get(doc)
  if (!sheet) {
    const Sheet = doc.defaultView?.CSSStyleSheet
    if (!Sheet) throw new Error('The intent bar needs constructable stylesheets')
    sheet = new Sheet()
    sheet.replaceSync(CSS)
    sheets.set(doc, sheet)
  }
  return sheet
}
