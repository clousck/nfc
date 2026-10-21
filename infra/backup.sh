#!/usr/bin/env bash
# Backup diario de la base SQLite del admin a la USB (ver infra/systemd/).
#
#   - Aborta si la USB no está montada (nunca escribe en la SD por error).
#   - Copia consistente con `sqlite3 .backup` (seguro con la app en marcha, WAL).
#   - Verifica la copia con `PRAGMA integrity_check`.
#   - Retiene RETENTION_DAYS días.
#   - Opcional: export semanal de D1 con wrangler (D1_EXPORT=true).
#
# Variables (con sus valores por defecto):
#   DB_PATH=/opt/nfc-admin/data/admin.db
#   BACKUP_MOUNT=/mnt/usb
#   BACKUP_LABEL=              # si se define, exige que lo montado tenga esa etiqueta (p. ej. pi-usb)
#   BACKUP_ROOT=$BACKUP_MOUNT/backups/nfc-admin   (carpeta propia: la retención solo borra aquí)
#   RETENTION_DAYS=7
#   D1_EXPORT=false            # true para activar el export semanal de D1
#   D1_EXPORT_WEEKDAY=7        # 1 = lunes … 7 = domingo
#   D1_DATABASE=nfc-scans
#   D1_RETENTION_DAYS=56
#   WRANGLER="npx --yes wrangler@4"
#   (wrangler necesita CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en el entorno)

set -euo pipefail

DB_PATH="${DB_PATH:-/opt/nfc-admin/data/admin.db}"
BACKUP_MOUNT="${BACKUP_MOUNT:-/mnt/usb}"
BACKUP_LABEL="${BACKUP_LABEL:-}"
BACKUP_ROOT="${BACKUP_ROOT:-$BACKUP_MOUNT/backups/nfc-admin}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
D1_EXPORT="${D1_EXPORT:-false}"
D1_EXPORT_WEEKDAY="${D1_EXPORT_WEEKDAY:-7}"
D1_DATABASE="${D1_DATABASE:-nfc-scans}"
D1_RETENTION_DAYS="${D1_RETENTION_DAYS:-56}"
WRANGLER="${WRANGLER:-npx --yes wrangler@4}"

log() { echo "[$(date -Iseconds)] $*"; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

command -v sqlite3 >/dev/null || die "sqlite3 no está instalado (apt install sqlite3)"
mountpoint -q "$BACKUP_MOUNT" || die "$BACKUP_MOUNT no está montado; abortando"
if [[ -n "$BACKUP_LABEL" ]]; then
  label="$(findmnt -no LABEL "$BACKUP_MOUNT" || true)"
  [[ "$label" == "$BACKUP_LABEL" ]] ||
    die "lo montado en $BACKUP_MOUNT tiene etiqueta '$label', se esperaba '$BACKUP_LABEL'; abortando"
fi
[[ -f "$DB_PATH" ]] || die "no existe la base de datos $DB_PATH"
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || die "RETENTION_DAYS inválido: $RETENTION_DAYS"

# Los backups contienen datos de clientes: solo legibles por root.
umask 077
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

today="$(date +%F)"
dest="$BACKUP_ROOT/$today"
mkdir -p "$dest"

# --- SQLite -------------------------------------------------------------------
tmp="$dest/admin.db.partial"
rm -f "$tmp"
sqlite3 "$DB_PATH" ".timeout 10000" ".backup '$tmp'"
check="$(sqlite3 "$tmp" 'PRAGMA integrity_check;')"
if [[ "$check" != "ok" ]]; then
  rm -f "$tmp"
  die "integrity_check falló: $check"
fi
mv -f "$tmp" "$dest/admin.db"
log "SQLite → $dest/admin.db ($(du -h "$dest/admin.db" | cut -f1))"

# Retención: conserva los últimos RETENTION_DAYS días (incluido hoy).
cutoff="$(date -d "-$((RETENTION_DAYS - 1)) days" +%F)"
for dir in "$BACKUP_ROOT"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  if [[ "$name" < "$cutoff" ]]; then
    rm -rf -- "$dir"
    log "Eliminado backup antiguo $name"
  fi
done

# --- D1 (semanal, opcional) ---------------------------------------------------
if [[ "$D1_EXPORT" == "true" && "$(date +%u)" == "$D1_EXPORT_WEEKDAY" ]]; then
  d1_dir="$BACKUP_ROOT/d1"
  mkdir -p "$d1_dir"
  out="$d1_dir/$D1_DATABASE-$today.sql"
  # shellcheck disable=SC2086 # WRANGLER puede ser un comando con argumentos.
  if $WRANGLER d1 export "$D1_DATABASE" --remote --output "$out.partial"; then
    mv -f "$out.partial" "$out"
    log "D1 → $out"
  else
    rm -f "$out.partial"
    die "falló el export de D1"
  fi
  find "$d1_dir" -maxdepth 1 -name '*.sql' -type f -mtime "+$D1_RETENTION_DAYS" -delete
fi

log "Backup completado"
