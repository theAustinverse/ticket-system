import type {
  EventDetail,
  EventSummary,
  Order,
  QueueStatus,
  RegistrationInfo,
  TicketType,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const api = {
  register: (email: string, password: string) =>
    request<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  listEvents: () => request<EventSummary[]>('/events'),

  getEvent: (id: string) => request<EventDetail>(`/events/${id}`),

  getTicketType: (id: string) =>
    request<TicketType>(`/events/ticket-types/${id}`),

  enterQueue: (ticketTypeId: string) =>
    request<{ token: string }>(`/queue/${ticketTypeId}/enter`, {
      method: 'POST',
    }),

  getQueueStatus: (ticketTypeId: string, token: string) =>
    request<QueueStatus>(
      `/queue/${ticketTypeId}/status?token=${encodeURIComponent(token)}`,
    ),

  createOrder: (
    authToken: string,
    queueToken: string,
    ticketTypeId: string,
    quantity: number,
    registration: RegistrationInfo,
  ) =>
    request<Order>('/orders', {
      method: 'POST',
      headers: { ...authHeader(authToken), 'x-queue-token': queueToken },
      body: JSON.stringify({ ticketTypeId, quantity, ...registration }),
    }),

  getOrder: (authToken: string, id: string) =>
    request<Order>(`/orders/${id}`, { headers: authHeader(authToken) }),

  payOrder: (authToken: string, id: string) =>
    request<Order>(`/orders/${id}/pay`, {
      method: 'POST',
      headers: authHeader(authToken),
    }),
};
