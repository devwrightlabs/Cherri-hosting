import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { invoicesApi, extractApiError, Invoice } from '../lib/api';

function formatCents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

function statusVariant(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'PAID') return 'success';
  if (status === 'OVERDUE') return 'error';
  if (status === 'PENDING') return 'warning';
  return 'default';
}

const statusLabel: Record<string, string> = {
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  PENDING: 'Awaiting payment',
  OPEN: 'Awaiting payment',
};

function friendlyStatus(status: string): string {
  if (statusLabel[status]) return statusLabel[status];
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function DetailRow({
  label,
  value,
  mono = false,
  bold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-mut shrink-0">{label}</span>
      <span
        className={`text-ink truncate ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function InvoiceSheet({
  inv,
  onClose,
}: {
  inv: Invoice;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-hairline rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-sheet animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-surface-700 mx-auto mb-5 sm:hidden" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink font-display">Invoice</h2>
          <Badge variant={statusVariant(inv.status)}>{friendlyStatus(inv.status)}</Badge>
        </div>

        <div className="space-y-2.5 text-sm">
          <DetailRow label="Plan" value={inv.plan} />
          <DetailRow
            label="Period"
            value={`${new Date(inv.cycleStart).toLocaleDateString()} – ${new Date(inv.cycleEnd).toLocaleDateString()}`}
          />
          <DetailRow label="Subscription" value={formatCents(inv.subscriptionCents)} mono />
          {inv.overageCents > 0 && (
            <DetailRow label="Overage" value={formatCents(inv.overageCents)} mono />
          )}
          <div className="border-t border-hairline pt-2.5">
            <DetailRow label="Total" value={formatCents(inv.totalCents)} mono bold />
          </div>
          {inv.paidAt && (
            <DetailRow label="Paid" value={new Date(inv.paidAt).toLocaleString()} />
          )}
          {!inv.paidAt && inv.dueAt && (
            <DetailRow label="Due" value={new Date(inv.dueAt).toLocaleDateString()} />
          )}
          {!inv.paidAt && inv.graceUntil && (
            <DetailRow
              label="Grace until"
              value={new Date(inv.graceUntil).toLocaleDateString()}
            />
          )}
        </div>

        <Button
          variant="secondary"
          className="w-full justify-center mt-5"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

export default function Billing() {
  const { error: toastError } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Invoice | null>(null);

  useEffect(() => {
    invoicesApi
      .list()
      .then((res) => setInvoices(res.data.invoices))
      .catch((err) => {
        toastError(extractApiError(err, 'Could not load billing history. Please refresh.'));
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Billing"
        subtitle="Your past invoices and charges."
        action={
          <Link to="/account">
            <Button size="sm" variant="secondary">Account settings</Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-6 w-28 mb-3" />
              <Skeleton className="h-4 w-44" />
            </Card>
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          }
          title="No invoices yet"
          description="Your billing history will appear here once you have been charged."
          action={
            <Link to="/pricing" className="block w-full">
              <Button className="w-full justify-center">View plans</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {invoices.map((inv) => (
            <button
              key={inv.id}
              className="w-full text-left"
              onClick={() => setSelected(inv)}
            >
              <Card className="hover:border-cherry-500/40 transition-colors cursor-pointer">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink truncate">{inv.plan}</p>
                  <p className="font-mono text-sm text-ink shrink-0">{formatCents(inv.totalCents)}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-xs text-ink-mut">
                    {new Date(inv.cycleStart).toLocaleDateString()} –{' '}
                    {new Date(inv.cycleEnd).toLocaleDateString()}
                  </p>
                  <Badge variant={statusVariant(inv.status)}>{friendlyStatus(inv.status)}</Badge>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {selected && <InvoiceSheet inv={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}
