// Sistema visual común de las páginas del Worker (tarjeta, canje, validador, portal, estadísticas).
// Un solo tono (frambuesa, la "tinta del sello") a plena fuerza solo en marcas pequeñas: el botón
// principal, los sellos y los datos. Sus tintes pálidos cubren las áreas. Sin degradados ni sombras.

/** Debe coincidir con el nombre que genera scripts/vendor.mjs (la versión va en el nombre). */
export const FONT_PATH = '/vendor/dm-sans-5.3.0.woff2';

export const THEME_CSS = `
@font-face{font-family:"DM Sans";font-style:normal;font-weight:100 1000;font-display:swap;src:url(${FONT_PATH}) format("woff2")}
:root{color-scheme:light;
--ground:#fbf7f8;--surface:#fff;--raised:#f4eef0;--border:#ebe3e6;--control:#d6ccd0;
--text:#1a1216;--muted:#62585d;
--accent:#b8336a;--accent-soft:#fdf2f7;--accent-track:#f8dbe8;--accent-ink:#6b1d3e;
--positive:#247b50;--positive-soft:#e3f4ea;--negative:#c4242a;--negative-soft:#ffedea;--warning:#92400e;--warning-soft:#fff6e0;
--radius:10px;--radius-control:8px;--gap:16px}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--ground);color:var(--text);font:400 16px/1.5 "DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
h1,h2,h3{margin:0;letter-spacing:-.015em;line-height:1.2}
h1{font-size:1.6rem;font-weight:700}
h2{font-size:1.125rem;font-weight:600}
p{margin:.5rem 0}
a{color:var(--accent-ink);text-underline-offset:3px}
.muted{color:var(--muted)}
.small{font-size:.8125rem}
.eyebrow{margin:0;font-size:.875rem;color:var(--muted);font-weight:500}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;position:relative;overflow:hidden}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:var(--radius-control);font:inherit;font-weight:600;text-align:center;text-decoration:none;color:var(--text);background:var(--surface);border:1px solid var(--control);cursor:pointer;width:100%;transition:transform .12s ease,background-color .15s ease,border-color .15s ease}
.btn:hover{border-color:var(--text)}
.btn:active{transform:scale(.98)}
.btn:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn-primary{background:var(--text);border-color:var(--text);color:#fff}
.btn-primary:hover{background:#000;border-color:#000}
.btn-reward{background:var(--accent);border-color:var(--accent);color:#fff;font-size:1.0625rem}
.btn-reward:hover{background:var(--accent-ink);border-color:var(--accent-ink)}
.btn-danger{background:var(--negative);border-color:var(--negative);color:#fff}
.btn-danger:hover{background:#9c1c21;border-color:#9c1c21}
input,select,textarea{font:inherit;color:var(--text)}
.alert{background:var(--negative-soft);color:#831c1e;padding:12px 14px;border-radius:var(--radius-control);font-weight:500}
.ok-note{background:var(--positive-soft);color:#14532d;padding:12px 14px;border-radius:var(--radius-control);font-weight:500}
.num,table{font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
