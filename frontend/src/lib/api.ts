import type { User, Sender, Email, Campaign, SlackConnection } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('auth_token', token);
}

export function getCachedUser(): User | null {
  const raw = localStorage.getItem('auth_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCachedUser(user: User) {
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data?.error?.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    (error as any).code = data?.error?.code;
    (error as any).status = response.status;
    throw error;
  }

  return data.data !== undefined ? data.data : data;
}

export const api = {
  // Auth
  async loginWithDemo(email = 'oliver.brown@domain.io', name = 'Oliver Brown'): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/auth/demo-token', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
    setAuthToken(res.token);
    setCachedUser(res.user);
    return res;
  },

  async getMe(): Promise<User> {
    const user = await request<User>('/api/auth/me');
    setCachedUser(user);
    return user;
  },

  logout() {
    clearAuth();
  },

  // Senders
  async getSenders(): Promise<Sender[]> {
    return request<Sender[]>('/api/senders');
  },

  async createSender(payload: {
    name: string;
    email: string;
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass: string;
    hourly_limit?: number;
    min_delay_seconds?: number;
  }): Promise<Sender> {
    return request<Sender>('/api/senders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Campaigns & Scheduling
  async createCampaign(
    payload: {
      sender_id: string;
      name: string;
      subject: string;
      body: string;
      delay_seconds?: number;
      hourly_limit?: number;
      scheduled_start_at?: string;
      recipients: Array<{ email: string; name?: string }>;
    },
    idempotencyKey?: string
  ): Promise<Campaign> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    } else {
      headers['Idempotency-Key'] = `fe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    return request<Campaign>('/api/campaigns', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  },

  // Emails
  async getScheduledEmails(): Promise<Email[]> {
    return request<Email[]>('/api/emails/scheduled');
  },

  async getSentEmails(): Promise<Email[]> {
    return request<Email[]>('/api/emails/sent');
  },

  async getFailedEmails(): Promise<Email[]> {
    return request<Email[]>('/api/emails/failed');
  },

  async searchEmails(query: string, status?: string): Promise<Email[]> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    return request<Email[]>(`/api/emails/search?${params.toString()}`);
  },

  async cancelEmail(emailId: string): Promise<Email> {
    return request<Email>(`/api/emails/${emailId}/cancel`, {
      method: 'POST',
    });
  },

  // Slack Integration
  async getSlackConnection(): Promise<SlackConnection> {
    return request<SlackConnection>('/api/slack/connection');
  },

  async getSlackAuthUrl(): Promise<{ url: string }> {
    return request<{ url: string }>('/api/slack/connect');
  },

  async disconnectSlack(): Promise<{ disconnected: boolean }> {
    return request<{ disconnected: boolean }>('/api/slack/connection', {
      method: 'DELETE',
    });
  },
};
