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

// Tipografías de todas las páginas (subconjunto latino). Mismo esquema que jsQR: la versión va
// en el nombre y cada ruta debe aparecer tal cual en src/ui/theme.ts.
const theme = readFileSync(join(root, 'src', 'ui', 'theme.ts'), 'utf8');
const FONTS = [
  ['@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-sans'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500'],
];
for (const [pkg, file, name] of FONTS) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const fontVersion = JSON.parse(readFileSync(pkgJson, 'utf8')).version;
  const out = `${name}-${fontVersion}.woff2`;
  if (!theme.includes(`'/vendor/${out}'`)) {
    throw new Error(`src/ui/theme.ts no apunta a /vendor/${out}`);
  }
  copyFileSync(join(dirname(pkgJson), 'files', file), join(root, 'public', 'vendor', out));
}

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
