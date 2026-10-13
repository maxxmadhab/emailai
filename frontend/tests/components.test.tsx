// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
import { LoginPage } from '../src/components/LoginPage';
import { Sidebar } from '../src/components/Sidebar';
import { EmailList } from '../src/components/EmailList';
import { EmailDetailModal } from '../src/components/EmailDetailModal';
import { TopSearchBar } from '../src/components/TopSearchBar';
import type { User, Email } from '../src/types';

describe('Frontend UI Components (Figma Matches)', () => {
  const mockUser: User = {
    id: 'd3b07384-d113-4670-8ce6-904d90956488',
    email: 'oliver.brown@domain.io',
    name: 'Oliver Brown',
    avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
  };

  const mockScheduledEmail: Email = {
    id: 'email-1',
    user_id: mockUser.id,
    campaign_id: 'camp-1',
    sender_id: 'sender-1',
    recipient: 'john.smith@example.com',
    subject: 'Meeting follow-up - Scheduled',
    body: 'Hi John, just wanted to follow up on our meeting yesterday...',
    status: 'scheduled',
    scheduled_at: '2026-10-14T09:15:12.000Z',
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-14T00:00:00.000Z',
  };

  const mockSentEmail: Email = {
    id: 'email-2',
    user_id: mockUser.id,
    campaign_id: 'camp-1',
    sender_id: 'sender-1',
    recipient: 'sarah.wilson@example.com',
    subject: 'Re: Project Update',
    body: 'Thanks for the update, Sarah. Looks good!',
    status: 'sent',
    scheduled_at: '2026-10-13T09:00:00.000Z',
    sent_at: '2026-10-13T09:00:05.000Z',
    preview_url: 'https://ethereal.email/message/test123',
    created_at: '2026-10-13T00:00:00.000Z',
    updated_at: '2026-10-13T09:00:05.000Z',
  };

  it('renders LoginPage matching Figma design', () => {
    const handleLogin = vi.fn();
    render(<LoginPage onLoginSuccess={handleLogin} />);

    expect(screen.getAllByText('Login').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Login with Google')).toBeTruthy();
    expect(screen.getByPlaceholderText('Email ID')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('renders Sidebar with ONB branding, user profile, and counts', () => {
    const handleSelectTab = vi.fn();
    const handleOpenCompose = vi.fn();
    const handleLogout = vi.fn();

    render(
      <Sidebar
        user={mockUser}
        activeTab="scheduled"
        onSelectTab={handleSelectTab}
        onOpenCompose={handleOpenCompose}
        onLogout={handleLogout}
        scheduledCount={12}
        sentCount={785}
      />
    );

    expect(screen.getByText('ONB')).toBeTruthy();
    expect(screen.getByText('Oliver Brown')).toBeTruthy();
    expect(screen.getByText('oliver.brown@domain.io')).toBeTruthy();
    expect(screen.getByText('Compose')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('785')).toBeTruthy();
  });

  it('renders EmailList with scheduled badge and recipients', () => {
    const handleSelectEmail = vi.fn();

    render(
      <EmailList
        emails={[mockScheduledEmail]}
        loading={false}
        onSelectEmail={handleSelectEmail}
        tab="scheduled"
      />
    );

    expect(screen.getByText('To: John smith')).toBeTruthy();
    expect(screen.getByText('Meeting follow-up - Scheduled')).toBeTruthy();
  });

  it('renders EmailList with Sent badge and links for sent emails', () => {
    const handleSelectEmail = vi.fn();

    render(
      <EmailList
        emails={[mockSentEmail]}
        loading={false}
        onSelectEmail={handleSelectEmail}
        tab="sent"
      />
    );

    expect(screen.getByText('To: Sarah wilson')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByText('Re: Project Update')).toBeTruthy();
  });

  it('renders TopSearchBar and handles search input', () => {
    const handleChange = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <TopSearchBar
        query=""
        onChangeQuery={handleChange}
        onRefresh={handleRefresh}
      />
    );

    const input = screen.getByPlaceholderText('Search');
    fireEvent.change(input, { target: { value: 'meeting' } });
    expect(handleChange).toHaveBeenCalledWith('meeting');
  });

  it('renders EmailDetailModal with subject, callout box, and attachment cards', () => {
    const handleBack = vi.fn();

    render(
      <EmailDetailModal
        email={mockSentEmail}
        user={mockUser}
        onBack={handleBack}
      />
    );

    expect(screen.getByText('Re: Project Update')).toBeTruthy();
    expect(screen.getByText(/Extremely Exclusive/i)).toBeTruthy();
    expect(screen.getByText('Tennis_Coach_Profile.png')).toBeTruthy();
    expect(screen.getByText('Tennis_Coach_Profile2.png')).toBeTruthy();
  });
});
