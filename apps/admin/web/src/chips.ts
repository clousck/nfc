// Estado de un chip físico, el mismo en el rack, las tablas y la ficha. Sin React: se prueba aparte.

/** Lo que hace falta saber de un chip para decidir su estado. */
interface TagFlags {
  businessId: string | null;
  pausedAt: number | null;
  active: boolean;
  published: boolean;
  lockedAt: number | null;
}

export type TagState = 'free' | 'live' | 'locked' | 'paused' | 'missing' | 'off';

export function tagState(tag: TagFlags): TagState {
  if (!tag.businessId) return 'free';
  if (tag.pausedAt) return 'paused';
  if (!tag.active) return 'off';
  if (!tag.published) return 'missing';
  return tag.lockedAt ? 'locked' : 'live';
}

export const TAG_STATE_LABEL: Record<TagState, string> = {
  free: 'Libre',
  live: 'En uso',
  locked: 'Bloqueado',
  paused: 'Pausado',
  missing: 'Sin destino',
  off: 'Desactivado',
};

/** Tono de la pastilla de cada estado. */
export const TAG_STATE_TONE: Record<TagState, 'ok' | 'warn' | 'muted'> = {
  free: 'muted',
  live: 'ok',
  locked: 'ok',
  paused: 'warn',
  missing: 'warn',
  off: 'muted',
};

/** Dominio del destino, para leerlo de un vistazo ("instagram.com"). */
export function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
