import { createGetProductHandler } from './handlers';
import { GeminiDbStore } from './store/GeminiDbStore';

/** Composition root for GET /products/{id}: bind the port to its adapter. */
export const handler = createGetProductHandler({
  storeFactory: () => new GeminiDbStore(),
});
