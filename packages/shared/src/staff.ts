import { z } from 'zod';

// Dispositivos del personal (validan canjes) y ajustes globales del admin.

export const StaffDeviceId = z
  .string()
  .regex(/^d_[0-9A-Za-z]{8,32}$/, 'ID de dispositivo inválido');

/** Enlace de vinculación: de un solo uso, 15 min. */
export const PAIRING_TTL_MS = 15 * 60_000;
/** Ruta (en go.penginexr.com) que abre el móvil del personal para vincularse. */
export const PAIRING_PATH = '/vincular';
/** Dispositivos activos por negocio. */
export const MAX_STAFF_DEVICES = 10;

export const StaffLabel = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform((value) => value.replace(/[\p{C}<>]/gu, ''));

export const CreatePairingBody = z.object({ label: StaffLabel });
export type CreatePairingBody = z.infer<typeof CreatePairingBody>;

export const PairingResponse = z.object({
  url: z.url(),
  expiresAt: z.number().int(),
});
export type PairingResponse = z.infer<typeof PairingResponse>;

export const StaffDeviceSummary = z.object({
  id: StaffDeviceId,
  label: z.string(),
  createdAt: z.number().int(),
  /** Correo del dueño que lo vinculó; null = el admin. */
  createdBy: z.string().nullable(),
  lastUsedAt: z.number().int().nullable(),
});
export type StaffDeviceSummary = z.infer<typeof StaffDeviceSummary>;

export const StaffDevicesResponse = z.object({ devices: z.array(StaffDeviceSummary) });
export type StaffDevicesResponse = z.infer<typeof StaffDevicesResponse>;

export const AppSettingsBody = z.object({
  /** A quién se avisa de un stand perdido. */
  adminNotifyEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
export type AppSettingsBody = z.infer<typeof AppSettingsBody>;
/** '' = sin correo de avisos configurado. */
export const AppSettingsResponse = z.object({ adminNotifyEmail: z.string() });
export type AppSettingsResponse = z.infer<typeof AppSettingsResponse>;
