import type { LinkStore } from '../cloudflare.js';
import type { Db } from '../db/client.js';
import { createBusinessService, type BusinessService } from './business-service.js';
import { createTagService, type TagService } from './tag-service.js';

export interface Services {
  businesses: BusinessService;
  tags: TagService;
}

export function createServices(deps: { db: Db; linkStore: LinkStore }): Services {
  return {
    businesses: createBusinessService(deps),
    tags: createTagService(deps),
  };
}
