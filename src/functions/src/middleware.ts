import { ApiEvent, resourcePath, traceId as eventTraceId } from './event';
import { ApiResponse, reply } from './response';
import { createObservability, Observability } from './observability';

export interface HandlerContext {
  getRequestID?: () => string;
  [key: string]: unknown;
}

export type BusinessHandler = (
  event: ApiEvent,
  context: HandlerContext,
  obs: Observability
) => Promise<ApiResponse>;

export type ObsFactory = (trace?: string) => Observability;

export interface MiddlewareOptions {
  name: string;
  metricName: string;
}

export type WrappedHandler = (
  event: ApiEvent,
  context?: HandlerContext
) => Promise<ApiResponse>;

/**
 * Entry-point middleware chain: trace propagation, timing, completion metric,
 * structured log line and a uniform error boundary. Four handlers share it,
 * so the cross-cutting behaviour stays in one place.
 */
export function withObservability(
  handler: BusinessHandler,
  options: MiddlewareOptions,
  obsFactory: ObsFactory = createObservability
): WrappedHandler {
  return async (event, context = {}) => {
    const obs = obsFactory(eventTraceId(event));
    const startedAt = Date.now();
    try {
      const result = await handler(event, context, obs);
      obs.metric(options.metricName, 1, { status_code: result.statusCode });
      obs.log('INFO', 'request completed', {
        handler: options.name,
        resource_path: resourcePath(event),
        status_code: result.statusCode,
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      obs.log('ERROR', 'request failed', {
        handler: options.name,
        resource_path: resourcePath(event),
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return reply(500, { message: 'Internal server error' });
    }
  };
}
