import { LOGIN_PATH } from '@nfc/shared';
import { esc } from '../html.js';
import { THEME_CSS } from '../ui/theme.js';
import type { PortalSession } from './session.js';

// Páginas del portal de negocios (negocios.penginexr.com). HTML sin JavaScript: formularios
// normales, CSP estricta y sin recursos externos.

const STYLES = `${THEME_CSS}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:14px 20px;max-width:56rem;margin:0 auto}
header .brand{display:inline-flex;align-items:center;gap:10px;font-weight:600}
header .brand::before{content:"";width:22px;height:22px;border-radius:50%;border:2px solid var(--accent);background:var(--accent-soft)}
header form{display:flex;align-items:center;gap:12px}
main{max-width:56rem;margin:0 auto;padding:8px 20px 64px}
main>h1{font-size:1.5rem;margin:20px 0 16px}
.back{font-size:.875rem;color:var(--muted)}
.biz{margin:12px 0 4px;color:var(--muted);font-weight:500}
.tabs{display:flex;gap:4px;overflow-x:auto;margin:0 -4px 8px;padding-bottom:2px;scrollbar-width:none}
.tabs a{flex:none;padding:8px 12px;border-radius:var(--radius-control);color:var(--muted);text-decoration:none;font-weight:500;font-size:.9375rem;transition:background-color .15s,color .15s}
.tabs a:hover{background:var(--raised);color:var(--text)}
.tabs a[aria-current=page]{background:var(--accent-soft);color:var(--accent-ink)}
.card{margin-bottom:16px}
.card h2{margin-bottom:12px}
.ok{background:var(--positive-soft);color:#14532d;padding:12px 14px;border-radius:var(--radius-control);font-weight:500}
form.stack{display:grid;gap:14px}
label{display:grid;gap:6px;font-weight:500;font-size:.9375rem}
input,select{min-height:44px;padding:10px 12px;border:1px solid var(--control);border-radius:var(--radius-control);background:var(--surface);width:100%;transition:border-color .15s}
input:focus,select:focus{border-color:var(--accent);outline:none}
.btn{display:inline-flex;width:auto;min-height:44px}
form.stack .btn{justify-self:start}
.btn-primary{background:var(--accent);border-color:var(--accent)}
.btn-primary:hover{background:var(--accent-ink);border-color:var(--accent-ink)}
.btn-link{border:0;background:none;color:var(--accent-ink);padding:0;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:3px}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li+li{border-top:1px solid var(--border)}
ul.plain li{padding:12px 0}
.tag{display:inline-block;font-size:.8125rem;font-weight:500;padding:2px 10px;border-radius:999px;background:var(--raised);color:var(--muted)}
.tag-ok{background:var(--positive-soft);color:#14532d}
.tag-warn{background:var(--warning-soft);color:var(--warning)}
details{margin-top:12px}
summary{cursor:pointer;color:var(--accent-ink);font-weight:500}
details form{margin-top:10px}
.card form+form,.card form+details{margin-top:12px}
.qr{max-width:20rem;margin:16px auto;background:#fff;padding:14px;border-radius:var(--radius);border:2px solid var(--accent)}
.qr svg{display:block;width:100%;height:auto}
.break{word-break:break-all}
.qr-big{max-width:min(28rem,80vw);border-width:3px}
.qr-stage{text-align:center}
.qr-stage p{max-width:32rem;margin-left:auto;margin-right:auto}
@media (max-width:600px){header,main{padding-left:16px;padding-right:16px}}
`;

export function layout(
  title: string,
  body: string,
  session?: PortalSession | null,
  extraHead = '',
): string {
  const user = session
    ? `<form method="post" action="/salir"><span class="muted small">${esc(session.email)}</span>
       <button type="submit" class="btn-link small">Salir</button></form>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Portal de negocios</title>
<style>${STYLES}</style>
${extraHead}
</head>
<body>
<header><a href="/" class="brand" style="color:inherit;text-decoration:none">Portal de negocios</a>${user}</header>
<main>
${body}
</main>
</body>
</html>`;
}

export function loginPage(input: { error?: string; email?: string } = {}): string {
  return layout(
    'Entrar',
    `<h1>Entrar</h1>
<section class="card">
  <p class="muted">Escribe tu correo y te enviaremos un enlace para entrar. No hace falta contraseña.</p>
  ${input.error ? `<p class="alert">${esc(input.error)}</p>` : ''}
  <form method="post" action="${LOGIN_PATH}" class="stack">
    <label>Correo
      <input type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(input.email ?? '')}">
    </label>
    <button type="submit" class="btn btn-primary">Enviarme el enlace</button>
  </form>
</section>
<p class="muted small">¿Tu negocio aún no tiene acceso? Pídeselo a quien te instaló los chips.</p>`,
  );
}

/** Igual exista o no la cuenta: así nadie puede averiguar qué correos tienen acceso. */
export function checkEmailPage(email: string): string {
  return layout(
    'Revisa tu correo',
    `<h1>Revisa tu correo</h1>
<section class="card">
  <p>Si <strong>${esc(email)}</strong> tiene acceso a un negocio, te acabamos de enviar un enlace para entrar.</p>
  <p class="muted small">Caduca en 15 minutos y sirve una sola vez. Si no lo ves, mira en la carpeta de spam.</p>
  <a class="btn" href="${LOGIN_PATH}">Volver</a>
</section>`,
  );
}

/**
 * El enlace del correo abre esta página y es el botón el que entra. Los filtros de correo
 * (Outlook, Gmail, antivirus) abren los enlaces para analizarlos: si el GET gastara el enlace,
 * le llegaría gastado al dueño.
 */
export function confirmLoginPage(token: string): string {
  return layout(
    'Entrar',
    `<h1>Entrar al portal</h1>
<section class="card">
  <p>Pulsa el botón para entrar en este dispositivo. La sesión dura 30 días.</p>
  <form method="post" action="${LOGIN_PATH}/${esc(token)}" class="stack">
    <button type="submit" class="btn btn-primary">Entrar</button>
  </form>
</section>`,
  );
}

export function invalidLinkPage(): string {
  return layout(
    'Enlace no válido',
    `<h1>Este enlace ya no sirve</h1>
<section class="card">
  <p>Puede que haya caducado o que ya se haya usado (cada enlace sirve una sola vez).</p>
  <a class="btn btn-primary" href="${LOGIN_PATH}">Pedir un enlace nuevo</a>
</section>`,
  );
}

export function messagePage(title: string, text: string, session?: PortalSession | null): string {
  return layout(
    title,
    `<h1>${esc(title)}</h1><section class="card"><p>${esc(text)}</p><a class="btn" href="/">Volver</a></section>`,
    session,
  );
}

export function homePage(session: PortalSession): string {
  const greeting = session.name ? `Hola, ${session.name}` : 'Hola';
  const items = session.businesses
    .map(
      (b) =>
        `<li><a href="/n/${esc(b.id)}">${esc(b.name)}</a>${b.status === 'paused' ? ' <span class="muted small">(pausado)</span>' : ''}</li>`,
    )
    .join('');
  return layout(
    'Inicio',
    `<h1>${esc(greeting)}</h1>
<section class="card">
  <h2>Tus negocios</h2>
  <ul class="plain">${items}</ul>
</section>`,
    session,
  );
}

/** Correo con el enlace de acceso (texto y HTML). */
export function loginEmail(url: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Tu enlace para entrar al portal de negocios',
    text: `Hola:\n\nPara entrar al portal de tu negocio, abre este enlace:\n${url}\n\nCaduca en 15 minutos y sirve una sola vez. Si no lo pediste, ignora este correo.\n`,
    html: `<p>Hola:</p>
<p>Para entrar al portal de tu negocio, pulsa el botón:</p>
<p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#0969da;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Entrar al portal</a></p>
<p style="color:#59636e;font-size:14px">Caduca en 15 minutos y sirve una sola vez. Si no lo pediste, ignora este correo.</p>`,
  };
}
