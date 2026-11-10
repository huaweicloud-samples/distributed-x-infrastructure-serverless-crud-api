export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

/** Build a gateway proxy response with configurable CORS origins. */
export function reply(
  statusCode: number,
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env
): ApiResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': env.CORS_ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-trace-id',
    },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}
