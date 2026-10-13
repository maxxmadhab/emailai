export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
}

export interface Sender {
  id: string;
  user_id: string;
  name: string;
  email: string;
  provider: string;
  smtp_host: string;
  smtp_port: number;
  hourly_limit: number;
  min_delay_seconds: number;
  created_at: string;
}

export interface Email {
  id: string;
  user_id: string;
  campaign_id: string;
  sender_id: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string;
  sent_at?: string | null;
  failed_at?: string | null;
  error_message?: string | null;
  preview_url?: string | null;
  message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  sender_id: string;
  name: string;
  subject: string;
  body: string;
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'paused' | 'cancelled';
  delay_seconds: number;
  hourly_limit: number;
  scheduled_start_at: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export interface SlackConnection {
  connected: boolean;
  team_name?: string;
  channel?: string;
  created_at?: string;
}

export interface RecipientRow {
  email: string;
  name?: string;
  company?: string;
  [key: string]: any;
}
