import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../server/db/client.js';
import { publishQueue, tags } from '../server/db/schema.js';
import { createPublisher, retryDelay, tagEntity, type Publisher } from '../server/publisher.js';
import { FakeEdge } from './helpers.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('cola de publicación', () => {
  let db: Db;
  let close: () => void;
  let edge: FakeEdge;
  let publisher: Publisher;
  let clock: number;

  beforeEach(() => {
    ({ db, close } = openDb(':memory:', migrationsFolder));
    edge = new FakeEdge();
    clock = 1_000_000;
    publisher = createPublisher({ db, edge, now: () => clock });
  });

  afterEach(() => close());

  let nextNumber = 1;

  function addTag(slug = 'aaaaaaa') {
    db.transaction((tx) => {
      tx.insert(tags).values({ slug, number: nextNumber++, type: 'redirect', createdAt: 1 }).run();
      publisher.enqueue(tx, [tagEntity(slug)]);
    });
  }

  const note = (slug = 'aaaaaaa') =>
    db
      .select()
      .from(publishQueue)
      .where(eq(publishQueue.entity, tagEntity(slug)))
      .get();

  it('la espera entre reintentos crece hasta 15 minutos', () => {
    expect([1, 2, 3, 10].map(retryDelay)).toEqual([30_000, 60_000, 120_000, 900_000]);
  });

  it('si falla, la nota queda con el error y la hora del próximo intento', async () => {
    addTag();
    edge.failing = true;

    expect((await publisher.publish([tagEntity('aaaaaaa')])).ok).toBe(false);

    expect(note()).toMatchObject({ attempts: 1, nextAttemptAt: clock + 30_000 });
    expect(note()?.lastError).toContain('No se pudo contactar');
  });

  it('retryDue solo reintenta lo que ya toca, y al publicar borra la nota', async () => {
    addTag();
    edge.failing = true;
    await publisher.publish([tagEntity('aaaaaaa')]);
    edge.failing = false;

    await publisher.retryDue();
    expect(note()).toBeDefined(); // aún no pasaron 30 s

    clock += 30_000;
    await publisher.retryDue();
    expect(note()).toBeUndefined();
    expect(edge.tags.has('aaaaaaa')).toBe(true);
  });

  it('si el Worker no responde, retryDue no insiste con el resto en la misma vuelta', async () => {
    addTag('aaaaaaa');
    addTag('bbbbbbb');
    edge.failing = true;

    await publisher.retryDue();

    expect(edge.calls).toEqual(['PUT tag:aaaaaaa']);
  });

  it('un cambio hecho durante el envío no se pierde', async () => {
    addTag();
    // Simula que, mientras se envía, otro cambio vuelve a anotar el chip.
    const originalPut = edge.putTag.bind(edge);
    edge.putTag = async (tag, revision) => {
      publisher.enqueue(db, [tagEntity(tag.slug)]);
      return originalPut(tag, revision);
    };

    await publisher.publish([tagEntity('aaaaaaa')]);

    expect(note()).toBeDefined(); // la nota nueva sigue para el próximo envío
  });

  it('re-sincronizar todo vacía la cola y el estado del Worker queda completo', async () => {
    addTag('aaaaaaa');
    addTag('bbbbbbb');

    const result = await publisher.resyncAll();

    expect(publisher.status()).toMatchObject({ pending: 0, failing: 0 });
    expect([...edge.tags.keys()].sort()).toEqual(['aaaaaaa', 'bbbbbbb']);
    expect(result.published).toBe(0); // chips libres: nada que publicar en KV
  });

  it('status resume lo pendiente y el último error', async () => {
    addTag();
    expect(publisher.status()).toMatchObject({ pending: 1, failing: 0, lastError: null });
    edge.failing = true;
    await publisher.publish([tagEntity('aaaaaaa')]);
    expect(publisher.status()).toMatchObject({ pending: 1, failing: 1 });
    expect(publisher.status().lastError).toContain('No se pudo contactar');
  });
});
