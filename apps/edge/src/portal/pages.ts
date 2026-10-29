import { LOGIN_PATH } from '@nfc/shared';
import { esc } from '../html.js';
import { MARK_SVG, THEME_CSS } from '../ui/theme.js';
import type { PortalBusiness, PortalSession } from './session.js';

// Armazón del portal de negocios (negocios.penginexr.com), docs/UI.md §3: en escritorio un marco
// tintado con la barra lateral y la barra superior, y el trabajo en una hoja blanca; en el móvil,
// cabecera y barra inferior con cinco destinos. Sin JavaScript: los menús son <details>.

const ICONS: Record<string, string> = {
  hoy: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 20h2M20 14v2"/>',
  chips:
    '<rect x="5" y="3.5" width="14" height="17" rx="3"/><path d="M10 9.5a3.5 3.5 0 0 1 0 5M13 8a6 6 0 0 1 0 8"/>',
  estadisticas: '<path d="M5 20V11M10 20V5M15 20v-7M20 20v-4"/>',
  personal: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  actividad:
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  contactos: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  mas: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function icon(name: keyof typeof ICONS | string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

export type NavKey = 'hoy' | 'qr' | 'chips' | 'estadisticas' | 'personal' | 'actividad';

const NAV_LABEL: Record<NavKey, string> = {
  hoy: 'Hoy',
  qr: 'QR del día',
  chips: 'Chips',
  estadisticas: 'Estadísticas',
  personal: 'Personal',
  actividad: 'Actividad',
};

const NAV_PATH: Record<NavKey, string> = {
  hoy: '',
  qr: '/qr',
  chips: '/chips',
  estadisticas: '/estadisticas',
  personal: '/personal',
  actividad: '/actividad',
};

function navKeys(loyalty: boolean): NavKey[] {
  return loyalty
    ? ['hoy', 'qr', 'chips', 'estadisticas', 'personal', 'actividad']
    : ['hoy', 'chips', 'estadisticas', 'personal', 'actividad'];
}

function logout(): string {
  return `<form method="post" action="/salir"><button type="submit" class="link-btn">Salir</button></form>`;
}

function switcher(session: PortalSession, business: PortalBusiness): string {
  const others = session.businesses.filter((b) => b.id !== business.id);
  if (others.length === 0) return `<p class="biz-name">${esc(business.name)}</p>`;
  return `<details class="biz-switch">
  <summary><span>${esc(business.name)}</span>${icon('chevron')}</summary>
  <ul>${others.map((b) => `<li><a href="/n/${esc(b.id)}">${esc(b.name)}</a></li>`).join('')}</ul>
</details>`;
}

/** Pantallas de un negocio: barra lateral, barra superior, hoja; en móvil barra inferior. */
export function appLayout(input: {
  title: string;
  session: PortalSession;
  business: PortalBusiness;
  current: NavKey;
  loyalty: boolean;
  body: string;
  extraHead?: string;
}): string {
  const { session, business, current, loyalty } = input;
  const base = `/n/${esc(business.id)}`;
  const aria = (key: NavKey) => (key === current ? ' aria-current="page"' : '');
  const links = navKeys(loyalty)
    .map(
      (key) =>
        `<a href="${base}${NAV_PATH[key]}"${aria(key)}>${icon(key)}<span>${NAV_LABEL[key]}</span></a>`,
    )
    .join('');
  const csv = loyalty
    ? `<a href="${base}/contactos.csv">${icon('contactos')}<span>Contactos (CSV)</span></a>`
    : '';
  const tabKeys: NavKey[] = loyalty
    ? ['hoy', 'qr', 'chips', 'personal']
    : ['hoy', 'chips', 'estadisticas', 'personal'];
  const moreKeys = navKeys(loyalty).filter((k) => !tabKeys.includes(k));
  const others = session.businesses.filter((b) => b.id !== business.id);
  const tabs = tabKeys
    .map(
      (key) =>
        `<a href="${base}${NAV_PATH[key]}"${aria(key)}>${icon(key, 20)}<span>${key === 'qr' ? 'QR' : NAV_LABEL[key]}</span></a>`,
    )
    .join('');
  const more = `<details class="more">
    <summary${moreKeys.includes(current) ? ' aria-current="page"' : ''}>${icon('mas', 20)}<span>Más</span></summary>
    <div class="more-menu">
      ${moreKeys.map((key) => `<a href="${base}${NAV_PATH[key]}">${NAV_LABEL[key]}</a>`).join('')}
      ${loyalty ? `<a href="${base}/contactos.csv">Contactos (CSV)</a>` : ''}
      ${others.map((b) => `<a href="/n/${esc(b.id)}">Ir a ${esc(b.name)}</a>`).join('')}
      <div class="more-foot"><span>${esc(session.email)}</span>${logout()}</div>
    </div>
  </details>`;
  return document(
    `${input.title} · ${business.name}`,
    `<div class="frame">
  <aside class="side" aria-label="Navegación">
    <a href="/" class="mark">${MARK_SVG}<span>PengineXR <small>Negocios</small></span></a>
    ${switcher(session, business)}
    <nav class="nav">${links}</nav>
    ${csv ? `<p class="side-label">Descargas</p><nav class="nav">${csv}</nav>` : ''}
  </aside>
  <header class="topbar">
    <p class="crumbs">${esc(business.name)} / <strong>${NAV_LABEL[current]}</strong></p>
    <div class="account"><span>${esc(session.email)}</span>${logout()}</div>
  </header>
  <header class="mobile-head">
    <a href="/" class="mark">${MARK_SVG}<span class="sr">PengineXR</span></a>
    <p>${esc(business.name)}</p>
  </header>
  <main class="sheet">
${input.body}
  </main>
  <nav class="tabbar" aria-label="Secciones">${tabs}${more}</nav>
</div>`,
    'app',
    input.extraHead,
  );
}

function document(title: string, body: string, bodyClass: string, extraHead = ''): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#eef3f4">
<title>${esc(title)} · Portal de negocios</title>
<style>${THEME_CSS}${STYLES}</style>
${extraHead}
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

/** Pantallas sin negocio elegido (inicio con varios negocios, mensajes): barra y hoja centrada. */
export function layout(
  title: string,
  body: string,
  session?: PortalSession | null,
  extraHead = '',
): string {
  return document(
    title,
    `<header class="simple-top">
  <a href="/" class="mark">${MARK_SVG}<span>PengineXR <small>Negocios</small></span></a>
  ${session ? `<div class="account"><span>${esc(session.email)}</span>${logout()}</div>` : ''}
</header>
<main class="simple-sheet">
${body}
</main>`,
    'app simple',
    extraHead,
  );
}

/** Acceso: el marco explica qué es el portal; la hoja tiene el formulario. */
function authLayout(title: string, body: string): string {
  const facts = [
    'Cambia a dónde lleva cada chip sin tocar el stand.',
    'Mira cuántas personas usan tus chips y tu tarjeta de sellos.',
    'Vincula los móviles de caja que validan los premios.',
  ];
  return document(
    title,
    `<div class="auth">
  <aside class="auth-side">
    <span class="mark">${MARK_SVG}<span>PengineXR <small>Negocios</small></span></span>
    <p class="auth-title">El portal de tu negocio</p>
    <ul class="auth-facts">${facts.map((f) => `<li>${icon('check')}<span>${f}</span></li>`).join('')}</ul>
  </aside>
  <main class="auth-main"><div class="auth-card">
${body}
  </div></main>
</div>`,
    'app auth-page',
  );
}

export function loginPage(input: { error?: string; email?: string } = {}): string {
  return authLayout(
    'Entrar',
    `<h1>Entrar</h1>
  <p class="muted">Escribe tu correo y te enviaremos un enlace para entrar. No hace falta contraseña.</p>
  ${input.error ? `<p class="notice notice-bad" role="alert">${esc(input.error)}</p>` : ''}
  <form method="post" action="${LOGIN_PATH}" class="stack">
    <label class="field">Correo
      <input type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(input.email ?? '')}">
    </label>
    <button type="submit" class="btn btn-primary btn-lg btn-block">Enviarme el enlace</button>
  </form>
  <p class="small muted">¿Tu negocio aún no tiene acceso? Pídeselo a quien te instaló los chips.</p>`,
  );
}

/** Igual exista o no la cuenta: así nadie puede averiguar qué correos tienen acceso. */
export function checkEmailPage(email: string): string {
  return authLayout(
    'Revisa tu correo',
    `<h1>Revisa tu correo</h1>
  <p>Si <strong>${esc(email)}</strong> tiene acceso a un negocio, te acabamos de enviar un enlace para entrar.</p>
  <p class="muted">Caduca en 15 minutos y sirve una sola vez. Si no lo ves, mira en la carpeta de spam.</p>
  <a class="btn btn-lg btn-block" href="${LOGIN_PATH}">Volver</a>`,
  );
}

/**
 * El enlace del correo abre esta página y es el botón el que entra. Los filtros de correo
 * (Outlook, Gmail, antivirus) abren los enlaces para analizarlos: si el GET gastara el enlace,
 * le llegaría gastado al dueño.
 */
export function confirmLoginPage(token: string): string {
  return authLayout(
    'Entrar',
    `<h1>Entrar al portal</h1>
  <p>Pulsa el botón para entrar en este dispositivo. La sesión dura 30 días.</p>
  <form method="post" action="${LOGIN_PATH}/${esc(token)}">
    <button type="submit" class="btn btn-primary btn-lg btn-block">Entrar</button>
  </form>`,
  );
}

export function invalidLinkPage(): string {
  return authLayout(
    'Enlace no válido',
    `<h1>Este enlace ya no sirve</h1>
  <p>Puede que haya caducado o que ya se haya usado (cada enlace sirve una sola vez).</p>
  <a class="btn btn-primary btn-lg btn-block" href="${LOGIN_PATH}">Pedir un enlace nuevo</a>`,
  );
}

export function messagePage(title: string, text: string, session?: PortalSession | null): string {
  return layout(
    title,
    `<h1>${esc(title)}</h1>
<p class="lead">${esc(text)}</p>
<a class="btn" href="/">Volver al inicio</a>`,
    session,
  );
}

export function homePage(session: PortalSession): string {
  const greeting = session.name ? `Hola, ${session.name}` : 'Tus negocios';
  const items = session.businesses
    .map(
      (b) =>
        `<li><a class="biz-row" href="/n/${esc(b.id)}"><span>${esc(b.name)}</span>${
          b.status === 'paused' ? '<span class="pill pill-warn">Pausado</span>' : ''
        }${icon('chevron')}</a></li>`,
    )
    .join('');
  return layout(
    'Inicio',
    `<h1>${esc(greeting)}</h1>
<p class="lead">Elige el negocio que quieres ver.</p>
<ul class="biz-list">${items}</ul>`,
    session,
  );
}

/** Correo con el enlace de acceso (texto y HTML). */
export function loginEmail(url: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Tu enlace para entrar al portal de negocios',
    text: `Hola:\n\nPara entrar al portal de tu negocio, abre este enlace:\n${url}\n\nCaduca en 15 minutos y sirve una sola vez. Si no lo pediste, ignora este correo.\n`,
    html: `<div style="font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif;color:#131416;max-width:480px">
<p style="font-weight:600;color:#1b6c80;margin:0 0 16px">PengineXR · Negocios</p>
<p>Hola:</p>
<p>Para entrar al portal de tu negocio, pulsa el botón:</p>
<p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:#1b6c80;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Entrar al portal</a></p>
<p style="color:#596165;font-size:14px">Caduca en 15 minutos y sirve una sola vez. Si no lo pediste, ignora este correo.</p>
</div>`,
  };
}

/** Componentes de las páginas del portal (los comparten business-pages y las estadísticas). */
export const STYLES = `
body.app{font-size:14px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.link-btn{border:0;background:none;padding:0;font:inherit;color:var(--accent-ink);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.account{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
.account form{margin:0}
.frame{display:grid;grid-template-columns:228px minmax(0,1fr);grid-template-rows:48px auto;min-height:100vh}
.side{grid-row:1/span 2;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:2px;padding:10px 12px 16px;overflow-y:auto}
.side .mark{height:38px;padding:0 8px;margin-bottom:12px}
.biz-name{padding:0 10px 14px;font-weight:600;font-size:15px}
.biz-switch{margin:0 0 14px}
.biz-switch summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;padding:6px 10px;border-radius:8px;background:var(--sheet);border:1px solid var(--border);font-weight:600}
.biz-switch ul{list-style:none;margin:6px 0 0;padding:6px;background:var(--sheet);border:1px solid var(--border);border-radius:8px}
.biz-switch li a{display:block;padding:8px 10px;border-radius:6px;color:var(--text);text-decoration:none}
.biz-switch li a:hover{background:var(--raised)}
.nav{display:grid;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:8px;color:#3d4447;text-decoration:none;transition:background-color .15s}
.nav a svg{color:#6b7478;flex:none}
.nav a:hover{background:var(--active)}
.nav a[aria-current=page]{background:var(--active);color:var(--text);font-weight:500}
.nav a[aria-current=page] svg{color:var(--accent)}
.side-label{font-size:12px;color:var(--muted);padding:20px 10px 6px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px 0 32px;min-width:0}
.crumbs{font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crumbs strong{color:var(--text);font-weight:500}
.sheet{grid-column:2;min-width:0;margin:0 8px 8px 0;background:var(--sheet);border:1px solid var(--border);border-radius:var(--radius-sheet);padding:28px 32px 56px}
.mobile-head,.tabbar{display:none}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:24px}
.page-head h1{font-size:24px}
.page-sub{margin-top:4px;font-size:15px;color:var(--muted)}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
.cols-even{grid-template-columns:repeat(2,minmax(0,1fr))}
.block{display:grid;gap:10px;align-content:start;min-width:0}
.block+.block{margin-top:24px}
.block-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.block-head h2{font-size:16px}
.block-head a{font-size:13px}
.flash{margin-bottom:20px}
.kpis{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));margin:0}
.kpis>div{padding:2px 20px;border-left:1px solid var(--border);min-width:0}
.kpis>div:first-child{padding-left:0;border-left:0}
.kpis dt{font-size:13px;color:var(--muted)}
.kpis dd{margin:6px 0 2px;font-size:28px;font-weight:400;letter-spacing:-.01em;line-height:1.15;font-variant-numeric:tabular-nums}
.kpis dd small{font-size:14px;color:var(--muted);margin-left:4px}
.kpis p{font-size:12px;color:var(--muted)}
.kpis details{margin-top:2px;font-size:13px}
.kpis details summary{color:var(--accent-ink);text-decoration:underline;text-underline-offset:3px}
.kpis details form{margin-top:10px}
.today{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:end}
.today-n{font-size:40px;font-weight:500;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.today-n small{font-size:16px;font-weight:400;color:var(--muted);margin-left:6px;letter-spacing:0}
.today-note{margin-top:8px;font-size:13px;color:var(--muted)}
.strip{position:relative;height:44px}
.strip-track{position:absolute;left:0;right:0;top:21px;height:2px;background:var(--active);border-radius:2px}
.strip-past{position:absolute;left:0;top:21px;height:2px;background:var(--accent-track);border-radius:2px}
.tick{position:absolute;top:10px;width:3px;height:24px;margin-left:-1.5px;border-radius:2px;background:var(--accent)}
.now{position:absolute;top:2px;bottom:0;border-left:1px dashed #8a9397}
.strip-axis{position:relative;height:18px;font-size:12px;color:var(--muted)}
.strip-axis span{position:absolute;top:0;transform:translateX(-50%);font-variant-numeric:tabular-nums}
.strip-axis span:first-child{transform:none}
.strip-axis span:last-child{transform:translateX(-100%)}
.strip-empty{font-size:13px;color:var(--muted)}
.chip-rows>li{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center}
.chip-no{font-family:var(--mono);font-weight:500;color:var(--muted)}
.chip-main{min-width:0}
.chip-main strong{font-weight:500;display:block}
.chip-main span{display:block;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.events>li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px}
.events time{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.events .who{grid-column:1/-1;font-size:12px;color:var(--muted)}
.lead{font-size:16px;color:#2f3537;margin:6px 0 20px}
.simple-top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 24px;max-width:760px;margin:0 auto}
.simple-sheet{max-width:712px;margin:8px auto 40px;background:var(--sheet);border:1px solid var(--border);border-radius:var(--radius-sheet);padding:32px}
.biz-list{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--radius)}
.biz-list li+li{border-top:1px solid var(--rule)}
.biz-row{display:flex;align-items:center;gap:12px;padding:16px 18px;color:var(--text);text-decoration:none;font-weight:500;font-size:15px}
.biz-row span:first-child{flex:1}
.biz-row:hover{background:var(--raised)}
.auth{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);min-height:100vh}
.auth-side{display:flex;flex-direction:column;gap:28px;padding:36px 48px}
.auth-title{font-size:30px;font-weight:600;line-height:1.15;letter-spacing:-.02em;max-width:16ch;margin-top:48px}
.auth-facts{list-style:none;margin:0;padding:0;display:grid;gap:14px;font-size:16px;max-width:36ch}
.auth-facts li{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.auth-facts svg{color:var(--accent);margin-top:3px}
.auth-main{display:flex;align-items:center;justify-content:center;margin:8px 8px 8px 0;padding:40px;background:var(--sheet);border:1px solid var(--border);border-radius:var(--radius-sheet)}
.auth-card{width:min(100%,380px);display:grid;gap:16px}
.auth-card h1{font-size:26px}
@media (max-width:900px){
  .frame{display:block}
  .side,.topbar{display:none}
  .mobile-head{display:flex;align-items:center;gap:12px;height:52px;padding:0 16px;position:sticky;top:0;z-index:5;background:var(--frame)}
  .mobile-head p{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sheet{margin:0;border:0;border-radius:0;padding:20px 16px 104px;min-height:calc(100vh - 52px)}
  .tabbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--sheet);border-top:1px solid var(--border);padding:4px 4px calc(4px + env(safe-area-inset-bottom))}
  .tabbar a,.tabbar summary{display:grid;justify-items:center;gap:2px;padding:8px 0;font-size:12px;color:var(--muted);text-decoration:none}
  .tabbar [aria-current]{color:var(--accent-ink);font-weight:500}
  .more{position:relative}
  .more-menu{position:absolute;right:4px;bottom:calc(100% + 10px);width:240px;display:grid;padding:6px;background:var(--sheet);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 30px rgba(19,20,22,.14)}
  .more-menu a{padding:12px;border-radius:8px;color:var(--text);text-decoration:none;font-size:15px}
  .more-menu a:hover{background:var(--raised)}
  .more-foot{display:flex;justify-content:space-between;gap:8px;padding:12px;border-top:1px solid var(--rule);font-size:13px;color:var(--muted)}
  .more-foot span{overflow:hidden;text-overflow:ellipsis}
  .cols,.cols-even{grid-template-columns:1fr}
  .page-head{flex-direction:column;align-items:stretch}
  .page-head .btn{width:100%;min-height:48px}
  .kpis{grid-template-columns:1fr 1fr;row-gap:18px}
  .kpis>div:nth-child(odd){padding-left:0;border-left:0}
  .today{grid-template-columns:1fr;gap:12px}
  .simple-top{padding:14px 16px}
  .simple-sheet{margin:0 0 24px;border-radius:0;border-left:0;border-right:0;padding:24px 16px}
  .auth{grid-template-columns:1fr;min-height:auto}
  .auth-side{padding:20px 20px 4px;gap:0}
  .auth-title,.auth-facts{display:none}
  .auth-main{margin:12px;padding:28px 20px;align-items:flex-start}
}
`;
