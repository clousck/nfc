# nfc-platform

Plataforma NFC + QR para negocios locales. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Pieza                                | Dónde                                     | Docs                                              |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------- |
| Chips, tarjetas de fidelidad, canjes | Worker en `go.penginexr.com`              | [LOYALTY.md](docs/LOYALTY.md)                     |
| Portal de los negocios               | Mismo Worker en `negocios.penginexr.com`  | [BUSINESS-ACCOUNTS.md](docs/BUSINESS-ACCOUNTS.md) |
| Panel admin                          | Raspberry Pi en `nfc-admin.penginexr.com` | [ARCHITECTURE.md](docs/ARCHITECTURE.md)           |
| Seguridad y secretos                 | —                                         | [SECURITY.md](docs/SECURITY.md)                   |

Despliegue: cada push a `main` pasa los checks, aplica las migraciones D1 y despliega el Worker
(con sus dos dominios); la imagen del panel se publica en GHCR y la Pi se actualiza a mano con
"Update" en Dockge.

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

### Portal de negocios en local

`wrangler dev` reescribe el `Host` al de la ruta, así que el portal necesita su propia instancia
con `--host`. Sin `RESEND_API_KEY`, `MAIL_DEV_LOG=true` escribe el enlace de acceso en la
consola en lugar de enviarlo:

```sh
cd apps/edge
pnpm exec wrangler dev --local --port 8788 --host negocios.penginexr.com \
  --var INTERNAL_API_TOKEN:<el mismo> --var MAIL_DEV_LOG:true \
  --var PORTAL_ORIGIN:http://127.0.0.1:8788 --var PUBLIC_ORIGIN:http://127.0.0.1:8787
```

Crea la cuenta del dueño desde el panel local ("Acceso del dueño al portal") y pide el enlace
en http://127.0.0.1:8788/entrar.

Para desarrollar la UI con recarga en caliente: `pnpm dev` (API en :3000) y, en otra
terminal, `pnpm dev:web` (Vite en http://localhost:5173).
