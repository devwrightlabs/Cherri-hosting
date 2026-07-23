/**
 * Shared plain-language status labels — never show raw enum values to users.
 */

const DEPLOYMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Published',
  PENDING: 'Queued',
  UPLOADING: 'Uploading',
  PINNING: 'Publishing',
  FAILED: 'Failed',
};

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  PENDING: 'Awaiting payment',
  OPEN: 'Awaiting payment',
};

/** Fallback: turn an unknown enum like SOME_STATE into "Some state". */
function humanize(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function deploymentStatusLabel(status: string): string {
  return DEPLOYMENT_STATUS_LABEL[status] ?? humanize(status);
}

export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS_LABEL[status] ?? humanize(status);
}

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABEL[status] ?? humanize(status);
}
