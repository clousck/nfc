import { DEVICE_CSS, MARK_SVG, THEME_CSS } from './ui/theme.js';

/** Página genérica para slugs inexistentes o inactivos (en lugar de un 404 crudo). */
export const FALLBACK_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Enlace no disponible</title>
<style>${THEME_CSS}${DEVICE_CSS}</style>
</head>
<body class="device">
<div class="screen">
<main class="status">
  <span class="mark">${MARK_SVG}<span>PengineXR</span></span>
  <h1>Este enlace no está disponible</h1>
  <p>Puede que esté en mantenimiento o haya cambiado. Pide ayuda en el local o inténtalo más tarde.</p>
</main>
</div>
</body>
</html>`;

/** Respuesta con la página genérica; nunca se cachea (el chip puede reactivarse). */
export function fallbackResponse(status: 404 | 503 = 404): Response {
  return new Response(FALLBACK_HTML, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
