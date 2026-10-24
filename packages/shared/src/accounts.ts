import { z } from 'zod';

// Cuentas de los dueños de negocio (docs/BUSINESS-ACCOUNTS.md §4). Las crea el admin; el
// dueño entra con un enlace de un solo uso.

export const AccountId = z.string().regex(/^a_[0-9A-Za-z]{8,32}$/, 'ID de cuenta inválido');

/** Correo normalizado (minúsculas, sin espacios): es la identidad del dueño. */
export const AccountEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Enlace copiado desde el panel (se envía por WhatsApp): de un solo uso, 24 h. */
export const INVITE_LINK_TTL_MS = 24 * 60 * 60_000;
/** Enlace enviado por correo al pedirlo en el portal: de un solo uso, 15 min. */
export const EMAIL_LINK_TTL_MS = 15 * 60_000;

/** Ruta del portal que abre un enlace de acceso. */
export const LOGIN_PATH = '/entrar';

export const CreateAccountBody = z.object({
  email: AccountEmail,
  name: z.string().trim().max(120).nullable().optional(),
});
export type CreateAccountBody = z.infer<typeof CreateAccountBody>;

export const AccountSummary = z.object({
  id: AccountId,
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.number().int(),
  /** Último acceso al portal (null = nunca entró). */
  lastLoginAt: z.number().int().nullable(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const AccountsResponse = z.object({ accounts: z.array(AccountSummary) });
export type AccountsResponse = z.infer<typeof AccountsResponse>;

export const LoginLinkResponse = z.object({
  url: z.url(),
  expiresAt: z.number().int(),
});
export type LoginLinkResponse = z.infer<typeof LoginLinkResponse>;
