import { ApiEvent, bodyText, pathId } from './event';
import { ApiResponse, reply } from './response';
import { isProduct, Product } from './model/Product';
import { ProductStore } from './store/ProductStore';
import { ObsFactory, WrappedHandler, withObservability } from './middleware';

/**
 * Handlers depend on the port only. Binding a concrete adapter is the job of
 * the composition root (each entry point), which keeps the hexagon intact.
 */
export interface HandlerDeps {
  store?: ProductStore;
  storeFactory?: () => ProductStore;
  obsFactory?: ObsFactory;
}

function storeOf(deps: HandlerDeps): ProductStore {
  if (deps.store) {
    return deps.store;
  }
  if (deps.storeFactory) {
    return deps.storeFactory();
  }
  throw new Error('A ProductStore implementation must be provided');
}

export function createGetProductsHandler(deps: HandlerDeps = {}): WrappedHandler {
  return withObservability(
    async (_event: ApiEvent, _context, obs): Promise<ApiResponse> => {
      const products = await storeOf(deps).getProducts();
      obs.log('INFO', 'products listed', { count: (products || []).length });
      return reply(200, { products: products || [] });
    },
    { name: 'getProducts', metricName: 'productsRetrieved' },
    deps.obsFactory
  );
}

export function createGetProductHandler(deps: HandlerDeps = {}): WrappedHandler {
  return withObservability(
    async (event: ApiEvent, _context, obs): Promise<ApiResponse> => {
      const id = pathId(event);
      if (!id) {
        return reply(400, { message: "Missing 'id' parameter in path" });
      }
      const product = await storeOf(deps).getProduct(id);
      if (!product) {
        obs.log('WARN', 'product not found', { product_id: id });
        return reply(404, { message: 'Product not found' });
      }
      return reply(200, product);
    },
    { name: 'getProduct', metricName: 'productRetrieved' },
    deps.obsFactory
  );
}

export function createPutProductHandler(deps: HandlerDeps = {}): WrappedHandler {
  return withObservability(
    async (event: ApiEvent, _context, obs): Promise<ApiResponse> => {
      const id = pathId(event);
      if (!id) {
        return reply(400, { message: "Missing 'id' parameter in path" });
      }
      const text = bodyText(event);
      if (text === null || text.trim() === '') {
        return reply(400, { message: 'Empty request body' });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reply(400, { message: 'Failed to parse product from request body' });
      }
      if (!isProduct(parsed)) {
        return reply(400, { message: 'Failed to parse product from request body' });
      }
      if (id !== (parsed as Product).id) {
        return reply(400, {
          message: 'Product ID in path does not match product ID in body',
        });
      }

      await storeOf(deps).putProduct(parsed as Product);
      obs.log('INFO', 'product created', { product_id: id });
      return reply(201, { message: 'Product created' });
    },
    { name: 'putProduct', metricName: 'productCreated' },
    deps.obsFactory
  );
}

export function createDeleteProductHandler(deps: HandlerDeps = {}): WrappedHandler {
  return withObservability(
    async (event: ApiEvent, _context, obs): Promise<ApiResponse> => {
      const id = pathId(event);
      if (!id) {
        return reply(400, { message: "Missing 'id' parameter in path" });
      }
      await storeOf(deps).deleteProduct(id);
      obs.log('INFO', 'product deleted', { product_id: id });
      return reply(200, { message: 'Product deleted' });
    },
    { name: 'deleteProduct', metricName: 'productDeleted' },
    deps.obsFactory
  );
}
