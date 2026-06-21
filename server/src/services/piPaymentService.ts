import axios from 'axios';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import { PiEnv, serverKeyFor } from '../utils/piEnv';

const PI_API_BASE = 'https://api.minepi.com/v2';

/**
 * Guard every outbound Pi API call so a missing key for the requested
 * environment fails fast and honestly. Mainnet has no testnet fallback, so a
 * mainnet call without `PI_API_KEY_MAINNET` is refused rather than silently
 * processing real Pi with a sandbox key.
 */
function assertPiConfigured(env: PiEnv): string {
  const key = serverKeyFor(env);
  if (!key) {
    const detail =
      env === 'mainnet'
        ? 'Mainnet payments are not enabled on the server (PI_API_KEY_MAINNET missing).'
        : 'Pi Network is not configured on the server (PI_API_KEY missing). Payment features are unavailable.';
    throw new IntegrationUnavailableError('pi', detail);
  }
  return key;
}

interface PiPayment {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  /** ISO timestamp from the Pi Platform; gates legacy-price grandfathering. */
  created_at?: string;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: {
    txid: string;
    verified: boolean;
    _link: string;
  } | null;
}

function getPiApiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch a Pi payment by its identifier.
 */
export async function getPayment(
  paymentId: string,
  env: PiEnv = 'testnet',
): Promise<PiPayment> {
  const apiKey = assertPiConfigured(env);
  const response = await axios.get<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}`,
    {
      headers: getPiApiHeaders(apiKey),
      timeout: 10000,
    },
  );
  return response.data;
}

/**
 * Approve a payment on the server side (step 1 of payment flow).
 */
export async function approvePayment(
  paymentId: string,
  env: PiEnv = 'testnet',
): Promise<PiPayment> {
  const apiKey = assertPiConfigured(env);
  const response = await axios.post<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}/approve`,
    {},
    {
      headers: getPiApiHeaders(apiKey),
      timeout: 10000,
    },
  );
  logger.info('Pi payment approved', { paymentId, env });
  return response.data;
}

/**
 * Complete a payment on the server side (step 2 of payment flow).
 */
export async function completePayment(
  paymentId: string,
  txid: string,
  env: PiEnv = 'testnet',
): Promise<PiPayment> {
  const apiKey = assertPiConfigured(env);
  const response = await axios.post<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}/complete`,
    { txid },
    {
      headers: getPiApiHeaders(apiKey),
      timeout: 10000,
    },
  );
  logger.info('Pi payment completed', { paymentId, txid, env });
  return response.data;
}

/**
 * Verify that a payment's transaction has been confirmed on chain.
 */
export async function verifyPayment(
  paymentId: string,
  env: PiEnv = 'testnet',
): Promise<boolean> {
  try {
    const payment = await getPayment(paymentId, env);
    return (
      payment.status.developer_approved &&
      payment.status.transaction_verified &&
      !payment.status.cancelled &&
      !payment.status.user_cancelled
    );
  } catch (err) {
    logger.error('Failed to verify Pi payment', { paymentId, env, error: err });
    return false;
  }
}
