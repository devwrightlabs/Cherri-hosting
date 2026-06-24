/**
 * Billing lifecycle reconciler (Phase 6 — overage + unpaid flow).
 *
 * Independent of the PiRC2 charge scheduler on purpose: unpaid-invoice handling
 * and notifications must run safely even when PiRC2 is unavailable. Each tick:
 *   1. Notifies (once) on invoices that are now due.
 *   2. For invoices still unpaid past their grace window: marks them OVERDUE,
 *      notifies, and pauses the user's apps (the IPFS-pinned front-end stays
 *      online; only a verified provider stop ever marks a backend PAUSED).
 *
 * This reconciler only PROCESSES invoices; generating invoices from a cycle
 * boundary requires the dollar-plan <-> tier mapping + live charging cutover and
 * is deliberately deferred. The loop is fully guarded so one bad row can never
 * crash the process.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { pauseUserApps } from './appLifecycleService';
import { notifyOnce } from './notificationService';
import { INVOICE_GRACE_DAYS } from './invoiceService';
import { isBackendLaneLive } from './goLiveService';

let started = false;

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** One reconciler pass. Safe to call repeatedly. */
export async function runLifecycleTick(): Promise<void> {
  // GO-LIVE gate: invoice dunning + app pausing are live actions; stay inert
  // until the operator flips the master switch.
  if (!(await isBackendLaneLive())) return;

  const now = new Date();

  // 1. Notify on invoices that are due (once each).
  const due = await prisma.invoice.findMany({
    where: { status: 'OPEN', dueAt: { lte: now } },
    select: { id: true, userId: true, totalCents: true },
  });
  for (const inv of due) {
    try {
      await notifyOnce({
        userId: inv.userId,
        type: 'INVOICE_DUE',
        invoiceId: inv.id,
        message: `You have a balance due of ${formatUsd(inv.totalCents)}. Settle it to keep your apps running.`,
      });
    } catch (err) {
      logger.error('Failed to emit invoice-due notification', { invoiceId: inv.id, error: err });
    }
  }

  // 2. Past the grace window and still unpaid -> OVERDUE + pause apps.
  const overdue = await prisma.invoice.findMany({
    where: { status: 'OPEN', graceUntil: { lte: now } },
    select: { id: true, userId: true },
  });
  for (const inv of overdue) {
    try {
      await notifyOnce({
        userId: inv.userId,
        type: 'INVOICE_OVERDUE',
        invoiceId: inv.id,
        message:
          'Your balance is overdue. Settle it to resume any paused apps — your published sites stay online.',
      });
      const res = await pauseUserApps(inv.userId, `Invoice ${inv.id} overdue`);
      if (res.paused > 0) {
        await notifyOnce({
          userId: inv.userId,
          type: 'APPS_PAUSED',
          invoiceId: inv.id,
          message: 'Apps paused — settle balance to resume. Your published sites remain online.',
        });
      }
      // Flip status LAST: if any step above throws, the invoice stays OPEN and a
      // later tick safely retries — notifyOnce dedups and pauseUserApps is
      // idempotent, so reprocessing causes no duplicate alerts or double pauses.
      await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'OVERDUE' } });
      logger.info('Invoice overdue processed', { invoiceId: inv.id, ...res });
    } catch (err) {
      logger.error('Failed to process overdue invoice', { invoiceId: inv.id, error: err });
    }
  }
}

/** Start the lifecycle reconciler loop once per process. */
export function startBillingLifecycleReconciler(): void {
  if (started) return;
  started = true;
  const tickMs = Math.max(15_000, Number(process.env.LIFECYCLE_TICK_MS ?? 60_000));
  setInterval(() => {
    runLifecycleTick().catch((err) => logger.error('Lifecycle tick failed', { error: err }));
  }, tickMs);
  logger.info('Billing lifecycle reconciler started', { tickMs, graceDays: INVOICE_GRACE_DAYS });
}
