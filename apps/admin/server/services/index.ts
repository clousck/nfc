import type { Db } from '../db/client.js';
import type { EdgeClient } from '../edge-client.js';
import type { Publisher } from '../publisher.js';
import { createBusinessService, type BusinessService } from './business-service.js';
import { createTagService, type TagService } from './tag-service.js';

export interface Services {
  businesses: BusinessService;
  tags: TagService;
}

export function createServices(deps: { db: Db; publisher: Publisher; edge: EdgeClient }): Services {
  return {
    businesses: createBusinessService(deps),
    tags: createTagService(deps),
  };
}
