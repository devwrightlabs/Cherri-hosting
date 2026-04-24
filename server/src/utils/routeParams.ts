/**
 * Safely extract a single string value from an Express route parameter.
 * Express 5 types route params as `string | string[]`; named path segments
 * are expected to resolve to a single string at runtime, so array values are
 * treated as an unexpected routing mismatch and rejected.
 */
export function getRouteParam(param: string | string[]): string {
  if (Array.isArray(param)) {
    throw new Error('Expected a single route parameter value but received multiple values.');
  }

  return param;
}
