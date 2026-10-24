# Plataforma NFC para negocios — Arquitectura

> Nombre provisional del repo: `nfc`. Reemplazar cuando haya nombre definitivo.
>
> Relacionados: [BUSINESS-ACCOUNTS.md](BUSINESS-ACCOUNTS.md) (cuentas de negocio, planos de
> control y de datos, prueba de presencia) · [SECURITY.md](SECURITY.md) · [LOYALTY.md](LOYALTY.md).

## 1. Objetivo

Vender stands con chip NFC + código QR a negocios locales. Cada chip apunta a una URL propia
que redirige al destino del negocio (reseñas de Google, WhatsApp, Instagram, menú, landing).

Requisitos que guían el diseño:

1. **Los redirects nunca deben depender de la Raspberry Pi** ni de la conexión de casa.
2. El destino de un chip se puede cambiar sin tocar el chip (los chips se bloquean permanentemente).
3. Cada escaneo se registra para mostrar estadísticas al negocio.
4. Costo de infraestructura ≈ $0 al inicio (plan gratuito de Cloudflare + Pi existente).

## 2. Principio central

**Lo que toca el cliente final vive en el edge (Cloudflare). Lo que puede esperar vive en la Pi.**

```
                         ┌──────────────────────────────────────────┐
  Chip NFC / QR  ───────▶│  Cloudflare Worker  (apps/edge)          │
  go.penginexr.com/<slug>│  ├─ KV  LINKS   → slug → destino         │
                         │  ├─ KV  LANDINGS→ config de landing      │
                         │  └─ D1  events  → registro de escaneos   │
                         └──────────────▲───────────────────────────┘
                                        │ API interna /internal/* (INTERNAL_API_TOKEN)
                                        │  - la Pi envía su estado; el Worker escribe KV
                                        │  - el Worker responde estadísticas y fidelidad
                         ┌──────────────┴───────────────────────────┐
  Victor (admin) ───────▶│  Raspberry Pi  (apps/admin)              │
  nfc-admin.penginexr.com│  Dockge stack, túnel cloudflared propio  │
  (Cloudflare Access)    │  ├─ API + UI de administración           │
                         │  ├─ SQLite: negocios, chips, planes      │
                         │  └─ Backups → /mnt/usb                   │
                         └──────────────────────────────────────────┘
```

Si la Pi se cae: redirects, landings y registro de escaneos **siguen funcionando**.
Solo deja de estar disponible el panel de administración.

## 3. Componentes

### 3.1 `apps/edge` — Cloudflare Worker

- **Stack**: TypeScript + Hono + Wrangler.
- **Rutas**:
  - `GET /:slug` → busca `LINKS:<slug>` en KV.
    - `type: "redirect"` → `302` al destino.
    - `type: "landing"` → renderiza HTML de la landing desde `LANDINGS:<businessId>` (plantilla en el Worker).
    - No existe o `active: false` → página genérica amable (no 404 crudo).
  - `GET /:slug?s=q` → igual, pero marca el origen como QR (la URL del QR incluye `?s=q`; la del chip no).
  - `GET /health` → `200 ok`.
- **Registro del escaneo**: `ctx.waitUntil(insert en D1)` para no retrasar el redirect.
- **Datos guardados por escaneo** (sin IP, sin datos personales):
  `slug, ts, source (nfc|qr), os (ios|android|other), country, city (de request.cf), is_bot`.
- **Bots**: marcar `is_bot = 1` para crawlers de previsualización (WhatsApp, Facebook, Telegram, Slack, etc.)
  por User-Agent. Se guardan pero se excluyen de las estadísticas.
- **Formato KV**:
  ```jsonc
  // LINKS:<slug>
  { "type": "redirect", "url": "https://g.page/r/XXXX/review", "businessId": "b_01", "active": true }
  { "type": "landing", "businessId": "b_01", "active": true }

  // LANDINGS:<businessId>
  { "name": "Café X", "logo": "...", "theme": "dark",
    "links": [ { "label": "Déjanos tu reseña", "url": "...", "icon": "google" },
               { "label": "Pedidos por WhatsApp", "url": "https://wa.me/593...", "icon": "whatsapp" } ] }
  ```

### 3.2 `apps/admin` — Panel en la Raspberry Pi

- **Stack**: Node + Hono (API) + React/Vite (UI estática servida por Hono) + SQLite con Drizzle ORM.
  - Decidido (2026-10-21): React + Vite. Se descartó SvelteKit.
- **Despliegue**: contenedor Docker en un stack de Dockge, expuesto como `nfc-admin.penginexr.com` vía cloudflared.
- **Autenticación**: **Cloudflare Access** delante de `nfc-admin.penginexr.com` (login por email/OTP).
  La app no implementa login en la Fase 1; valida el header `Cf-Access-Jwt-Assertion`.
- **Responsabilidades**:
  - CRUD de negocios, chips y landings.
  - Al guardar un chip o negocio → nota en la cola `publish_queue` (misma transacción) y envío a `/internal/*` del Worker, que es el único que escribe en KV. Si falla, se reintenta solo (30 s → 15 min). SQLite es la fuente de verdad.
  - Botón "Re-sincronizar todo": envía la foto completa; el Worker deja KV igual escribiendo solo lo que cambió.
  - Generar slug, URL final y QR (SVG/PNG) listos para imprimir.
  - Estadísticas y fidelidad: se las pide al Worker (`/internal/*`); D1 tiene un solo dueño.
  - **Escritura del chip con Web NFC** (Chrome en Android): página que escribe la URL en el chip y
    lo bloquea con `makeReadOnly()`. Fallback: copiar URL y escribir con NFC Tools.

### 3.3 `packages/shared`

- Tipos y esquemas **Zod** compartidos: `LinkRecord`, `LandingConfig`, `ScanEvent`.
- Utilidades: generación de slug, detección de SO y bots por User-Agent, construcción de URLs (NFC vs QR).

### 3.4 `infra/`

- `docker-compose.yml` del admin (para pegar en Dockge).
- Config de referencia de cloudflared (túnel propio del stack: `nfc-admin.penginexr.com → http://nfc-admin:3000`).
- `backup.sh` + timer systemd.
- Migraciones D1 (`infra/d1/migrations/*.sql`).

## 4. Modelo de datos

### SQLite (Pi) — fuente de verdad

```sql
businesses (
  id TEXT PRIMARY KEY,          -- b_<nanoid>
  name TEXT NOT NULL,
  contact_name TEXT, phone TEXT,
  plan TEXT NOT NULL DEFAULT 'basic',   -- basic | premium
  status TEXT NOT NULL DEFAULT 'active',-- active | paused | cancelled
  notes TEXT,
  created_at INTEGER NOT NULL
);

tags (
  slug TEXT PRIMARY KEY,        -- 6–7 chars base62, aleatorio
  business_id TEXT REFERENCES businesses(id),  -- NULL = chip libre en inventario
  label TEXT,                   -- "Caja principal", "Mesa 3"
  type TEXT NOT NULL,           -- redirect | landing
  target_url TEXT,              -- si type = redirect
  active INTEGER NOT NULL DEFAULT 1,
  locked_at INTEGER,            -- cuándo se bloqueó el chip físico
  synced_at INTEGER,            -- última publicación a KV
  created_at INTEGER NOT NULL
);

landings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  config_json TEXT NOT NULL,    -- validado con LandingConfig (Zod)
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);
```

### D1 (edge) — eventos

```sql
scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,   -- nfc | qr
  os TEXT,                -- ios | android | other
  country TEXT, city TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_scans_slug_ts ON scans(slug, ts);
```

**Decisión: el slug no contiene el nombre del negocio.** Un chip es un identificador físico;
si un negocio cancela, el stand se reasigna a otro sin reescribir nada.

## 5. Dominios y URLs

| Host | Destino | Notas |
|---|---|---|
| `go.penginexr.com/<slug>` | Worker | URL grabada en el chip (~30 bytes, cabe en NTAG213) |
| `go.penginexr.com/<slug>?s=q` | Worker | URL del QR impreso |
| `nfc-admin.penginexr.com` | Pi vía tunnel | Protegido por Cloudflare Access |

Considerar a futuro un dominio más corto y neutral (sin "penginexr") para la marca comercial.

## 6. Seguridad

- Chips **bloqueados permanentemente** tras escribirlos (el destino se cambia en KV, no en el chip).
- **La Pi no tiene token de Cloudflare.** Solo `INTERNAL_API_TOKEN` (secreto compartido con el Worker para `/internal/*`), en el `.env` del stack de Dockge. Ver [SECURITY.md](SECURITY.md#6-inventario-de-secretos).
- Validación de URLs destino: solo `https://` (y `wa.me`, `g.page`, `maps.app.goo.gl`, etc. en una allowlist opcional).
- Sin IPs ni datos personales en `scans`.
- `.env.example` en el repo; `.env` en `.gitignore`.

## 7. Resiliencia y backups

| Falla | Impacto | Mitigación |
|---|---|---|
| Pi apagada / sin internet | Solo el panel admin cae | Diseño edge-first |
| SD corrupta | Pérdida de SQLite | Backup diario a `/mnt/usb` + copia semanal fuera de la Pi |
| KV desincronizado | Destino viejo | Cola de publicación con reintentos + botón "Re-sincronizar todo" |
| Cuenta Cloudflare | Todo cae | Riesgo aceptado; exportar D1 y KV periódicamente |

**Backups** (`infra/backup.sh`, diario 03:00):
- `sqlite3 admin.db ".backup /mnt/usb/backups/nfc-admin/<fecha>/admin.db"`
- Verificar que `/mnt/usb` esté montado antes de escribir (si no, abortar).
- Retener 7 días.
- Semanal: `wrangler d1 export` → `/mnt/usb/backups/nfc-admin/d1/`.

Los backups del admin van en `/mnt/usb/backups/nfc-admin/` (carpeta propia; la USB tiene otros backups).

La USB es solo destino de backups; la base de datos activa vive en la SD/SSD.

## 8. Estructura del repo

```
nfc-platform/
├─ apps/
│  ├─ edge/                  # Cloudflare Worker
│  │  ├─ src/
│  │  │  ├─ index.ts         # rutas Hono
│  │  │  ├─ scan.ts          # registro en D1
│  │  │  └─ landing.ts       # render HTML de landings
│  │  ├─ wrangler.toml
│  │  └─ test/
│  └─ admin/                 # Panel en la Pi
│     ├─ server/             # Hono API + Drizzle
│     │  ├─ routes/
│     │  ├─ db/schema.ts
│     │  └─ cloudflare.ts    # cliente KV / D1
│     ├─ web/                # React + Vite
│     ├─ Dockerfile          # imagen arm64
│     └─ drizzle/            # migraciones SQLite
├─ packages/
│  └─ shared/                # Zod schemas, slug, UA utils
├─ infra/
│  ├─ docker-compose.yml
│  ├─ cloudflared.example.yml
│  ├─ backup.sh
│  └─ d1/migrations/
├─ docs/
│  └─ ARCHITECTURE.md
├─ .env.example
├─ pnpm-workspace.yaml
└─ package.json
```

**Tooling**: pnpm workspaces, TypeScript estricto, Vitest, ESLint + Prettier.

## 9. Fases

### Fase 1 — MVP vendible
- [x] Monorepo base (pnpm, TS, shared).
- [x] Worker: redirect desde KV, registro en D1, página de fallback, `/health`.
- [x] Migración D1 `scans`.
- [x] Admin: CRUD negocios y chips, sync a KV, generación de URL + QR. UI en React con número correlativo por chip.
- [x] Docker + stack Dockge + ruta en cloudflared + Cloudflare Access.
- [x] Backup diario a `/mnt/usb` (`/mnt/usb/backups/nfc-admin`, timer systemd 03:00).

**Criterio de listo** ✅ (cumplido el 2026-10-21): crear un negocio, asignarle un chip, escanearlo y ver el escaneo en el panel — con la Pi apagada, el chip sigue redirigiendo.

### Fase 2 — Estadísticas y escritura de chips
- [ ] Panel de estadísticas por negocio (por día, hora, NFC vs QR, iOS vs Android).
- [ ] Escritura y bloqueo de chips con Web NFC.
- [ ] Reporte mensual exportable (PDF o imagen) para enviar al negocio.

### Fase 3 — Premium
- [ ] Landings "link en bio" editables, renderizadas en el edge.
- [ ] Acceso de solo lectura para cada negocio a sus estadísticas.
- [ ] Extras: cupones con límite de usos, menú digital.

## 10. Despliegue

Automático con GitHub Actions (`.github/workflows/ci.yml`): en cada push a `main`, si pasan
typecheck, lint, formato y tests:

- **Edge**: migraciones D1 + `wrangler deploy` (requiere los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en GitHub). Manual: `pnpm --filter edge deploy`.
- **Admin**: imagen `linux/arm64` en `ghcr.io/clousck/nfc-admin` (`:latest` y `:sha-<commit>`); en la Pi, botón "Update" del stack en Dockge. Volver atrás: `NFC_ADMIN_IMAGE=ghcr.io/clousck/nfc-admin:sha-<commit>` en el `.env`.
- **Migraciones**: D1 con `wrangler d1 migrations apply`; SQLite con Drizzle al arrancar el contenedor.

## 11. Pendientes por decidir

- Nombre comercial y dominio corto.
- ~~React/Vite vs SvelteKit para el admin.~~ Decidido: React + Vite.
- Precios y si el plan básico incluye estadísticas.
- Verificar límites actuales del plan gratuito de Workers, KV y D1 antes de escalar.
