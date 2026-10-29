import { THEME_CSS } from './ui/theme.js';

/** Página genérica para slugs inexistentes o inactivos (en lugar de un 404 crudo). */
export const FALLBACK_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Enlace no disponible</title>
<style>${THEME_CSS}
  body { min-height: 100vh; display: grid; place-items: center; }
  main { max-width: 24rem; padding: 2rem 1.25rem; }
  .mark { width: 44px; height: 44px; border-radius: 50%; border: 2px dashed var(--accent); background: var(--accent-soft); }
  h1 { font-size: 1.5rem; margin: 1.25rem 0 .5rem; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true"></div>
  <h1>Este enlace no está disponible</h1>
  <p>Puede que esté en mantenimiento o haya cambiado. Pide ayuda en el local o inténtalo más tarde.</p>
</main>
</body>
</html>`;

/** Respuesta con la página genérica; nunca se cachea (el chip puede reactivarse). */
export function fallbackResponse(status: 404 | 503 = 404): Response {
  return new Response(FALLBACK_HTML, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
