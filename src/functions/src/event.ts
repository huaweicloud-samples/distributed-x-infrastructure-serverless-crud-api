/**
 * Normalised view of the gateway event. Field names follow the FunctionGraph
 * APIG trigger shape; fallbacks keep direct invocations and local tests working.
 */
export interface ApiEvent {
  httpMethod?: string;
  path?: string;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  body?: string | Record<string, unknown> | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string> | null;
  requestContext?: { resourcePath?: string; requestId?: string } | null;
  [key: string]: unknown;
}

/** Read the product id from path parameters, query parameters or the path tail. */
export function pathId(event: ApiEvent): string | undefined {
  const fromParams = event.pathParameters && event.pathParameters.id;
  if (typeof fromParams === 'string' && fromParams.length > 0) {
    return fromParams;
  }
  const fromQuery = event.queryStringParameters && event.queryStringParameters.id;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) {
    return fromQuery;
  }

  const segments = String(event.path || '')
    .split('?')[0]
    .split('/')
    .filter((segment) => segment.length > 0);
  const productsAt = segments.indexOf('products');
  const tail = productsAt >= 0 ? segments[productsAt + 1] : undefined;
  if (tail && tail !== '{id}') {
    return decodeURIComponent(tail);
  }
  return undefined;
}

/** Accept plain strings, base64-encoded strings and already-parsed objects. */
export function bodyText(event: ApiEvent): string | null {
  const raw = event.body;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw === 'string') {
    return event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  }
  return JSON.stringify(raw);
}

export function resourcePath(event: ApiEvent): string {
  const fromContext = event.requestContext && event.requestContext.resourcePath;
  return fromContext || event.path || '/';
}

/** Propagate an inbound trace id, or derive one for direct invocations. */
export function traceId(event: ApiEvent): string {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'x-trace-id');
  if (key && headers[key]) {
    return headers[key];
  }
  const fromContext = event.requestContext && event.requestContext.requestId;
  return fromContext || `local-${Date.now()}`;
}
