/**
 * The settings page's stylesheet.
 *
 * Every color is a `--dsw-alias-*` theme token, never a literal, so light and
 * dark both work and a renamed token degrades instead of breaking. The tag is
 * created from the bundle's own factory body, so the client module system claims
 * it and removes it when the plugin is disabled.
 *
 * The page renders inside the Settings shell, which owns the scroll container,
 * so this sheet sets no height, no scrolling and no page-level max-width. Class
 * names carry the `dst-` prefix, derived from the plugin id.
 *
 * @module dsh-session-title/client/styles
 */

/** Id of the stylesheet tag, so injection stays idempotent. */
export const STYLE_ID = 'dsh-session-title-style'

/** Theme-token-only stylesheet for the settings page. */
export const SECTION_CSS = `
.dst-page{display:flex;flex-direction:column;gap:22px;padding:4px 2px 32px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;-webkit-font-smoothing:antialiased}
.dst-head{display:flex;flex-direction:column;gap:6px}
.dst-head-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:0}
.dst-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dst-credit{margin-left:6px;font-size:12px;font-weight:500;line-height:1;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap}
.dst-description{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;max-width:70ch}
.dst-effective{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
.dst-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.dst-group-head{display:flex;flex-direction:column;gap:4px}
.dst-group-title{margin:0;font-size:13px;font-weight:600;line-height:20px}
.dst-group-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;max-width:72ch}
.dst-choice{display:flex;flex-direction:column;gap:8px}
.dst-option{display:grid;grid-template-columns:18px minmax(0,1fr);gap:2px 10px;align-items:start;cursor:pointer}
.dst-option input{margin:3px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.dst-option-title{font-size:13px;font-weight:560;color:var(--dsw-alias-label-primary)}
.dst-option-hint{grid-column:2;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
.dst-row{display:grid;grid-template-columns:minmax(130px,180px) minmax(0,1fr);gap:6px 16px;align-items:start}
.dst-label{font-size:13px;color:var(--dsw-alias-label-primary);padding-top:6px}
.dst-control{display:flex;flex-direction:column;gap:4px;min-width:0}
.dst-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.dst-input,.dst-select{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 10px;min-width:0;box-sizing:border-box}
.dst-input:focus-visible,.dst-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}
.dst-input[data-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dst-switch{position:relative;width:38px;height:21px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;flex:none;margin-top:3px}
.dst-switch::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-secondary));transition:transform .15s ease}
.dst-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent}
.dst-switch[aria-checked="true"]::after{transform:translateX(17px);background:var(--dsw-alias-label-primary-foreground)}
.dst-switch:disabled{opacity:.45;cursor:default}
.dst-switch-row{display:flex;align-items:flex-start;gap:12px}
.dst-switch-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dst-footer{position:sticky;bottom:0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0 2px;background:linear-gradient(to top,var(--dsw-alias-bg-layer-1),transparent)}
.dst-button{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:6px 14px;cursor:pointer}
.dst-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dst-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dst-button:disabled{opacity:.45;cursor:default}
.dst-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dst-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dst-ok{font-size:12px;color:var(--dsw-alias-state-success-primary)}
.dst-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.dst-dirty{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dst-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
`

/** Append the stylesheet once per document. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = SECTION_CSS
  document.head.append(style)
}