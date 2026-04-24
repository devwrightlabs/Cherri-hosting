/**
 * Safely extract a single string value from an Express route parameter.
 * Express 5 types route params as `string | string[]`; in practice, named
 * path segments always resolve to a single string at runtime.
 */
export function getRouteParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}
