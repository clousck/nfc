import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloudflareAccess } from '../server/auth.js';
import { setup } from './helpers.js';

const TEAM = 'equipo.cloudflareaccess.com';
const AUD = 'aud-tag-123';

let privateKey: CryptoKey;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] };
});

function sign(overrides: { iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT({ email: 'victor@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(overrides.iss ?? `https://${TEAM}`)
    .setAudience(overrides.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(privateKey);
}

function makeCtx() {
  return setup(cloudflareAccess({ teamDomain: TEAM, aud: AUD, getKey: createLocalJWKSet(jwks) }));
}

describe('Cloudflare Access', () => {
  it('rechaza peticiones sin JWT', async () => {
    const ctx = makeCtx();
    expect((await ctx.request('GET', '/api/businesses')).status).toBe(401);
    ctx.close();
  });

  it('acepta un JWT válido', async () => {
    const ctx = makeCtx();
    const res = await ctx.request('GET', '/api/businesses', undefined, {
      'cf-access-jwt-assertion': await sign(),
    });
    expect(res.status).toBe(200);
    ctx.close();
  });

  it('rechaza audiencia o emisor incorrectos', async () => {
    const ctx = makeCtx();
    for (const token of [await sign({ aud: 'otra' }), await sign({ iss: 'https://evil.com' })]) {
      const res = await ctx.request('GET', '/api/businesses', undefined, {
        'cf-access-jwt-assertion': token,
      });
      expect(res.status).toBe(401);
    }
    ctx.close();
  });

  it('/health no requiere autenticación', async () => {
    const ctx = makeCtx();
    expect((await ctx.request('GET', '/health')).status).toBe(200);
    ctx.close();
  });
});
