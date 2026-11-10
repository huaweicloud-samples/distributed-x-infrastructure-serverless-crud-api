/** Aggregated exports for local verification; each entry point stays independent. */
export {
  createGetProductsHandler,
  createGetProductHandler,
  createPutProductHandler,
  createDeleteProductHandler,
} from './handlers';
export type { HandlerDeps } from './handlers';
export * from './event';
export * from './response';
export * from './observability';
export * from './middleware';
export * from './model/Product';
export * from './store/ProductStore';
export * from './store/GeminiDbStore';
