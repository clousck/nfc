import { describe, expect, it } from 'vitest';
import {
  buildTagUrls,
  detectOs,
  generateId,
  generateSlug,
  isBot,
  isValidSlug,
  LandingConfig,
  LinkRecord,
  sourceFromParam,
  TargetUrl,
} from '../src/index.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('slug', () => {
  it('genera slugs base62 válidos y distintos', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()));
    expect(slugs.size).toBe(500);
    for (const slug of slugs) {
      expect(slug).toHaveLength(7);
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it('respeta los límites de longitud', () => {
    expect(generateSlug(6)).toHaveLength(6);
    expect(() => generateSlug(5)).toThrow(RangeError);
    expect(() => generateSlug(8)).toThrow(RangeError);
  });

  it('rechaza slugs con caracteres fuera de base62', () => {
    expect(isValidSlug('abc-123')).toBe(false);
    expect(isValidSlug('ab')).toBe(false);
    // "health" es un slug válido: por eso /health se registra antes que /:slug.
    expect(isValidSlug('health')).toBe(true);
  });

  it('genera IDs con prefijo', () => {
    expect(generateId('b')).toMatch(/^b_[0-9A-Za-z]{12}$/);
  });
});

describe('user agent', () => {
  it('detecta el sistema operativo', () => {
    expect(detectOs(IPHONE)).toBe('ios');
    expect(detectOs(ANDROID)).toBe('android');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
    expect(detectOs(null)).toBe('other');
  });

  it('marca crawlers de previsualización como bots', () => {
    expect(isBot('WhatsApp/2.23.20.0 A')).toBe(true);
    expect(isBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(
      true,
    );
    expect(isBot('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot('')).toBe(true);
  });

  it('no marca navegadores móviles como bots', () => {
    expect(isBot(IPHONE)).toBe(false);
    expect(isBot(ANDROID)).toBe(false);
  });
});

describe('urls', () => {
  it('construye URL de chip y de QR', () => {
    expect(buildTagUrls('https://go.penginexr.com/', 'aB3dE5f')).toEqual({
      nfc: 'https://go.penginexr.com/aB3dE5f',
      qr: 'https://go.penginexr.com/aB3dE5f?s=q',
    });
  });

  it('la URL del chip es corta (cabe holgada en un NTAG213)', () => {
    const { nfc } = buildTagUrls('https://go.penginexr.com', generateSlug());
    expect(new TextEncoder().encode(nfc).length).toBeLessThanOrEqual(32);
  });

  it('interpreta el parámetro de origen', () => {
    expect(sourceFromParam('q')).toBe('qr');
    expect(sourceFromParam(null)).toBe('nfc');
    expect(sourceFromParam('x')).toBe('nfc');
  });
});

describe('schemas', () => {
  it('TargetUrl solo acepta https', () => {
    expect(TargetUrl.safeParse('https://g.page/r/XXXX/review').success).toBe(true);
    expect(TargetUrl.safeParse('http://example.com').success).toBe(false);
    expect(TargetUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(TargetUrl.safeParse('https://user:pass@example.com').success).toBe(false);
    expect(TargetUrl.safeParse('no es url').success).toBe(false);
  });

  it('LinkRecord valida ambos tipos', () => {
    expect(
      LinkRecord.safeParse({
        type: 'redirect',
        url: 'https://wa.me/593999999999',
        businessId: 'b_0123456789ab',
        active: true,
      }).success,
    ).toBe(true);
    expect(
      LinkRecord.safeParse({ type: 'landing', businessId: 'b_0123456789ab', active: false })
        .success,
    ).toBe(true);
    expect(
      LinkRecord.safeParse({ type: 'redirect', businessId: 'b_0123456789ab', active: true })
        .success,
    ).toBe(false);
  });

  it('LandingConfig aplica tema por defecto', () => {
    const parsed = LandingConfig.parse({
      name: 'Café X',
      links: [{ label: 'Déjanos tu reseña', url: 'https://g.page/r/X/review', icon: 'google' }],
    });
    expect(parsed.theme).toBe('light');
  });
});
