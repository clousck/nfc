# nfc-platform

Plataforma NFC + QR para negocios locales. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

- Node >= 22
- pnpm 10 (`corepack enable` o `corepack pnpm ...`)

## Comandos

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

## Panel admin en local

```sh
cd apps/admin
pnpm build
AUTH_DISABLED=true DATABASE_PATH=./data/dev.db pnpm start   # http://localhost:3000
```

Para probar contra un Worker local (sin tocar producción):

```sh
cd apps/edge
pnpm exec wrangler d1 migrations apply nfc-scans --local
pnpm exec wrangler dev --local --var INTERNAL_API_TOKEN:<32+ caracteres>   # http://127.0.0.1:8787
# en otra terminal, desde apps/admin:
AUTH_DISABLED=true DATABASE_PATH=./data/dev.db EDGE_URL=http://127.0.0.1:8787 INTERNAL_API_TOKEN=<el mismo> pnpm start
```

Para desarrollar la UI con recarga en caliente: `pnpm dev` (API en :3000) y, en otra
terminal, `pnpm dev:web` (Vite en http://localhost:5173).
