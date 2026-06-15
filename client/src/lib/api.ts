import axios from 'axios';
import type { PiEnv } from './piEnv';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

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
export const projectsApi = {
  list: () => apiClient.get('/projects'),
  get: (id: string) => apiClient.get(`/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiClient.post('/projects', data),
  update: (id: string, data: { name?: string; description?: string; customDomain?: string }) =>
    apiClient.patch(`/projects/${id}`, data),
  delete: (id: string) => apiClient.delete(`/projects/${id}`),
};

// Deployments
export const deploymentsApi = {
  deploy: (formData: FormData) =>
    apiClient.post('/deployments', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  get: (id: string) => apiClient.get(`/deployments/${id}`),
  listByProject: (projectId: string) =>
    apiClient.get(`/deployments/project/${projectId}`),
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

// System status — which external integrations are available on the server.
// Public (no auth) and intended to be fetched once, not polled.
export const statusApi = {
  get: () =>
    apiClient.get<{ integrations: IntegrationStatus; timestamp: string }>(
      '/status',
    ),
};
