/**
 * Access control + event recording for PiRC2 subscriptions.
 *
 * Access to PREMIUM is granted strictly as a consequence of a successful
 * on-chain charge and revoked immediately when a subscription is cancelled or a
 * billing draw fails (insufficient funds). Tier state on the User is the single
 * source of truth the rest of the app gates on.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import {
  FREE_STORAGE_LIMIT_BYTES,
  PREMIUM_STORAGE_LIMIT_BYTES,
} from '../utils/constants';

/** Grant PREMIUM access (tier + storage limit) to a user. */
export async function grantPremiumAccess(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tier: 'PREMIUM', storageLimit: BigInt(PREMIUM_STORAGE_LIMIT_BYTES) },
  });
  logger.info('Granted PREMIUM access', { userId });
}

/**
 * True when the user still holds a PREMIUM entitlement from another source —
 * either a still-valid legacy one-time Subscription or another ACTIVE PiRC2
 * subscription. Used to avoid de-entitling a user who is legitimately paid up
 * through a different channel.
 */
export async function hasOtherActiveEntitlement(
  userId: string,
  excludePiSubscriptionId?: string,
): Promise<boolean> {
  const now = new Date();
  const [legacy, otherPi] = await Promise.all([
    prisma.subscription.findFirst({
      where: { userId, status: 'active', periodEnd: { gte: now } },
      select: { id: true },
    }),
    prisma.piSubscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        ...(excludePiSubscriptionId ? { id: { not: excludePiSubscriptionId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  return Boolean(legacy || otherPi);
}

/**
 * Revoke PREMIUM access, returning the user to the FREE tier and limit — unless
 * the user still has another active entitlement, in which case access is left
 * untouched.
 */
export async function revokePremiumAccess(
  userId: string,
  excludePiSubscriptionId?: string,
): Promise<void> {
  if (await hasOtherActiveEntitlement(userId, excludePiSubscriptionId)) {
    logger.info('Skipped PREMIUM revoke — user retains another active entitlement', {
      userId,
    });
    return;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { tier: 'FREE', storageLimit: BigInt(FREE_STORAGE_LIMIT_BYTES) },
  });
  logger.info('Revoked PREMIUM access', { userId });
}

export type BillingEventType =
  | 'APPROVAL'
  | 'CHARGE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'INSUFFICIENT_FUNDS'
  | 'EXPIRY';

export interface RecordBillingEventInput {
  subscriptionId: string;
  type: BillingEventType;
  status: 'SUCCESS' | 'FAILED';
  amount?: Prisma.Decimal | string | null;
  txId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  message?: string | null;
}

/** Append an immutable billing/lifecycle event for a subscription. */
export async function recordBillingEvent(
  input: RecordBillingEventInput,
): Promise<void> {
  await prisma.billingEvent.create({
    data: {
      subscriptionId: input.subscriptionId,
      type: input.type,
      status: input.status,
      amount:
        input.amount === undefined || input.amount === null
          ? null
          : new Prisma.Decimal(input.amount),
      txId: input.txId ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      message: input.message ?? null,
    },
  });
}
