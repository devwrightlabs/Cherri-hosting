import axios from 'axios';
import { logger } from '../utils/logger';

const PI_API_BASE = 'https://api.minepi.com/v2';

interface PiPayment {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
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

function getPiApiHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${process.env.PI_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch a Pi payment by its identifier.
 */
export async function getPayment(paymentId: string): Promise<PiPayment> {
  const response = await axios.get<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}`,
    {
      headers: getPiApiHeaders(),
      timeout: 10000,
    },
  );
  return response.data;
}

/**
 * Approve a payment on the server side (step 1 of payment flow).
 */
export async function approvePayment(paymentId: string): Promise<PiPayment> {
  const response = await axios.post<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}/approve`,
    {},
    {
      headers: getPiApiHeaders(),
      timeout: 10000,
    },
  );
  logger.info('Pi payment approved', { paymentId });
  return response.data;
}

/**
 * Complete a payment on the server side (step 2 of payment flow).
 */
export async function completePayment(
  paymentId: string,
  txid: string,
): Promise<PiPayment> {
  const response = await axios.post<PiPayment>(
    `${PI_API_BASE}/payments/${paymentId}/complete`,
    { txid },
    {
      headers: getPiApiHeaders(),
      timeout: 10000,
    },
  );
  logger.info('Pi payment completed', { paymentId, txid });
  return response.data;
}

/**
 * Verify that a payment's transaction has been confirmed on chain.
 */
export async function verifyPayment(paymentId: string): Promise<boolean> {
  try {
    const payment = await getPayment(paymentId);
    return (
      payment.status.developer_approved &&
      payment.status.transaction_verified &&
      !payment.status.cancelled &&
      !payment.status.user_cancelled
    );
  } catch (err) {
    logger.error('Failed to verify Pi payment', { paymentId, error: err });
    return false;
  }
}
