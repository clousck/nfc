import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrationsDir = fileURLToPath(new URL('../../infra/d1/migrations', import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsDir);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            INTERNAL_API_TOKEN: 'test-internal-token-0123456789abcdef',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
