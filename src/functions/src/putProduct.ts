import { createPutProductHandler } from './handlers';
import { GeminiDbStore } from './store/GeminiDbStore';

/** Composition root for PUT /products/{id}: bind the port to its adapter. */
export const handler = createPutProductHandler({
  storeFactory: () => new GeminiDbStore(),
});
