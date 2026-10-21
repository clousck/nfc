import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env } from '../src/env.js';

declare global {
  namespace Cloudflare {
    interface Env extends EdgeEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

type EdgeEnv = Env;
