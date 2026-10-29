import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  account,
  ADMIN_EMAIL,
  BIZ,
  business,
  login,
  mockMail,
  OTHER,
  portal,
  resetPortalTables,
  tag,
  type SentMail,
} from './portal-helpers.js';

let mails: SentMail[];
let cookie: string;

const kv = (key: string) => env.LINKS.get(key, 'json');

beforeEach(async () => {
  await resetPortalTables();
  mails = mockMail();
  await business(BIZ, { loyaltyVisits: 5 });
  await business(OTHER);
  await tag('aaaaaaa', 1);
  await tag('fidel01', 2, { type: 'loyalty', targetUrl: null, label: null });
  await tag('ajeno01', 3, { businessId: OTHER });
  await account();
  cookie = await login(mails);
});

afterEach(() => vi.restoreAllMocks());

const post = (path: string, form: Record<string, string>) =>
  portal('POST', `/n/${BIZ}${path}`, { form, cookie });

async function audit() {
  const { results } = await env.DB.prepare(
    'SELECT actor_type, action, target, after_json FROM audit_log ORDER BY id',
  ).all<{ actor_type: string; action: string; target: string; after_json: string }>();
  return results;
}

describe('portal: chips del dueño', () => {
  it('la portada es "Hoy": la franja del día y el enlace a editar los chips', async () => {
    const text = await (await portal('GET', `/n/${BIZ}`, { cookie })).text();
    expect(text).toContain('Hoy en el local');
    expect(text).toContain('class="strip"');
    expect(text).toContain(`href="/n/${BIZ}/chips"`);
  });

  it('la página de chips tiene el formulario de cada chip', async () => {
    const res = await portal('GET', `/n/${BIZ}/chips`, { cookie });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain(`action="/n/${BIZ}/chips/`);
    expect(text).not.toContain('Chip #3');
  });

  it('muestra sus chips y no los de otro negocio', async () => {
    const text = await (await portal('GET', `/n/${BIZ}`, { cookie })).text();
    expect(text).toContain('Chip #1');
    expect(text).toContain('Chip #2');
    expect(text).not.toContain('Chip #3');
  });

  it('cambia destino y etiqueta: se publica y queda en la auditoría como dueño', async () => {
    const res = await post('/chips/aaaaaaa', { etiqueta: 'Barra', destino: 'https://menu.ec' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/chips?m=guardado`);
    expect(await kv('aaaaaaa')).toMatchObject({ url: 'https://menu.ec' });

    const entry = (await audit()).find((e) => e.action === 'tag.settings');
    expect(entry).toMatchObject({ actor_type: 'owner', action: 'tag.settings', target: 'aaaaaaa' });

    const activity = await (await portal('GET', `/n/${BIZ}/actividad`, { cookie })).text();
    expect(activity).toContain('Chip #1');
    expect(activity).toContain('ana@cafe.ec');
  });

  it('rechaza destinos que no son https y quitar el destino de una redirección', async () => {
    const http = await post('/chips/aaaaaaa', { etiqueta: '', destino: 'http://menu.ec' });
    expect(http.headers.get('location')).toBe(`/n/${BIZ}/chips?m=url_invalida`);
    const js = await post('/chips/aaaaaaa', { etiqueta: '', destino: 'javascript:alert(1)' });
    expect(js.headers.get('location')).toBe(`/n/${BIZ}/chips?m=url_invalida`);
    const empty = await post('/chips/aaaaaaa', { etiqueta: '', destino: '' });
    expect(empty.headers.get('location')).toBe(`/n/${BIZ}/chips?m=falta_destino`);
    expect(await kv('aaaaaaa')).toMatchObject({ url: 'https://x.ec' });
  });

  it('el chip de fidelidad puede quedar sin enlace de continuación', async () => {
    const res = await post('/chips/fidel01', { etiqueta: 'Puerta', destino: '' });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/chips?m=guardado`);
  });

  it('no puede tocar el chip de otro negocio (ni siquiera saber que existe)', async () => {
    const res = await post('/chips/ajeno01', { etiqueta: 'mío', destino: 'https://robo.ec' });
    expect(res.status).toBe(404);
    expect(await kv('ajeno01')).toMatchObject({ url: 'https://x.ec' });
    expect((await portal('GET', `/n/${OTHER}`, { cookie })).status).toBe(404);
  });

  it('el texto del dueño se escapa al mostrarlo', async () => {
    await post('/chips/aaaaaaa', { etiqueta: '<script>x</script>', destino: 'https://x.ec' });
    const text = await (await portal('GET', `/n/${BIZ}`, { cookie })).text();
    expect(text).not.toContain('<script>x');
  });
});

describe('portal: stand perdido', () => {
  it('pausa el chip, avisa al admin una sola vez y se puede reactivar', async () => {
    const before = mails.length;
    const res = await post('/chips/aaaaaaa/pausa', { accion: 'pausar' });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/chips?m=pausado`);
    expect(await kv('aaaaaaa')).toMatchObject({ active: false });

    const notices = mails.slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toEqual([ADMIN_EMAIL]);
    expect(notices[0]?.subject).toContain('Café X');
    expect(notices[0]?.text).toContain('#1');

    // Pulsar otra vez no vuelve a avisar.
    await post('/chips/aaaaaaa/pausa', { accion: 'pausar' });
    expect(mails.slice(before)).toHaveLength(1);

    await post('/chips/aaaaaaa/pausa', { accion: 'reactivar' });
    expect(await kv('aaaaaaa')).toMatchObject({ active: true });
  });
});

describe('portal: premio', () => {
  it('cambia las visitas dentro de los límites', async () => {
    const ok = await post('/premio', { visitas: '8' });
    expect(ok.headers.get('location')).toBe(`/n/${BIZ}?m=premio`);
    expect(await kv(`business:${BIZ}`)).toMatchObject({ loyaltyVisits: 8 });

    for (const visitas of ['1', '21', 'abc', '']) {
      const bad = await post('/premio', { visitas });
      expect(bad.headers.get('location')).toBe(`/n/${BIZ}?m=visitas_invalidas`);
    }
  });

  it('no puede activar un programa que el admin no activó', async () => {
    await business(BIZ, { loyaltyVisits: null });
    // El negocio ya tenía ajustes: se desactiva como lo haría el admin.
    await env.DB.prepare('UPDATE business_settings SET loyalty_visits = NULL').run();
    const res = await post('/premio', { visitas: '6' });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}?m=premio_inactivo`);
  });
});

describe('portal: estadísticas, contactos y actividad', () => {
  it('estadísticas con enlace de vuelta al portal', async () => {
    const res = await portal('GET', `/n/${BIZ}/estadisticas`, { cookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Volver al portal');
    expect(text).toContain('Café X');
  });

  it('el CSV solo trae contactos con consentimiento, sin fórmulas, y queda auditado', async () => {
    const insert = env.DB.prepare(
      `INSERT INTO loyalty_cards (business_id, device_hash, name, phone, consent_card_at, consent_marketing_at, created_at)
       VALUES (?, ?, ?, ?, 1, ?, 1)`,
    );
    await env.DB.batch([
      insert.bind(BIZ, 'd1', '=HYPERLINK("x")', '+593991111111', 5),
      insert.bind(BIZ, 'd2', 'Sin permiso', '+593992222222', null),
      insert.bind(OTHER, 'd3', 'De otro', '+593993333333', 5),
    ]);
    const res = await portal('GET', `/n/${BIZ}/contactos.csv`, { cookie });
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toContain('Sin permiso');
    expect(csv).not.toContain('De otro');

    const entries = await audit();
    expect(entries.at(-1)).toMatchObject({
      actor_type: 'owner',
      action: 'contacts.exported',
      after_json: JSON.stringify({ count: 1 }),
    });
  });
});
