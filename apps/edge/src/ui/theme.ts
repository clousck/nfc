// Sistema visual de todas las páginas del Worker (docs/UI.md). Estilo "framed sheet": un marco
// tintado del verde azulado del producto y el trabajo sobre hojas blancas con borde de 1 px.
// IBM Plex Sans para todo; IBM Plex Mono solo para etiquetas físicas (números y códigos).
// Sin degradados ni sombras en reposo.

/** Rutas de las fuentes; deben coincidir con lo que genera scripts/vendor.mjs. */
export const FONT_SANS = '/vendor/ibm-plex-sans-5.3.0.woff2';
export const FONT_MONO_400 = '/vendor/ibm-plex-mono-400-5.3.0.woff2';
export const FONT_MONO_500 = '/vendor/ibm-plex-mono-500-5.3.0.woff2';

/** Marca de PengineXR: un sello circular con dos arcos de NFC. */
export const MARK_SVG =
  '<svg class="mark-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9.5" cy="12" r="6.5"/><circle cx="9.5" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M18 8a6.5 6.5 0 0 1 0 8"/><path d="M21 5.5a10.5 10.5 0 0 1 0 13"/></svg>';

export const THEME_CSS = `
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:100 700;font-display:swap;src:url(${FONT_SANS}) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;font-display:swap;src:url(${FONT_MONO_400}) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:500;font-display:swap;src:url(${FONT_MONO_500}) format("woff2")}
:root{color-scheme:light;
--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
--frame:#eef3f4;--sheet:#fff;--raised:#f4f7f8;--active:#e3eaec;--border:#e1e7e9;--rule:#edf1f2;--control:#c6ced1;
--text:#131416;--muted:#596165;
--accent:#1b6c80;--accent-ink:#0f4a59;--accent-soft:#e6f0f2;--accent-track:#c5dde3;
--positive:#1e7b4f;--positive-soft:#dcfae5;--positive-ink:#04250e;
--negative:#c4242a;--negative-soft:#ffedea;--negative-ink:#831c1e;
--warning:#92400e;--warning-soft:#fff6db;--warning-ink:#78350f;
--radius-sheet:16px;--radius:8px;--radius-control:6px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--frame);color:var(--text);font:400 15px/1.5 var(--sans);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.01em;line-height:1.25}
h1{font-size:24px}h2{font-size:16px}h3{font-size:15px}
p{margin:0}
a{color:var(--accent-ink);text-underline-offset:3px;text-decoration-thickness:1px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-family:var(--mono);font-weight:500;letter-spacing:0}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
.small{font-size:13px}
.mark{display:inline-flex;align-items:center;gap:10px;font-weight:600;font-size:15px;color:var(--text);text-decoration:none}
.mark .mark-glyph{color:var(--accent);flex:none}
.mark small{font-weight:400;color:var(--muted);font-size:13px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 16px;border-radius:var(--radius-control);border:1px solid var(--control);background:var(--sheet);color:var(--text);font:500 15px/1.2 var(--sans);text-decoration:none;text-align:center;cursor:pointer;transition:background-color .15s,border-color .15s,transform .1s}
.btn:hover{background:var(--raised);border-color:#9fabb0}
.btn:active{transform:translateY(1px)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-ink);border-color:var(--accent-ink)}
.btn-danger{color:var(--negative);border-color:#e7b3b1}
.btn-danger:hover{background:var(--negative-soft);border-color:var(--negative)}
.btn-quiet{border-color:transparent;background:transparent;color:var(--accent-ink);padding-left:0;padding-right:0}
.btn-quiet:hover{background:transparent;text-decoration:underline}
.btn-block{display:flex;width:100%}
.btn-lg{min-height:52px;font-size:16px;border-radius:10px;padding:12px 20px}
.field{display:grid;gap:6px;font-weight:500;font-size:14px}
.field input,.field select,.field textarea,.input{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--control);border-radius:var(--radius-control);background:#fff;color:var(--text);font:400 15px/1.4 var(--sans);transition:border-color .15s,box-shadow .15s}
.field input:focus,.field select:focus,.field textarea:focus,.input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.hint{font-size:13px;font-weight:400;color:var(--muted)}
.check{display:flex;align-items:flex-start;gap:10px;font-size:14px;font-weight:400}
.check input{flex:none;width:18px;height:18px;margin:2px 0 0;accent-color:var(--accent)}
.stack{display:grid;gap:16px}
.stack>.btn:not(.btn-block){justify-self:start}
.pill{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;flex:none;background:var(--active);color:#2f3537}
.pill-ok{background:var(--positive-soft);color:var(--positive-ink)}
.pill-warn{background:var(--warning-soft);color:var(--warning-ink)}
.pill-bad{background:var(--negative-soft);color:var(--negative-ink)}
.pill-accent{background:var(--accent-soft);color:var(--accent-ink)}
.panel{background:var(--sheet);border:1px solid var(--border);border-radius:var(--radius)}
.pad{padding:20px}
.well{background:var(--raised);border-radius:var(--radius);padding:16px}
.notice{padding:12px 14px;border-radius:var(--radius);font-size:14px;font-weight:500}
.notice-ok{background:var(--positive-soft);color:var(--positive-ink)}
.notice-bad{background:var(--negative-soft);color:var(--negative-ink)}
.notice-warn{background:var(--warning-soft);color:var(--warning-ink)}
.rows{list-style:none;margin:0;padding:0}
.rows>li{padding:12px 0;border-top:1px solid var(--rule)}
.rows>li:first-child{border-top:0}
.panel.rows{padding:4px 20px}
.qr-plate{background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border)}
.qr-plate svg{display:block;width:100%;height:auto}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

/**
 * Pantallas de teléfono (cliente y personal): una columna con su barra de acción fija abajo, en la
 * zona del pulgar. En pantallas grandes la columna se ve como un teléfono sobre el marco.
 */
export const DEVICE_CSS = `
body.device{font-size:16px}
.device .check{font-size:16px}
.device .field{font-size:15px}
.screen{max-width:480px;margin:0 auto;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--frame)}
@media (min-width:560px){.screen{margin:32px auto;min-height:calc(100dvh - 64px);border:1px solid var(--border);border-radius:24px;overflow:hidden}}
.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 4px;font-size:13px;color:var(--muted)}
.topline a{color:var(--muted)}
.content{flex:1;display:flex;flex-direction:column;gap:16px;padding:12px 20px 24px}
.actionbar{position:sticky;bottom:0;display:grid;gap:8px;padding:12px 20px calc(12px + env(safe-area-inset-bottom));background:var(--sheet);border-top:1px solid var(--border)}
.actionbar form{margin:0}
.foot-links{display:flex;justify-content:center;gap:20px;font-size:13px;padding:4px 0}
.foot-links a{color:var(--muted)}
.status{flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:40px 24px}
.status h1{font-size:30px;line-height:1.15;letter-spacing:-.02em}
.status p{font-size:16px;color:#2f3537}
.status .mark{margin-bottom:12px}
`;
