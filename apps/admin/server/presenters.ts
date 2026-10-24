import { buildReportUrl, buildTagUrls } from '@nfc/shared';
import type { BusinessDto, TagDto } from './contracts.js';
import type { Business, Tag } from './db/schema.js';

// Fila de la base → DTO de la API, campo por campo (nunca `...fila`): lo que no se copia
// aquí no sale del servidor.

export function toBusinessDto(business: Business, publicBaseUrl: string): BusinessDto {
  return {
    id: business.id,
    name: business.name,
    contactName: business.contactName,
    phone: business.phone,
    plan: business.plan,
    status: business.status,
    notes: business.notes,
    loyaltyVisits: business.loyaltyVisits,
    reportToken: business.reportToken,
    reportUrl: business.reportToken ? buildReportUrl(publicBaseUrl, business.reportToken) : null,
    createdAt: business.createdAt,
  };
}

export function toTagDto(tag: Tag, published: boolean, publicBaseUrl: string): TagDto {
  return {
    slug: tag.slug,
    number: tag.number,
    businessId: tag.businessId,
    assignedAt: tag.assignedAt,
    label: tag.label,
    type: tag.type,
    targetUrl: tag.targetUrl,
    active: tag.active,
    lockedAt: tag.lockedAt,
    pausedAt: tag.pausedAt,
    syncedAt: tag.syncedAt,
    createdAt: tag.createdAt,
    urls: buildTagUrls(publicBaseUrl, tag.slug),
    published,
  };
}
