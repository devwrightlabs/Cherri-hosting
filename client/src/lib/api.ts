import axios from 'axios';
import type { PiEnv } from './piEnv';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Origin the API/server is served from (no `/api` suffix). Used for resources
 * the server exposes outside `/api`, such as the sandboxed staging preview.
 * Empty string in production where client and server share an origin.
 */
export const API_BASE = BASE_URL;

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Inject auth token from localStorage on every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('pi_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const authApi = {
  signIn: (piAccessToken: string, username: string) =>
    apiClient.post('/auth/signin', { piAccessToken, username }),
  me: () => apiClient.get('/auth/me'),
  updateProfile: (data: { email?: string }) => apiClient.patch('/auth/me', data),
};

// Projects
export interface SiteExportInfo {
  cid: string;
  gatewayUrls: string[];
}

export const projectsApi = {
  list: () => apiClient.get('/projects'),
  get: (id: string) => apiClient.get(`/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiClient.post('/projects', data),
  update: (id: string, data: { name?: string; description?: string; customDomain?: string }) =>
    apiClient.patch(`/projects/${id}`, data),
  delete: (id: string) => apiClient.delete(`/projects/${id}`),
  // The CID + public gateway links — the inherent no-lock-in guarantee.
  exportSiteInfo: (id: string) =>
    apiClient.get<SiteExportInfo>(`/projects/${id}/export/site`),
  // Best-effort CAR archive. Returns a Blob (CAR) OR a JSON fallback payload;
  // inspect the response content-type to tell them apart.
  exportSiteArchive: (id: string) =>
    apiClient.get(`/projects/${id}/export/site`, {
      params: { archive: 1 },
      responseType: 'blob',
      timeout: 60000,
    }),
  // Direct pg_dump stream of the owner's database. Blob download; honest 503 when
  // there is no live database to export.
  exportDatabase: (id: string) =>
    apiClient.get(`/projects/${id}/export/database`, {
      responseType: 'blob',
      timeout: 60000,
    }),
};

// Deployments
export interface DomainTarget {
  cid: string;
  gatewayUrl: string;
  ipfsPath: string;
  /** DNSLink TXT record value: `dnslink=/ipfs/<cid>`. */
  dnslink: string;
  /** REAL gateway check — true only if the gateway actually served the CID. */
  served: boolean;
  /** Check was inconclusive (rate-limited / unreachable), not a definitive "down". */
  indeterminate: boolean;
  gatewayStatus: number | null;
  reason?: string;
  checkedAt: string;
}

export const deploymentsApi = {
  deploy: (formData: FormData) =>
    apiClient.post('/deployments', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  get: (id: string) => apiClient.get(`/deployments/${id}`),
  listByProject: (projectId: string) =>
    apiClient.get(`/deployments/project/${projectId}`),
  // Exact .pi target values + a REAL gateway-serves-CID verification.
  domainTarget: (deploymentId: string) =>
    apiClient.get<DomainTarget>(`/deployments/${deploymentId}/domain-target`, {
      timeout: 30000,
    }),
};

// Subscriptions
export const subscriptionsApi = {
  current: () => apiClient.get('/subscriptions/current'),
  approvePayment: (paymentId: string, env: PiEnv) =>
    apiClient.post('/subscriptions/payments/approve', { paymentId, env }),
  completePayment: (paymentId: string, txid: string, amount: number, env: PiEnv) =>
    apiClient.post('/subscriptions/payments/complete', { paymentId, txid, amount, env }),
  cancel: () => apiClient.post('/subscriptions/cancel'),
};

// Payments (incomplete payment recovery)
export const paymentsApi = {
  verify: (paymentId: string, env: PiEnv) =>
    apiClient.post('/payments/verify', { paymentId, env }),
};

// PiRC2 recurring subscriptions
export interface BillingEvent {
  id: string;
  type: string;
  status: string;
  amount: string | null;
  txId: string | null;
  message: string | null;
  createdAt: string;
}

export interface PiSubscription {
  id: string;
  tier: string;
  status: string;
  subscriberAddress: string | null;
  contractId: string | null;
  approvalTxId: string | null;
  currency: string;
  amountPerCycle: string;
  allowanceTotal: string;
  allowanceRemaining: string;
  intervalDays: number;
  cyclesAuthorized: number;
  cyclesBilled: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  createdAt: string;
  events: BillingEvent[];
}

export interface SubscribeParams {
  approvalTxId: string;
  subscriberAddress: string;
  amountPerCycle?: number;
  intervalDays?: number;
  cyclesAuthorized?: number;
}

export const pirc2Api = {
  current: () =>
    apiClient.get<{ subscription: PiSubscription | null }>(
      '/subscriptions/pirc2/current',
    ),
  subscribe: (params: SubscribeParams) =>
    apiClient.post<{ subscription: PiSubscription }>(
      '/subscriptions/pirc2/subscribe',
      params,
    ),
  cancel: () => apiClient.post('/subscriptions/pirc2/cancel'),
};

export interface IntegrationStatus {
  pi: boolean;
  pinata: boolean;
  database: boolean;
  pirc2: boolean;
}

/**
 * Sanitized health of the backend provider that runs per-app backends. The
 * server NEVER reveals which provider this is — only a generic operational/
 * outage state + a safe, user-facing message.
 */
export interface BackendProviderHealth {
  /** true = up, false = outage, null = not actively monitored. */
  operational: boolean | null;
  state: 'operational' | 'outage' | 'unknown';
  message: string;
}

export interface SystemStatus {
  integrations: IntegrationStatus;
  backendProvider: BackendProviderHealth;
  timestamp: string;
}

// System status — which external integrations are available on the server plus
// the sanitized backend-provider health. Public (no auth); polled by the banner.
export const statusApi = {
  get: () => apiClient.get<SystemStatus>('/status'),
};

// Invoices
export interface Invoice {
  id: string;
  plan: string;
  status: string;
  currency: string;
  subscriptionCents: number;
  overageCents: number;
  overageSource: string;
  totalCents: number;
  cycleStart: string;
  cycleEnd: string;
  dueAt: string;
  graceUntil: string;
  paidAt: string | null;
  createdAt: string;
}

export const invoicesApi = {
  list: () => apiClient.get<{ invoices: Invoice[] }>('/invoices'),
  get: (id: string) => apiClient.get<{ invoice: Invoice }>(`/invoices/${id}`),
};

// Notifications
export interface AppNotification {
  id: string;
  type: string;
  message: string;
  invoiceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: () => apiClient.get<{ notifications: AppNotification[] }>('/notifications'),
  markRead: (id: string) => apiClient.post(`/notifications/${id}/read`),
  markAllRead: () => apiClient.post('/notifications/read-all'),
};

/**
 * Extract a human-readable error message from an Axios error response.
 * Falls back to `fallback` when the response has no structured error field.
 */
export function extractApiError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === 'object' && 'error' in data) {
      const msg = (data as { error?: unknown }).error;
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
  }
  return fallback;
}
