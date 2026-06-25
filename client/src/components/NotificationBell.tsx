import { useState, useEffect, useRef } from 'react';
import { notificationsApi, extractApiError, AppNotification } from '../lib/api';
import { useToast } from './ui/Toast';

const TYPE_LABELS: Record<string, string> = {
  INVOICE_DUE: 'Invoice due',
  INVOICE_OVERDUE: 'Invoice overdue',
  APPS_PAUSED: 'Apps paused',
  APPS_RESUMED: 'Apps resumed',
  CAP_WARNING_80: 'Storage at 80%',
  CAP_REACHED_100: 'Storage full',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell() {
  const { error: toastError } = useToast();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.readAt).length;

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function loadNotifications() {
    notificationsApi
      .list()
      .then((res) => setNotifications(res.data.notifications))
      .catch((err) => {
        toastError(extractApiError(err, 'Could not load notifications.'));
      });
  }

  async function handleMarkAllRead() {
    setMarking(true);
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    } catch (err) {
      toastError(extractApiError(err, 'Could not mark notifications as read.'));
    } finally {
      setMarking(false);
    }
  }

  async function handleMarkRead(id: string) {
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    } catch {
      // Non-critical — silently ignore
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-ink-mut hover:text-ink hover:bg-surface-800 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[14px] h-3.5 rounded-full bg-gold px-0.5 text-[9px] font-bold text-surface-950 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[420px] flex flex-col bg-surface-900 border border-hairline rounded-xl shadow-sheet z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                className="text-xs text-gold hover:text-gold/80 transition-colors disabled:opacity-50"
                onClick={() => void handleMarkAllRead()}
                disabled={marking}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <p className="text-ink-mut text-sm text-center py-8">No notifications</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  className={`w-full text-left px-4 py-3 border-b border-hairline last:border-0 hover:bg-surface-800 transition-colors ${
                    !n.readAt ? 'bg-gold/5' : ''
                  }`}
                  onClick={() => void handleMarkRead(n.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${!n.readAt ? 'text-gold' : 'text-ink-mut'}`}>
                        {TYPE_LABELS[n.type] ?? n.type}
                      </p>
                      <p className="text-sm text-ink mt-0.5 leading-snug">{n.message}</p>
                    </div>
                    {!n.readAt && (
                      <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-gold" />
                    )}
                  </div>
                  <p className="text-[11px] text-ink-mut mt-1">{timeAgo(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
