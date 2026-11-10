/**
 * Lightweight observability facade. It only writes JSON lines to stdout:
 * Log Tank Service collects them, and structured metric lines can be turned
 * into custom AOM metrics with a log metric extraction rule. No logging
 * credential or network client is held inside the function.
 */
export interface Observability {
  readonly traceId: string;
  log(level: string, message: string, fields?: Record<string, unknown>): void;
  metric(name: string, value?: number, dimensions?: Record<string, unknown>): void;
}

export type LogSink = (line: string) => void;

const LEVELS: Record<string, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export function createObservability(
  trace = `local-${Date.now()}`,
  env: NodeJS.ProcessEnv = process.env,
  sink: LogSink = (line) => console.log(line)
): Observability {
  const threshold = LEVELS[String(env.LOG_LEVEL || 'INFO').toUpperCase()] ?? 20;
  const service = env.SERVICE_NAME || 'serverless-crud-api';
  const namespace = env.METRIC_NAMESPACE || 'HuaweiCloud/ServerlessCRUD';

  const emit = (line: Record<string, unknown>): void => {
    sink(
      JSON.stringify({
        ...line,
        service,
        trace_id: trace,
        ts: new Date().toISOString(),
      })
    );
  };

  return {
    traceId: trace,
    log(level, message, fields = {}) {
      const normalized = level.toUpperCase();
      if ((LEVELS[normalized] ?? 20) < threshold) {
        return;
      }
      emit({ type: 'log', level: normalized, message, ...fields });
    },
    metric(name, value = 1, dimensions = {}) {
      emit({
        type: 'metric',
        namespace,
        metric: name,
        value,
        unit: 'Count',
        ...dimensions,
      });
    },
  };
}
