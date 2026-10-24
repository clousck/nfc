import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type ErrorTable<E extends string> = Record<E, { status: ContentfulStatusCode; message?: string }>;

/**
 * Traduce los errores de un servicio a HTTP. La tabla es exhaustiva: si un servicio añade un
 * error nuevo, TypeScript exige decidir aquí su código antes de compilar.
 */
export function errorResponder<E extends string>(table: ErrorTable<E>) {
  return (c: Context, error: E, extra: Record<string, unknown> = {}) => {
    const { status, message } = table[error];
    return c.json({ error, ...(message ? { message } : {}), ...extra }, status);
  };
}
