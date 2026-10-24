// Lector de QR en la pantalla del personal (/v): abre la cámara trasera y, al leer el QR de un
// canje, navega a /v/<código>. Usa BarcodeDetector (Chrome en Android) y, si el navegador no lo
// tiene (Safari en iPhone), carga jsQR desde los estáticos del Worker (scripts/vendor.mjs).

/** Debe coincidir con la versión de jsqr en package.json (scripts/vendor.mjs copia el fichero). */
export const JSQR_PATH = '/vendor/jsqr-1.4.0.js';

/** CSP de las páginas con lector: script propio con nonce y jsQR desde el mismo origen. */
export function scannerCsp(nonce: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'self'; img-src data:; media-src 'self' blob:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
}

/** Botón, vídeo y avisos del lector. */
export function scannerHtml(): string {
  return `<div class="scanner">
  <button type="button" id="scan-start" class="btn btn-primary">📷 Escanear QR</button>
  <div id="scan-view" class="scan-view" hidden>
    <div class="scan-box">
      <video id="scan-video" playsinline muted></video>
      <div class="scan-frame" aria-hidden="true"></div>
    </div>
    <button type="button" id="scan-stop" class="btn">Cancelar</button>
  </div>
  <p id="scan-msg" class="alert" role="status" hidden></p>
</div>`;
}

/** `autostart` abre la cámara al cargar (al venir de "Escanear otro"). */
export function scannerScript(nonce: string, autostart: boolean): string {
  return `<script nonce="${nonce}">
(() => {
  const startBtn = document.getElementById('scan-start');
  const view = document.getElementById('scan-view');
  const video = document.getElementById('scan-video');
  const msg = document.getElementById('scan-msg');
  let stream = null;
  let running = false;
  let decode = null;

  const say = (text) => { msg.textContent = text; msg.hidden = !text; };

  const stop = () => {
    running = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    view.hidden = true;
    startBtn.hidden = false;
  };

  // Un QR de canje es https://<este origen>/v/<código>. Cualquier otro QR se ignora.
  const handle = (text) => {
    let url;
    try { url = new URL(text, location.origin); } catch { url = null; }
    if (url && url.origin === location.origin && /^\\/v\\/[A-Za-z0-9-]+$/.test(url.pathname)) {
      stop();
      say('');
      location.assign(url.pathname);
      return true;
    }
    say('Ese QR no es un canje de este sistema. Apunta al QR de la pantalla del cliente.');
    return false;
  };

  const loadJsQR = () => new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = '${JSQR_PATH}';
    s.nonce = '${nonce}';
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR')));
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const makeDecoder = async () => {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          return async () => {
            const codes = await detector.detect(video);
            return codes.length ? codes[0].rawValue : null;
          };
        }
      } catch {}
    }
    const jsQR = await loadJsQR();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      // Basta con una imagen pequeña: más rápido y el QR ocupa buena parte del encuadre.
      const scale = Math.min(1, 640 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      return code ? code.data : null;
    };
  };

  const loop = async () => {
    if (!running) return;
    try {
      const text = video.readyState >= 2 ? await decode() : null;
      if (text && handle(text)) return;
    } catch {}
    setTimeout(loop, 200);
  };

  const start = async () => {
    say('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('Este navegador no puede usar la cámara. Escribe el código a mano.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch {
      say('No se pudo abrir la cámara. Revisa el permiso de cámara del navegador o escribe el código a mano.');
      return;
    }
    video.srcObject = stream;
    view.hidden = false;
    startBtn.hidden = true;
    try {
      await video.play();
      decode = decode || (await makeDecoder());
    } catch {
      stop();
      say('No se pudo iniciar el lector. Escribe el código a mano.');
      return;
    }
    running = true;
    loop();
  };

  startBtn.addEventListener('click', start);
  document.getElementById('scan-stop').addEventListener('click', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  ${autostart ? 'start();' : ''}
})();
</script>`;
}

/** Estilos del lector (se añaden a los de la página). */
export const SCANNER_STYLES = `
[hidden]{display:none!important}
.scanner{margin:16px 0}
.scan-view{margin-top:8px}
.scan-box{position:relative;overflow:hidden;border-radius:12px}
.scan-box video{width:100%;border-radius:12px;background:#000;display:block;aspect-ratio:1/1;object-fit:cover}
.scan-frame{position:absolute;inset:18%;border:3px solid #fff;border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.25);pointer-events:none}
.scan-view .btn{margin-top:8px;width:100%}
`;
