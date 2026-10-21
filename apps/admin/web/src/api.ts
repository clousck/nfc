import type { Business, Tag } from '../../server/db/schema';

export type { Business, Tag };

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface TagView extends Tag {
  urls: { nfc: string; qr: string };
  published?: boolean;
  sync?: SyncResult;
}

export type BusinessView = Business & { reportUrl: string | null };

export type BusinessDetail = BusinessView & { tags: Tag[] };

export interface TagScanStats {
  since: number | null;
  total: number;
  nfc: number;
  qr: number;
  ios: number;
  android: number;
  other: number;
  bots: number;
  lastAt: number | null;
  recent: Array<{
    ts: number;
    source: 'nfc' | 'qr';
    os: 'ios' | 'android' | 'other' | null;
    country: string | null;
    city: string | null;
  }>;
}

export type BusinessInput = Partial<
  Pick<Business, 'name' | 'contactName' | 'phone' | 'plan' | 'status' | 'notes'>
>;

export type TagInput = Partial<Pick<Tag, 'businessId' | 'label' | 'targetUrl' | 'active'>>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FIELD_NAMES: Record<string, string> = {
  name: 'Nombre',
  contactName: 'Contacto',
  phone: 'Teléfono',
  notes: 'Notas',
  label: 'Etiqueta',
  targetUrl: 'Destino',
  businessId: 'Negocio',
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'La sesión expiró. Recarga la página para volver a iniciar sesión.',
  not_found: 'No existe (puede que se haya borrado).',
  business_not_found: 'El negocio seleccionado no existe.',
  internal_error: 'Error interno del servidor.',
};

interface TreeError {
  errors?: string[];
  properties?: Record<string, TreeError>;
}

function describeError(status: number, body: unknown): string {
  if (typeof body !== 'object' || body === null) return `Error ${status}`;
  const data = body as { error?: string; message?: string; issues?: TreeError };
  if (data.error === 'validation' && data.issues) {
    const lines = [...(data.issues.errors ?? [])];
    for (const [field, tree] of Object.entries(data.issues.properties ?? {})) {
      for (const msg of tree.errors ?? []) lines.push(`${FIELD_NAMES[field] ?? field}: ${msg}`);
    }
    return lines.join(' · ') || 'Datos inválidos';
  }
  if (data.message) return data.message;
  if (data.error) return ERROR_MESSAGES[data.error] ?? data.error;
  return `Error ${status}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Respuesta vacía o no JSON.
  }
  if (!response.ok) throw new ApiError(describeError(response.status, data), response.status);
  return data as T;
}

export const api = {
  listBusinesses: () => request<Business[]>('GET', '/api/businesses'),
  getBusiness: (id: string) => request<BusinessDetail>('GET', `/api/businesses/${id}`),
  createBusiness: (input: BusinessInput) => request<Business>('POST', '/api/businesses', input),
  updateBusiness: (id: string, input: BusinessInput) =>
    request<Business & { sync: SyncResult }>('PATCH', `/api/businesses/${id}`, input),
  deleteBusiness: (id: string) => request<void>('DELETE', `/api/businesses/${id}`),
  regenerateReport: (id: string) =>
    request<BusinessView & { sync: SyncResult }>('POST', `/api/businesses/${id}/report-token`),

  listTags: (filter: { businessId?: string; unassigned?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (filter.businessId) query.set('businessId', filter.businessId);
    if (filter.unassigned) query.set('unassigned', 'true');
    const qs = query.toString();
    return request<TagView[]>('GET', `/api/tags${qs ? `?${qs}` : ''}`);
  },
  getTag: (slug: string) => request<TagView>('GET', `/api/tags/${slug}`),
  getTagByNumber: (number: number) => request<TagView>('GET', `/api/tags/number/${number}`),
  getTagScans: (slug: string) => request<TagScanStats>('GET', `/api/tags/${slug}/scans`),
  createTag: (input: TagInput) => request<TagView>('POST', '/api/tags', input),
  updateTag: (slug: string, input: TagInput) =>
    request<TagView>('PATCH', `/api/tags/${slug}`, input),
  lockTag: (slug: string) => request<TagView>('POST', `/api/tags/${slug}/lock`),
  deleteTag: (slug: string) =>
    request<{ deleted: string; sync: SyncResult }>('DELETE', `/api/tags/${slug}`),

  resync: () => request<{ ok: true; published: number; deleted: number }>('POST', '/api/sync'),
};

export function qrUrl(slug: string, format: 'svg' | 'png', download = false): string {
  const query = new URLSearchParams({ format });
  if (format === 'png') query.set('size', '2048');
  if (download) query.set('download', '1');
  return `/api/tags/${slug}/qr?${query.toString()}`;
}
