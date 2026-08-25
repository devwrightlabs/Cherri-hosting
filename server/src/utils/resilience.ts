/**
 * Lightweight resilience primitives for wrapping external calls.
 *
 * - withTimeout:         rejects after `ms` milliseconds.
 * - withRetry:           bounded exponential-backoff retry.
 * - CircuitBreaker:      open/half-open/closed state machine; returns a clean
 *                        503-style error when the breaker is open so a slow
 *                        dependency never hangs or stack-traces the caller.
 * - withResilience:      composes all three: timeout → retry → circuit-breaker.
 *
 * All primitives are pure TypeScript; no external dependencies.
 */
import { logger } from './logger';

// ─── Timeout ─────────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(ms)),
      ms,
    );
    fn().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ─── Retry ───────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum total attempts (including the first). Default 3. */
  attempts?: number;
  /** Base delay in ms (doubles each retry). Default 200. */
  baseDelayMs?: number;
  /** Cap for exponential backoff in ms. Default 5000. */
  maxDelayMs?: number;
  /** Optional predicate; when false the error is re-thrown immediately. */
  isRetryable?: (err: unknown) => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    isRetryable = () => true,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) {
        throw err;
      }
      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      await delay(backoff);
    }
  }
  throw lastErr;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — dependency temporarily unavailable`);
    this.name = 'CircuitOpenError';
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Failures within the window before opening. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays OPEN (ms) before moving to HALF_OPEN. Default 30 000. */
  recoveryMs?: number;
  /** When in HALF_OPEN, how many probes to allow before re-closing/re-opening. Default 1. */
  halfOpenProbes?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successesInHalfOpen = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly recoveryMs: number;
  private readonly halfOpenProbes: number;
  readonly name: string;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.recoveryMs = opts.recoveryMs ?? 30_000;
    this.halfOpenProbes = opts.halfOpenProbes ?? 1;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.recoveryMs) {
        this.state = 'HALF_OPEN';
        this.successesInHalfOpen = 0;
      }
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'OPEN') {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successesInHalfOpen++;
      if (this.successesInHalfOpen >= this.halfOpenProbes) {
        logger.info(`Circuit breaker "${this.name}" closed (recovered)`);
        this.state = 'CLOSED';
        this.failures = 0;
        this.openedAt = null;
      }
    } else {
      // Reset failure count on success in closed state.
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === 'HALF_OPEN') {
      logger.warn(`Circuit breaker "${this.name}" reopened (half-open probe failed)`);
      this.state = 'OPEN';
      this.openedAt = Date.now();
      this.failures = this.failureThreshold;
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      logger.warn(`Circuit breaker "${this.name}" opened after ${this.failures} failures`);
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /** Testing seam. */
  __reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successesInHalfOpen = 0;
    this.openedAt = null;
  }
}

// ─── Composed: withResilience ─────────────────────────────────────────────────

export interface ResilienceOptions extends RetryOptions {
  timeoutMs?: number;
  breaker?: CircuitBreaker;
}

/**
 * Wrap an async call with timeout + retry + optional circuit-breaker.
 *
 * Order of operations:
 *   1. If breaker is provided and OPEN, throw CircuitOpenError immediately.
 *   2. Execute `fn` with the timeout wrapper.
 *   3. On failure, retry with exponential backoff.
 *   4. Record the final outcome (success or failure) on the breaker.
 */
export async function withResilience<T>(
  fn: () => Promise<T>,
  opts: ResilienceOptions = {},
): Promise<T> {
  const { timeoutMs = 10_000, breaker, ...retryOpts } = opts;

  const wrappedFn = () => withTimeout(fn, timeoutMs);
  const retryFn = () => withRetry(wrappedFn, retryOpts);

  if (breaker) {
    return breaker.execute(retryFn);
  }
  return retryFn();
}
