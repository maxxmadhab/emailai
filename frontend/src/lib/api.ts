import type { User, Sender, Email, Campaign, SlackConnection, Attachment } from '../types';

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

export function parseHashTokens(): { accessToken: string; user: User } | null {
  if (typeof window === 'undefined') return null;
  const rawHash = window.location.hash || '';
  const hash = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash;
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  if (!accessToken) return null;

  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    const user: User = {
      id: payload.sub || 'user-id',
      email: payload.email || payload.user_metadata?.email || '',
      name:
        payload.user_metadata?.full_name ||
        payload.user_metadata?.name ||
        payload.email?.split('@')[0] ||
        'User',
      avatar_url:
        payload.user_metadata?.avatar_url ||
        payload.user_metadata?.picture ||
        null,
    };
    return { accessToken, user };
  } catch (err) {
    console.error('Failed to parse URL hash access_token:', err);
    return null;
  }
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
    const res = await request<any>('/api/senders');
    return Array.isArray(res) ? res : res?.items || [];
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

  async createEtherealSender(): Promise<Sender> {
    const res = await request<any>('/api/senders/ethereal', {
      method: 'POST',
    });
    return res.data || res;
  },

  async updateSender(
    id: string,
    payload: {
      name?: string;
      email?: string;
      hourly_limit?: number;
      min_delay_seconds?: number;
      is_shared?: boolean;
    }
  ): Promise<Sender> {
    return request<Sender>(`/api/senders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteSender(id: string): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/senders/${id}`, {
      method: 'DELETE',
    });
  },

  // Admin Role Management
  async getAdminUsers(): Promise<User[]> {
    const res = await request<any>('/admin/users');
    return Array.isArray(res) ? res : res?.data || [];
  },

  async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<User> {
    const res = await request<any>(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    return res.data || res;
  },

  async getAdminSettings(): Promise<any> {
    const res = await request<any>('/admin/settings');
    return res.data || res;
  },

  // Campaigns & Scheduling
  async createCampaign(
    payload: {
      sender_id?: string;
      name?: string;
      subject: string;
      body: string;
      body_html?: string;
      delay_seconds?: number;
      hourly_limit?: number;
      scheduled_start_at?: string;
      recipients: string[] | Array<{ email: string; name?: string }>;
      attachmentIds?: string[];
    },
    idempotencyKey?: string
  ): Promise<Campaign> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    } else {
      headers['Idempotency-Key'] = `fe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    const recipientEmails = payload.recipients.map((r: any) =>
      typeof r === 'string' ? r.trim() : r.email?.trim()
    ).filter(Boolean);

    const bodyPayload = {
      ...payload,
      recipients: recipientEmails,
      start_time: payload.scheduled_start_at,
    };

    return request<Campaign>('/api/campaigns', {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });
  },

  // Emails
  async getScheduledEmails(): Promise<Email[]> {
    const res = await request<any>('/api/emails/scheduled');
    return Array.isArray(res) ? res : res?.items || [];
  },

  async getSentEmails(): Promise<Email[]> {
    const res = await request<any>('/api/emails/sent');
    return Array.isArray(res) ? res : res?.items || [];
  },

  async getFailedEmails(): Promise<Email[]> {
    const res = await request<any>('/api/emails/failed');
    return Array.isArray(res) ? res : res?.items || [];
  },

  async searchEmails(query: string, status?: string): Promise<Email[]> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    const res = await request<any>(`/api/emails/search?${params.toString()}`);
    return Array.isArray(res) ? res : res?.items || [];
  },

  async cancelEmail(emailId: string): Promise<Email> {
    return request<Email>(`/api/emails/${emailId}/cancel`, {
      method: 'POST',
    });
  },

  async getEmailCounts(): Promise<{ scheduled: number; sent: number; failed: number; total: number }> {
    return request<{ scheduled: number; sent: number; failed: number; total: number }>('/api/emails/counts');
  },

  subscribeToEmailEvents(onEvent: (event: any) => void): () => void {
    const token = getAuthToken();
    if (!token) return () => {};

    const url = `${API_BASE}/api/emails/events?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onEvent(parsed);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection notice:', err);
    };

    return () => {
      eventSource.close();
    };
  },

  // Slack Integration
  async getSlackConnection(): Promise<SlackConnection> {
    return request<SlackConnection>('/api/slack/connection');
  },

  async getSlackAuthUrl(): Promise<{ url: string }> {
    return request<{ url: string }>('/api/slack/auth-url');
  },

  async sendSlackTest(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/api/slack/test', {
      method: 'POST',
    });
  },

  async disconnectSlack(): Promise<{ disconnected: boolean }> {
    return request<{ disconnected: boolean }>('/api/slack/connection', {
      method: 'DELETE',
    });
  },

  // Attachments (C4)
  async uploadAttachment(file: File): Promise<Attachment> {
    const token = getAuthToken();
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/api/attachments`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Failed to upload attachment');
    }
    return data.data;
  },

  async deleteAttachment(attachmentId: string): Promise<void> {
    await request(`/api/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  },

  async getAttachmentDownload(attachmentId: string): Promise<{ url: string; filename: string }> {
    return request<{ url: string; filename: string }>(`/api/attachments/${attachmentId}/download`);
  },
};
