import { zValidator } from '@hono/zod-validator';
import { BusinessId, TargetUrl } from '@nfc/shared';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';

/** zValidator con respuesta de error uniforme: `{ error: 'validation', issues }`. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation', issues: z.treeifyError(result.error) }, 400);
    }
  });
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const BusinessCreate = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: optionalText(120),
  phone: optionalText(40),
  plan: z.enum(['basic', 'premium']).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  notes: optionalText(2000),
});

export const BusinessUpdate = BusinessCreate.partial();

export const TagCreate = z.object({
  businessId: BusinessId.nullable().optional(),
  label: optionalText(80),
  type: z.enum(['redirect', 'landing']).default('redirect'),
  targetUrl: TargetUrl.nullable().optional(),
  active: z.boolean().optional(),
});

export const TagUpdate = TagCreate.omit({ type: true })
  .extend({ type: z.enum(['redirect', 'landing']).optional() })
  .partial();

export const TagListQuery = z.object({
  businessId: BusinessId.optional(),
  unassigned: z.enum(['true', 'false']).optional(),
});

export const QrQuery = z.object({
  format: z.enum(['svg', 'png']).default('svg'),
  size: z.coerce.number().int().min(128).max(4096).default(1024),
  margin: z.coerce.number().int().min(0).max(16).default(2),
  download: z.enum(['0', '1']).optional(),
});
