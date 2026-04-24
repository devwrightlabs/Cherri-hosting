import axios from 'axios';

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
  approvePayment: (paymentId: string) =>
    apiClient.post('/subscriptions/payments/approve', { paymentId }),
  completePayment: (paymentId: string, txid: string) =>
    apiClient.post('/subscriptions/payments/complete', { paymentId, txid }),
  cancel: () => apiClient.post('/subscriptions/cancel'),
};

// Payments (incomplete payment recovery)
export const paymentsApi = {
  verify: (paymentId: string) =>
    apiClient.post('/payments/verify', { paymentId }),
};
