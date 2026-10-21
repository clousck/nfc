/** Página genérica para slugs inexistentes o inactivos (en lugar de un 404 crudo). */
export const FALLBACK_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Enlace no disponible</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f7f9; color: #1f2328;
  }
  main { max-width: 22rem; padding: 2rem; text-align: center; }
  .icon { font-size: 3rem; line-height: 1; }
  h1 { font-size: 1.35rem; margin: 1rem 0 .5rem; }
  p { margin: 0; color: #59636e; line-height: 1.5; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    p { color: #9198a1; }
  }
</style>
</head>
<body>
<main>
  <div class="icon" aria-hidden="true">📡</div>
  <h1>Este enlace no está disponible</h1>
  <p>Puede que esté en mantenimiento o haya cambiado. Pide ayuda en el local o inténtalo más tarde.</p>
</main>
</body>
</html>`;
