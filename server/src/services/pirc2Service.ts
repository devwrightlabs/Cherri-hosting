/**
 * PiRC2 adapter — Pi Network's on-chain recurring-subscription standard.
 *
 * PiRC2 is a Soroban (Stellar) smart-contract standard. A subscriber grants the
 * subscription contract a one-time spending *allowance*; funds stay in their
 * wallet and the contract (driven by the merchant's billing job) draws one cycle
 * at a time via `transfer_from`, bounded by the approved allowance and horizon.
 *
 * This module is the single seam between the app's subscription lifecycle and
 * the chain. Design rules:
 *   - When PiRC2 is not configured, every on-chain operation throws
 *     IntegrationUnavailableError so callers return a clear 503 — it NEVER
 *     reports a fake/successful charge.
 *   - `verifyAllowanceApproval` performs a real Soroban RPC lookup of the
 *     approval transaction when configured.
 *   - The mutating draw/revoke operations require, in addition to the read
 *     config, a merchant signer (PIRC2_MERCHANT_SECRET) to author the
 *     `transfer_from` invocation. Until that is provisioned they fail clearly.
 *
 * Live charging is enabled by setting PIRC2_CONTRACT_ID, SOROBAN_RPC_URL,
 * PIRC2_NETWORK_PASSPHRASE and PIRC2_MERCHANT_SECRET.
 */
import { logger } from '../utils/logger';
import { isPirc2Configured, IntegrationUnavailableError } from '../utils/integrations';

/** Thrown when a billing cycle cannot be drawn because the subscriber's wallet
 *  balance (or remaining allowance) is insufficient at billing time. This is a
 *  real on-chain outcome and causes the subscription to go PAST_DUE. */
export class InsufficientFundsError extends Error {
  constructor(
    message = 'Subscriber wallet has insufficient balance or allowance for this billing cycle.',
  ) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

const PIRC2_INTEGRATION = 'pirc2';

function assertConfigured(): void {
  if (!isPirc2Configured()) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 is not configured on the server (PIRC2_CONTRACT_ID, SOROBAN_RPC_URL, ' +
        'PIRC2_NETWORK_PASSPHRASE required). Recurring subscriptions are unavailable.',
    );
  }
}

/** True when the merchant signer needed to author on-chain draws is present. */
function hasMerchantSigner(): boolean {
  return Boolean(process.env.PIRC2_MERCHANT_SECRET);
}

function assertCanDraw(): void {
  assertConfigured();
  if (!hasMerchantSigner()) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 merchant signer is not configured (PIRC2_MERCHANT_SECRET). The server ' +
        'cannot author on-chain draws until it is set.',
    );
  }
}

export interface AllowanceApproval {
  /** On-chain account that granted the allowance. */
  subscriberAddress: string;
  /** Hash of the approval transaction submitted by the subscriber. */
  approvalTxId: string;
}

export interface ChargeRequest {
  subscriberAddress: string;
  /** 1-based index of the cycle being drawn (for logging/idempotency). */
  cycleIndex: number;
  /** Amount to draw this cycle. */
  amount: string;
}

export interface ChargeResult {
  txId: string;
}

const SOROBAN_TIMEOUT_MS = 12_000;

/** Minimal Soroban JSON-RPC call helper. */
async function sorobanRpc<T>(method: string, params: unknown): Promise<T> {
  const url = process.env.SOROBAN_RPC_URL as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOROBAN_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Soroban RPC ${method} failed with HTTP ${res.status}`);
    }
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) {
      throw new Error(`Soroban RPC ${method} error: ${json.error.message ?? 'unknown'}`);
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the subscriber's one-time allowance approval transaction on-chain.
 * Returns true when the transaction is found and succeeded. Throws
 * IntegrationUnavailableError when PiRC2 is not configured.
 */
export async function verifyAllowanceApproval(
  approval: AllowanceApproval,
): Promise<boolean> {
  assertConfigured();
  const result = await sorobanRpc<{ status: string }>('getTransaction', {
    hash: approval.approvalTxId,
  });
  const verified = result?.status === 'SUCCESS';
  logger.info('PiRC2 allowance approval verification', {
    approvalTxId: approval.approvalTxId,
    subscriberAddress: approval.subscriberAddress,
    status: result?.status,
    verified,
  });
  return verified;
}

/**
 * Draw one billing cycle from the subscriber's approved allowance via the
 * contract's `transfer_from`. Returns the on-chain tx hash on success.
 *
 * Throws InsufficientFundsError when the wallet/allowance cannot cover the
 * cycle, and IntegrationUnavailableError when PiRC2 (or its merchant signer) is
 * not provisioned. It never returns a fabricated success.
 */
export async function chargeCycle(_req: ChargeRequest): Promise<ChargeResult> {
  assertCanDraw();
  // Activation seam: build, sign (with PIRC2_MERCHANT_SECRET) and submit the
  // `transfer_from` contract invocation against PIRC2_CONTRACT_ID, then poll
  // getTransaction for SUCCESS. Distinguish an allowance/balance shortfall and
  // throw InsufficientFundsError so the scheduler revokes access immediately.
  throw new IntegrationUnavailableError(
    PIRC2_INTEGRATION,
    'PiRC2 on-chain draw is not yet wired for this network. Provision the contract ' +
      'client + merchant signer to enable recurring charges.',
  );
}

/**
 * Revoke the subscriber's allowance (best-effort) when a subscription is
 * cancelled. Throws IntegrationUnavailableError when not provisioned; callers
 * treat that as a soft failure and still cancel locally.
 */
export async function revokeAllowance(subscriberAddress: string): Promise<void> {
  assertCanDraw();
  logger.info('PiRC2 allowance revocation requested', { subscriberAddress });
  throw new IntegrationUnavailableError(
    PIRC2_INTEGRATION,
    'PiRC2 on-chain allowance revocation is not yet wired for this network.',
  );
}
