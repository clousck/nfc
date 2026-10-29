import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// wrangler.toml declara [assets] en public/, que genera este script (no se versiona).
execFileSync(process.execPath, [fileURLToPath(new URL('./scripts/vendor.mjs', import.meta.url))]);

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
            PRESENCE_MASTER_KEY: 'test-presence-master-key-0123456789abcdef',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
