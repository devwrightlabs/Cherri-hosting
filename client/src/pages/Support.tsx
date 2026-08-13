import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { supportApi, extractApiError, type SupportTicket } from '../lib/api';

function statusLabel(status: SupportTicket['status']): string {
  switch (status) {
    case 'OPEN':
      return 'Open';
    case 'AWAITING_OPERATOR':
      return 'Waiting on us';
    case 'AWAITING_USER':
      return 'Waiting on you';
    case 'CLOSED':
      return 'Closed';
    default:
      return status;
  }
}

/** List of the signed-in user's support tickets, with a "new ticket" form. */
export function SupportList() {
  const { error: toastError, success } = useToast();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    supportApi
      .list()
      .then((res) => setTickets(res.data.tickets))
      .catch((err) => toastError(extractApiError(err, 'Could not load support tickets.')));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const res = await supportApi.create(subject.trim(), body.trim());
      success('Ticket opened');
      setSubject('');
      setBody('');
      setShowForm(false);
      navigate(`/support/${res.data.ticket.id}`);
    } catch (err) {
      toastError(extractApiError(err, 'Could not open ticket. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Support"
        subtitle="Reach us here \u2014 there is no email support for Cherri Hosting."
        className="animate-fade-in"
      />

      {!showForm && (
        <Button onClick={() => setShowForm(true)} className="w-full justify-center">
          New ticket
        </Button>
      )}

      {showForm && (
        <Card className="animate-fade-in space-y-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full min-h-[48px] bg-surface-800 border border-surface-600 rounded-xl px-4 text-ink text-sm placeholder:text-ink-mut/60 focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the issue..."
            rows={5}
            className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-ink text-sm placeholder:text-ink-mut/60 focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 resize-y"
          />
          <div className="flex gap-2">
            <Button
              isLoading={submitting}
              disabled={!subject.trim() || !body.trim()}
              onClick={() => void handleCreate()}
            >
              Submit
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {tickets === null ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          description="Open a ticket if you run into a problem \u2014 we read and reply here in the app."
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Link key={t.id} to={`/support/${t.id}`}>
              <Card className="hover:border-cherry-500/40 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{t.subject}</p>
                    <p className="text-xs text-ink-mut mt-0.5">
                      {new Date(t.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide shrink-0 px-2 py-1 rounded-full ${
                      t.status === 'CLOSED'
                        ? 'bg-surface-700 text-ink-mut'
                        : t.status === 'AWAITING_OPERATOR'
                          ? 'bg-gold/15 text-gold'
                          : 'bg-cherry-500/15 text-cherry-300'
                    }`}
                  >
                    {statusLabel(t.status)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

/** Single ticket thread: full message history + reply box + close button. */
export function SupportDetail() {
  const { id } = useParams<{ id: string }>();
  const { error: toastError, success } = useToast();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = () => {
    if (!id) return;
    supportApi
      .get(id)
      .then((res) => setTicket(res.data.ticket))
      .catch((err) => toastError(extractApiError(err, 'Could not load ticket.')));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReply = async () => {
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      const res = await supportApi.reply(id, reply.trim());
      setTicket(res.data.ticket);
      setReply('');
    } catch (err) {
      toastError(extractApiError(err, 'Could not send reply.'));
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!id) return;
    setClosing(true);
    try {
      const res = await supportApi.close(id);
      setTicket(res.data.ticket);
      success('Ticket closed');
    } catch (err) {
      toastError(extractApiError(err, 'Could not close ticket.'));
    } finally {
      setClosing(false);
    }
  };

  if (!ticket) {
    return (
      <AppShell>
        <Skeleton className="h-24 w-full" />
      </AppShell>
    );
  }

  const isClosed = ticket.status === 'CLOSED';

  return (
    <AppShell>
      <PageHeader title={ticket.subject} subtitle={statusLabel(ticket.status)} className="animate-fade-in" />

      <div className="space-y-3">
        {ticket.messages.map((m) => (
          <Card
            key={m.id}
            className={m.fromOperator ? 'border-gold/40' : ''}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mut mb-1.5">
              {m.fromOperator ? 'Cherri Hosting' : 'You'} \u00b7{' '}
              {new Date(m.createdAt).toLocaleString()}
            </p>
            <p className="text-sm text-ink whitespace-pre-wrap">{m.body}</p>
          </Card>
        ))}
      </div>

      {!isClosed && (
        <Card className="space-y-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply..."
            rows={4}
            className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-ink text-sm placeholder:text-ink-mut/60 focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 resize-y"
          />
          <div className="flex gap-2">
            <Button isLoading={sending} disabled={!reply.trim()} onClick={() => void handleReply()}>
              Send
            </Button>
            <Button variant="ghost" isLoading={closing} onClick={() => void handleClose()}>
              Close ticket
            </Button>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
