import { z } from 'zod';
import { SLUG_PATTERN } from './slug.js';

/** URL de destino: solo https, sin credenciales embebidas. */
export const TargetUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }, 'Debe ser una URL https:// válida');

export const Slug = z.string().regex(SLUG_PATTERN, 'Slug inválido');

export const BusinessId = z.string().regex(/^b_[0-9A-Za-z]{8,32}$/, 'ID de negocio inválido');

/** Valor publicado en KV `LINKS` bajo la clave `<slug>`. */
export const LinkRecord = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('redirect'),
    url: TargetUrl,
    businessId: BusinessId,
    active: z.boolean(),
  }),
  z.object({
    type: z.literal('landing'),
    businessId: BusinessId,
    active: z.boolean(),
  }),
]);
export type LinkRecord = z.infer<typeof LinkRecord>;

export const LandingIcon = z.enum([
  'google',
  'whatsapp',
  'instagram',
  'facebook',
  'tiktok',
  'menu',
  'web',
  'maps',
  'phone',
  'email',
]);

/** Valor publicado en KV `LANDINGS` bajo la clave `<businessId>`. */
export const LandingConfig = z.object({
  name: z.string().trim().min(1).max(80),
  logo: TargetUrl.optional(),
  theme: z.enum(['light', 'dark']).default('light'),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        url: TargetUrl,
        icon: LandingIcon.optional(),
      }),
    )
    .min(1)
    .max(12),
});
export type LandingConfig = z.infer<typeof LandingConfig>;

export const ScanSource = z.enum(['nfc', 'qr']);
export type ScanSource = z.infer<typeof ScanSource>;

export const DeviceOs = z.enum(['ios', 'android', 'other']);
export type DeviceOs = z.infer<typeof DeviceOs>;

/** Fila de la tabla D1 `scans`. Sin IP ni datos personales. */
export const ScanEvent = z.object({
  slug: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  source: ScanSource,
  os: DeviceOs,
  country: z.string().max(8).nullable(),
  city: z.string().max(128).nullable(),
  isBot: z.boolean(),
});
export type ScanEvent = z.infer<typeof ScanEvent>;
