/**
 * In-app user notifications (Phase 6).
 *
 * Email delivery is intentionally NOT implemented in this phase; this store is
 * the single source the client reads, and an email channel can later mirror it.
 *
 * CAP_WARNING_80 / CAP_REACHED_100 are part of the type union but are NEVER
 * emitted until Phase 4 metering produces real usage-vs-cap data — we never
 * fabricate a cap-breach alert.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export type NotificationType =
  | 'INVOICE_DUE'
  | 'INVOICE_OVERDUE'
  | 'APPS_PAUSED'
  | 'APPS_RESUMED'
  | 'CAP_WARNING_80'
  | 'CAP_REACHED_100';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  invoiceId?: string | null;
}

export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message,
      invoiceId: input.invoiceId ?? null,
    },
  });
}

/**
 * Create a notification at most once per (userId, type, invoiceId), so a
 * reconciler running every minute (or several instances at once) never spams the
 * same alert. Dedup is enforced by a DB unique constraint and handled here as
 * create-or-ignore, which is concurrency-safe. Returns true when a new
 * notification was created, false when one already existed.
 */
export async function notifyOnce(input: CreateNotificationInput): Promise<boolean> {
  try {
    await createNotification(input);
    logger.info('Notification emitted', {
      userId: input.userId,
      type: input.type,
      invoiceId: input.invoiceId ?? null,
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false; // an alert for this exact event already exists
    }
    throw err;
  }
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/** Mark one of the user's notifications read. Returns false if not found. */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const res = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count === 1;
}

/** Mark all of the user's unread notifications read; returns how many. */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}
