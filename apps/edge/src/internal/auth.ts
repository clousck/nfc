import { createMiddleware } from 'hono/factory';
import type { Env } from '../env.js';
import { fallbackResponse } from '../fallback.js';

/** Longitud mínima del secreto: con menos, /internal queda cerrado. */
const MIN_TOKEN_LENGTH = 32;

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

/**
 * Compara en tiempo constante. Una comparación normal se detiene en el primer carácter
 * distinto, y midiendo ese tiempo se podría adivinar el token poco a poco. Se comparan los
 * hashes para que ambos lados tengan la misma longitud (requisito de timingSafeEqual).
 */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Solo la Pi conoce INTERNAL_API_TOKEN. Sin token válido, /internal/* responde la misma
 * página 404 que cualquier ruta inexistente: para un desconocido, la API no existe.
 */
export const internalAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const expected = c.env.INTERNAL_API_TOKEN;
  const header = c.req.header('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!expected || expected.length < MIN_TOKEN_LENGTH || !given) return fallbackResponse(404);
  if (!(await sameSecret(given, expected))) return fallbackResponse(404);
  await next();
});
