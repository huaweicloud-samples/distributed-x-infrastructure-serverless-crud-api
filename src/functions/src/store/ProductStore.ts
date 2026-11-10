import { Product } from '../model/Product';

/**
 * Hexagonal port. The four entry points depend only on this interface, never on
 * a concrete client. Replacing the adapter does not change any handler.
 */
export interface ProductStore {
  getProduct(id: string): Promise<Product | undefined>;
  putProduct(product: Product): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  getProducts(): Promise<Product[] | undefined>;
}
