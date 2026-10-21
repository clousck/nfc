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

  it('Cloudflare queda deshabilitado si falta alguna credencial', () => {
    expect(loadConfig({ AUTH_DISABLED: 'true', CF_ACCOUNT_ID: 'a' }).cloudflare).toBeNull();
    expect(
      loadConfig({
        AUTH_DISABLED: 'true',
        CF_ACCOUNT_ID: 'a',
        CF_API_TOKEN: 't',
        CF_KV_LINKS_NAMESPACE_ID: 'n',
      }).cloudflare,
    ).toEqual({ accountId: 'a', apiToken: 't', kvLinksNamespaceId: 'n', d1DatabaseId: null });
  });

  it('rechaza PUBLIC_BASE_URL sin https', () => {
    expect(() => loadConfig({ AUTH_DISABLED: 'true', PUBLIC_BASE_URL: 'http://x.com' })).toThrow();
  });
});
