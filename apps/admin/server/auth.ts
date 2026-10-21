import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AuthVariables = { userEmail: string | null };

interface AccessOptions {
  teamDomain: string; // <equipo>.cloudflareaccess.com
  aud: string;
  /** Inyectable para tests; por defecto usa los certificados públicos del equipo. */
  getKey?: JWTVerifyGetKey;
}

/** Valida el JWT que Cloudflare Access añade en `Cf-Access-Jwt-Assertion`. */
export function cloudflareAccess(options: AccessOptions) {
  const issuer = `https://${options.teamDomain}`;
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const { payload } = await jwtVerify(token, getKey, { issuer, audience: options.aud });
      c.set('userEmail', typeof payload['email'] === 'string' ? payload['email'] : null);
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
}
