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

Para desarrollar la UI con recarga en caliente: `pnpm dev` (API en :3000) y, en otra
terminal, `pnpm dev:web` (Vite en http://localhost:5173).
