import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'server/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @nfc/shared se publica como TypeScript: se incluye en el bundle.
  noExternal: ['@nfc/shared'],
});
