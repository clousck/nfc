import { LOGIN_PATH } from '@nfc/shared';
import { esc } from '../html.js';
import type { PortalSession } from './session.js';

// Páginas del portal de negocios (negocios.penginexr.com). HTML sin JavaScript: formularios
// normales, CSP estricta y sin recursos externos.

const STYLES = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1f2328; --muted:#59636e;
    --line:#d1d9e0; --accent:#0969da; --accent-text:#fff; --warn-bg:#fff8c5; --warn-text:#7d4e00;
    --ok-bg:#dafbe1; --ok-text:#116329; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --card:#151b23; --text:#e6edf3;
    --muted:#9198a1; --line:#3d444d; --accent:#4493f8; --accent-text:#0d1117; --warn-bg:#2e2410;
    --warn-text:#d29922; --ok-bg:#12261e; --ok-text:#3fb950; } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    padding: .75rem 1rem; border-bottom: 1px solid var(--line); background: var(--card); }
  header .brand { font-weight: 600; }
  main { max-width: 40rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
  h1 { font-size: 1.4rem; margin: .5rem 0 1rem; }
  h2 { font-size: 1.1rem; margin: 0 0 .75rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 1.1rem; margin-bottom: 1rem; }
  .muted { color: var(--muted); }
  .small { font-size: .9rem; }
  .alert { background: var(--warn-bg); color: var(--warn-text); padding: .6rem .8rem;
    border-radius: 8px; }
  .ok { background: var(--ok-bg); color: var(--ok-text); padding: .6rem .8rem; border-radius: 8px; }
  form.stack { display: grid; gap: .75rem; }
  label { display: grid; gap: .3rem; font-weight: 500; }
  input, select { font: inherit; padding: .6rem .7rem; border: 1px solid var(--line);
    border-radius: 8px; background: var(--bg); color: var(--text); width: 100%; }
  .btn { font: inherit; display: inline-block; padding: .6rem 1rem; border-radius: 8px;
    border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer;
    text-decoration: none; text-align: center; }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text);
    font-weight: 600; }
  .btn-link { border: 0; background: none; color: var(--accent); padding: 0; cursor: pointer;
    font: inherit; }
  ul.plain { list-style: none; padding: 0; margin: 0; }
  ul.plain li + li { border-top: 1px solid var(--line); }
  ul.plain li { padding: .6rem 0; }
  .tag { display: inline-block; font-size: .8rem; padding: .1rem .5rem; border-radius: 999px;
    border: 1px solid var(--line); }
  .tag-ok { background: var(--ok-bg); color: var(--ok-text); border-color: transparent; }
  .tag-warn { background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
  details { margin-top: .75rem; }
  summary { cursor: pointer; color: var(--accent); }
  details form { margin-top: .5rem; }
  .card form + form, .card form + details { margin-top: .75rem; }
`;

export function layout(title: string, body: string, session?: PortalSession | null): string {
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
