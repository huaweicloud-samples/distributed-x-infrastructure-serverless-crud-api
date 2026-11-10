/** Domain model shared by every entry point and every store adapter. */
export interface Product {
  id: string;
  name: string;
  price: number;
}

/**
 * Keep the entry-point check as permissive as the domain model allows: a parsed
 * object with a string id is enough to compare against the path id. Field-level
 * validation stays a concern of the calling application, not of the port.
 */
export function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>).id === 'string';
}
