import { createDeleteProductHandler } from './handlers';
import { GeminiDbStore } from './store/GeminiDbStore';

/** Composition root for DELETE /products/{id}: bind the port to its adapter. */
export const handler = createDeleteProductHandler({
  storeFactory: () => new GeminiDbStore(),
});
