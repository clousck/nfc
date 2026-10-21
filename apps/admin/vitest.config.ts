import { defineConfig } from 'vitest/config';

// Separado de vite.config.ts (cuyo root es web/) para que los tests del servidor se encuentren.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
