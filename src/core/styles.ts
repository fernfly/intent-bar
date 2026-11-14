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
  --fb-danger: var(--fernfly-danger, #b42318);
  --fb-backdrop: rgb(15 20 18 / 0.28);
  --fb-shadow: 0 18px 50px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08);
  --fb-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
:host([data-scheme="dark"]) {
  color-scheme: dark;
  --fb-surface: var(--fernfly-surface, #1b1d1f);
  --fb-danger: var(--fernfly-danger, #f97066);
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
.chip[data-role="set"] { background: transparent; border-color: var(--fb-accent); }
.chip[data-role="add"] { color: var(--fb-muted); border-style: dashed; }
.chip[data-status="pending"] { opacity: 0.7; }
.chip[data-status="choose"] { border-color: var(--fb-accent); border-style: dashed; }
.chip[data-status="missing"], .chip[data-status="failed"] { border-color: var(--fb-danger); }
.chip-key { font-family: var(--fb-mono); font-size: 11px; opacity: 0.75; }
.chip-flag { font-size: 11px; color: var(--fb-muted); }
.chip[data-status="missing"] .chip-flag, .chip[data-status="failed"] .chip-flag { color: var(--fb-danger); }
.picker { margin: 0 12px 12px; border: 1px solid var(--fb-border); border-radius: 8px; }
.picker [cmdk-input], .picker-field {
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--fb-border);
  outline: none;
}
.picker [cmdk-list] { max-height: 180px; }
.picker [cmdk-item][data-danger] { color: var(--fb-danger); }
.picker-note { margin: 0; padding: 8px 10px; font-size: 13px; color: var(--fb-muted); }
.picker-actions { display: flex; gap: 6px; padding: 8px 10px; }
.item-detail { margin-left: auto; font-size: 12px; color: var(--fb-muted); }
.note { margin: 0; padding: 12px 16px; color: var(--fb-muted); }
.notice { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--fb-muted); border-bottom: 1px solid var(--fb-border); }
button {
  font: inherit;
  font-size: 13px;
  color: inherit;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
button:disabled { opacity: 0.5; cursor: default; }
button[data-danger] { color: var(--fb-danger); }
button.primary { color: var(--fb-on-accent); background: var(--fb-accent); border-color: var(--fb-accent); }
button.primary kbd { opacity: 0.8; }
button.primary[data-countdown] {
  background-image: linear-gradient(var(--fb-fill), var(--fb-fill));
  background-repeat: no-repeat;
  background-size: 0% 100%;
  animation: fb-countdown var(--fb-countdown, 3s) linear forwards;
  --fb-fill: color-mix(in srgb, var(--fb-on-accent) 24%, transparent);
}
@keyframes fb-countdown { to { background-size: 100% 100%; } }
@media (prefers-reduced-motion: reduce) {
  button.primary[data-countdown] { animation: none; background-image: none; }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.result { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px 12px; }
.result-line { margin: 0; font-size: 13px; }
.result-line[data-tone="wait"] { color: var(--fb-muted); }
.result-line[data-tone="stop"] { color: var(--fb-danger); }
.result-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-left: auto; }
.confirm { padding: 12px 16px; }
.confirm-title { margin: 0 0 8px; font-weight: 600; }
.confirm .note { padding: 4px 0; }
.confirm .result-actions { padding-top: 8px; }
.sample { margin: 0; padding: 0 0 0 18px; font-size: 13px; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 2147483001;
  translate: -50% 0;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 14px;
  font-size: 14px;
  color: var(--fb-text, currentColor);
  background: var(--fb-surface);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 10px;
  box-shadow: var(--fb-shadow);
}
.toast progress { width: 96px; accent-color: var(--fb-accent); }
.launcher {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147482999;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--fb-on-accent);
  background: var(--fb-accent);
  border: 0;
  border-radius: 999px;
  box-shadow: var(--fb-shadow);
}
.launcher kbd { opacity: 0.8; }
.toast-count, .toast-note { font-size: 12px; color: color-mix(in srgb, currentColor 62%, transparent); }
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fb-muted);
  border-top: 1px solid var(--fb-border);
}
.footer-keys { margin-left: auto; }
.brand { color: inherit; text-decoration: none; border-radius: 3px; }
.brand:hover { color: var(--fb-text, currentColor); text-decoration: underline; text-underline-offset: 2px; }
.brand:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
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
