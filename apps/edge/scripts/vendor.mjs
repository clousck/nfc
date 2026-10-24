// Copia a public/ los scripts de terceros que se sirven como ficheros estáticos (Workers Assets).
// Se ejecuta antes de `wrangler dev` / `wrangler deploy` ([build] en wrangler.toml) y de los tests.
// public/ no se versiona: siempre sale de node_modules, con la versión fijada en package.json.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));

// Lector de QR para los móviles sin BarcodeDetector (Safari en iPhone). La versión va en el
// nombre para poder cachearlo sin miedo y debe coincidir con JSQR_PATH (src/loyalty/scanner.ts).
const jsqrPackage = require.resolve('jsqr/package.json');
const { version } = JSON.parse(readFileSync(jsqrPackage, 'utf8'));
const target = join(root, 'public', 'vendor', `jsqr-${version}.js`);
// Si se actualiza jsqr y no la página, el lector de iPhone daría 404: mejor fallar aquí.
const scanner = readFileSync(join(root, 'src', 'loyalty', 'scanner.ts'), 'utf8');
if (!scanner.includes(`'/vendor/jsqr-${version}.js'`)) {
  throw new Error(`JSQR_PATH en src/loyalty/scanner.ts no apunta a jsqr-${version}.js`);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(join(dirname(jsqrPackage), 'dist', 'jsQR.js'), target);

// Cabeceras de los estáticos: el nombre lleva la versión, así que se cachean un año.
writeFileSync(
  join(root, 'public', '_headers'),
  [
    '/vendor/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n'),
);
