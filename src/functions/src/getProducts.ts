import { createGetProductsHandler } from './handlers';
import { GeminiDbStore } from './store/GeminiDbStore';

/** Composition root for GET /products: bind the port to its adapter. */
export const handler = createGetProductsHandler({
  storeFactory: () => new GeminiDbStore(),
});
