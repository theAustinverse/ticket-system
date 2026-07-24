import type {
  AdminOrderRow,
  AdminTeamStat,
  AdminUser,
  ChatMessage,
  EventDetail,
  EventSummary,
  GroupMember,
  IncomingTransfer,
  Order,
  OrderWithSession,
  QueueStatus,
  RegistrationInfo,
  TicketTransfer,
  TicketType,
  UserProfile,
  ProfileInput,
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
    request<{ message: string; email: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  verifyRegistration: (email: string, code: string) =>
    request<{ accessToken: string }>('/auth/verify-registration', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  login: (email: string, password: string) =>
    request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  adminLogin: (username: string, password: string) =>
    request<{ accessToken: string }>('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  listEvents: () => request<EventSummary[]>('/events'),

  getEvent: (id: string) => request<EventDetail>(`/events/${id}`),

  getTicketType: (id: string) =>
    request<TicketType>(`/events/ticket-types/${id}`),

  enterQueue: (authToken: string, ticketTypeId: string, passcode?: string) =>
    request<{ token: string }>(`/queue/${ticketTypeId}/enter`, {
      method: 'POST',
      headers: authHeader(authToken),
      body: JSON.stringify({ passcode }),
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

  getProfile: (authToken: string) =>
    request<UserProfile>('/users/me', { headers: authHeader(authToken) }),

  updateProfile: (authToken: string, profile: ProfileInput) =>
    request<UserProfile>('/users/me', {
      method: 'PATCH',
      headers: authHeader(authToken),
      body: JSON.stringify(profile),
    }),

  listMyOrders: (authToken: string) =>
    request<OrderWithSession[]>('/orders/mine', {
      headers: authHeader(authToken),
    }),

  cancelOrder: (authToken: string, id: string) =>
    request<Order>(`/orders/${id}/cancel`, {
      method: 'POST',
      headers: authHeader(authToken),
    }),

  updateGroupMembers: (
    authToken: string,
    id: string,
    groupMembers: GroupMember[],
    childSeatCount?: number,
  ) =>
    request<Order>(`/orders/${id}/group-members`, {
      method: 'PATCH',
      headers: authHeader(authToken),
      body: JSON.stringify({ groupMembers, childSeatCount }),
    }),

  transferOrder: (authToken: string, id: string, toEmail: string) =>
    request<TicketTransfer>(`/orders/${id}/transfer`, {
      method: 'POST',
      headers: authHeader(authToken),
      body: JSON.stringify({ toEmail }),
    }),

  listIncomingTransfers: (authToken: string) =>
    request<IncomingTransfer[]>('/orders/transfers/incoming', {
      headers: authHeader(authToken),
    }),

  acceptTransfer: (authToken: string, transferId: string) =>
    request<Order>(`/orders/transfers/${transferId}/accept`, {
      method: 'POST',
      headers: authHeader(authToken),
    }),

  rejectTransfer: (authToken: string, transferId: string) =>
    request<TicketTransfer>(`/orders/transfers/${transferId}/reject`, {
      method: 'POST',
      headers: authHeader(authToken),
    }),

  cancelTransfer: (authToken: string, transferId: string) =>
    request<TicketTransfer>(`/orders/transfers/${transferId}/cancel`, {
      method: 'POST',
      headers: authHeader(authToken),
    }),

  adminListUsers: (authToken: string) =>
    request<AdminUser[]>('/admin/users', { headers: authHeader(authToken) }),

  adminDeleteUser: (authToken: string, id: string) =>
    request<{ deleted: boolean }>(`/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeader(authToken),
    }),

  adminBulkDeleteUsers: (authToken: string, ids: string[]) =>
    request<{ deleted: number }>('/admin/users/delete-bulk', {
      method: 'POST',
      headers: authHeader(authToken),
      body: JSON.stringify({ ids }),
    }),

  adminListOrders: (authToken: string) =>
    request<AdminOrderRow[]>('/admin/orders', {
      headers: authHeader(authToken),
    }),

  adminGetTeamStats: (authToken: string) =>
    request<AdminTeamStat[]>('/admin/team-stats', {
      headers: authHeader(authToken),
    }),

  adminUpdateOrderNote: (authToken: string, id: string, note: string) =>
    request<{ id: string; adminNote: string | null }>(
      `/admin/orders/${id}/note`,
      {
        method: 'PATCH',
        headers: authHeader(authToken),
        body: JSON.stringify({ note }),
      },
    ),

  adminDeleteOrder: (authToken: string, id: string) =>
    request<{ deleted: boolean }>(`/admin/orders/${id}`, {
      method: 'DELETE',
      headers: authHeader(authToken),
    }),

  adminBulkDeleteOrders: (authToken: string, ids: string[]) =>
    request<{ deleted: number }>('/admin/orders/delete-bulk', {
      method: 'POST',
      headers: authHeader(authToken),
      body: JSON.stringify({ ids }),
    }),

  /** Re-seeds every ticket type's stock counter back to its full totalQuantity. */
  adminResetStock: (authToken: string) =>
    request<{ id: string; name: string; resetTo: number }[]>(
      '/admin/reset-stock',
      { method: 'POST', headers: authHeader(authToken) },
    ),

  /** Deletes every synthetic loadtest<n>@gmail.com account (and their orders). */
  adminDeleteLoadTestUsers: (authToken: string) =>
    request<{ deleted: number }>('/admin/load-test-users', {
      method: 'DELETE',
      headers: authHeader(authToken),
    }),

  /** Downloads the orders export and triggers a browser save-as. When `team` is given, only that team's orders are included. */
  async adminExportOrders(authToken: string, team?: string): Promise<void> {
    const query = team ? `?team=${encodeURIComponent(team)}` : '';
    const res = await fetch(`${BASE_URL}/admin/export${query}`, {
      headers: authHeader(authToken),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.message ?? res.statusText, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = team ? `orders-${team}.xlsx` : 'orders.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },

  listChatMessages: (authToken: string) =>
    request<ChatMessage[]>('/chat/messages', { headers: authHeader(authToken) }),

  adminDeleteChatMessage: (authToken: string, id: string) =>
    request<{ deleted: boolean }>(`/admin/chat/${id}`, {
      method: 'DELETE',
      headers: authHeader(authToken),
    }),

  adminGenerateAiImage: (authToken: string, prompt: string, aspectRatio?: string) =>
    request<{ mimeType: string; base64: string }>('/admin/ai-image/generate', {
      method: 'POST',
      headers: authHeader(authToken),
      body: JSON.stringify({ prompt, aspectRatio }),
    }),
};
