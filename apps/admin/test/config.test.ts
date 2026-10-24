import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';

describe('loadConfig', () => {
  it('exige Cloudflare Access salvo AUTH_DISABLED=true', () => {
    expect(() => loadConfig({})).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
    expect(loadConfig({ AUTH_DISABLED: 'true' }).access).toBeNull();
  });

  it('normaliza el dominio del equipo', () => {
    const config = loadConfig({
      CF_ACCESS_TEAM_DOMAIN: 'https://equipo.cloudflareaccess.com/',
      CF_ACCESS_AUD: 'aud',
    });
    expect(config.access).toEqual({ teamDomain: 'equipo.cloudflareaccess.com', aud: 'aud' });
  });

  it('sin INTERNAL_API_TOKEN no hay conexión con el Worker; con él, usa la URL pública', () => {
    expect(loadConfig({ AUTH_DISABLED: 'true' }).edge).toBeNull();
    const token = 't'.repeat(32);
    expect(loadConfig({ AUTH_DISABLED: 'true', INTERNAL_API_TOKEN: token }).edge).toEqual({
      baseUrl: 'https://go.penginexr.com',
      token,
    });
    expect(
      loadConfig({ AUTH_DISABLED: 'true', INTERNAL_API_TOKEN: token, EDGE_URL: 'https://e.ec' })
        .edge?.baseUrl,
    ).toBe('https://e.ec');
  });

  it('rechaza un INTERNAL_API_TOKEN demasiado corto', () => {
    expect(() => loadConfig({ AUTH_DISABLED: 'true', INTERNAL_API_TOKEN: 'corto' })).toThrow();
  });

  it('rechaza PUBLIC_BASE_URL sin https', () => {
    expect(() => loadConfig({ AUTH_DISABLED: 'true', PUBLIC_BASE_URL: 'http://x.com' })).toThrow();
  });
});
