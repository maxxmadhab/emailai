import React, { useState, useEffect, useCallback } from 'react';
import type { User, Email, Sender } from './types';
import { api, getCachedUser, setCachedUser, getAuthToken, setAuthToken, clearAuth, parseHashTokens } from './lib/api';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TopSearchBar } from './components/TopSearchBar';
import { EmailList } from './components/EmailList';
import { EmailDetailModal } from './components/EmailDetailModal';
import { ComposeModal } from './components/ComposeModal';
import { SendersModal } from './components/SendersModal';

import { supabase } from './lib/supabase';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
    const hashData = parseHashTokens();
    if (hashData) {
      setAuthToken(hashData.accessToken);
      setCachedUser(hashData.user);
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return hashData.user;
    }
    return getCachedUser();
  });
  const [loadingUser, setLoadingUser] = useState(false);

  // Navigation & Views
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent' | 'senders'>('scheduled');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  // Email & Sender Data
  const [scheduledEmails, setScheduledEmails] = useState<Email[]>([]);
  const [sentEmails, setSentEmails] = useState<Email[]>([]);
  const [counts, setCounts] = useState<{ scheduled: number; sent: number; failed: number; total: number }>({
    scheduled: 0,
    sent: 0,
    failed: 0,
    total: 0,
  });
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Helper to map Supabase user to App user
  const mapSupabaseUser = (sessionUser: any): User => {
    return {
      id: sessionUser.id,
      email: sessionUser.email || '',
      name:
        sessionUser.user_metadata?.full_name ||
        sessionUser.user_metadata?.name ||
        sessionUser.email?.split('@')[0] ||
        'User',
      avatar_url:
        sessionUser.user_metadata?.avatar_url ||
        sessionUser.user_metadata?.picture ||
        null,
    };
  };

  // Verify auth session on mount & subscribe to Supabase OAuth redirects
  useEffect(() => {
    // Check Slack OAuth redirect callback parameters
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const slackParam = urlParams.get('slack');
      if (slackParam === 'connected') {
        const team = urlParams.get('team') || 'Slack';
        setTimeout(() => alert(`🎉 Successfully connected to ${team}! Rate limit alerts will post to your channel.`), 500);
        urlParams.delete('slack');
        urlParams.delete('team');
        const remaining = urlParams.toString();
        window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : ''));
      } else if (slackParam === 'error') {
        const reason = urlParams.get('reason') || 'Authorization rejected';
        setTimeout(() => alert(`⚠️ Slack connection error: ${reason}`), 500);
        urlParams.delete('slack');
        urlParams.delete('reason');
        const remaining = urlParams.toString();
        window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : ''));
      }
    }

    // 0. Priority: check URL hash tokens from Google OAuth redirect
    const hashData = parseHashTokens();
    if (hashData) {
      setAuthToken(hashData.accessToken);
      setCachedUser(hashData.user);
      setUser(hashData.user);
      setLoadingUser(false);
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return;
    }

    // 1. Listen for Supabase auth state changes (e.g. Google OAuth redirect callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && session?.access_token) {
        setAuthToken(session.access_token);
        const mapped = mapSupabaseUser(session.user);
        setUser(mapped);
        setCachedUser(mapped);
        setLoadingUser(false);
        api.getMe().catch(() => {});
      } else if (event === 'SIGNED_OUT') {
        clearAuth();
        setUser(null);
        setLoadingUser(false);
      }
    });

    // 2. Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && session?.access_token) {
        setAuthToken(session.access_token);
        const mapped = mapSupabaseUser(session.user);
        setUser(mapped);
        setCachedUser(mapped);
        setLoadingUser(false);
      } else {
        const token = getAuthToken();
        if (token) {
          setLoadingUser(true);
          api
            .getMe()
            .then((u) => setUser(u))
            .catch((err) => {
              // Only clear if server explicitly returned 401/403
              if (err?.status === 401 || err?.status === 403) {
                clearAuth();
                setUser(null);
              }
            })
            .finally(() => setLoadingUser(false));
        } else {
          setLoadingUser(false);
        }
      }
    }).catch(() => {
      setLoadingUser(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch emails, senders, and real-time counts
  const refreshData = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingData(true);
      const [sched, sent, snd, cnt] = await Promise.all([
        api.getScheduledEmails().catch(() => []),
        api.getSentEmails().catch(() => []),
        api.getSenders().catch(() => []),
        api.getEmailCounts().catch(() => null),
      ]);
      const schedList = Array.isArray(sched) ? sched : (sched as any)?.items || [];
      const sentList = Array.isArray(sent) ? sent : (sent as any)?.items || [];
      setScheduledEmails(schedList);
      setSentEmails(sentList);
      setSenders(Array.isArray(snd) ? snd : (snd as any)?.items || []);
      if (cnt && typeof cnt.scheduled === 'number') {
        setCounts(cnt);
      } else {
        setCounts({
          scheduled: schedList.length,
          sent: sentList.filter((e: any) => e.status === 'sent').length,
          failed: sentList.filter((e: any) => e.status === 'failed').length,
          total: schedList.length + sentList.length,
        });
      }
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  // Real-time SSE subscription + initial load
  useEffect(() => {
    if (!user) return;
    refreshData();

    // Subscribe to SSE event stream from backend
    const unsubscribe = api.subscribeToEmailEvents(() => {
      refreshData();
    });

    return () => {
      unsubscribe();
    };
  }, [user, refreshData]);

  // Fallback auto-refetch interval while scheduled queue is non-empty
  useEffect(() => {
    if (!user) return;
    const hasActiveEmails = counts.scheduled > 0 || scheduledEmails.length > 0;
    const pollInterval = hasActiveEmails ? 3000 : 15000;
    const interval = setInterval(refreshData, pollInterval);
    return () => clearInterval(interval);
  }, [user, counts.scheduled, scheduledEmails.length, refreshData]);

  // Handle Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const results = await api.searchEmails(searchQuery.trim());
        setSearchResults(results);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLogout = () => {
    supabase.auth.signOut().catch(() => {});
    api.logout();
    setUser(null);
    setScheduledEmails([]);
    setSentEmails([]);
    setSenders([]);
    setSelectedEmail(null);
  };

  const handleCancelEmail = async (emailId: string) => {
    if (!confirm('Cancel this scheduled email?')) return;
    try {
      await api.cancelEmail(emailId);
      await refreshData();
    } catch (err: any) {
      alert(`Could not cancel email: ${err?.message}`);
    }
  };

  // If checking authentication session on initial mount
  if (loadingUser) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#00A340] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-gray-400 font-medium">Loading session...</span>
        </div>
      </div>
    );
  }

  // If user is not logged in, render the Figma Login Page
  if (!user) {
    return <LoginPage onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  // Active email list based on search or tab
  const displayedEmails =
    searchResults !== null
      ? searchResults.filter((e) =>
          activeTab === 'scheduled'
            ? e.status === 'scheduled' || e.status === 'processing'
            : e.status === 'sent' || e.status === 'failed'
        )
      : activeTab === 'scheduled'
      ? scheduledEmails
      : sentEmails;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      {/* Sidebar (matching Figma designs) */}
      <Sidebar
        user={user}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setSelectedEmail(null);
        }}
        onOpenCompose={() => setIsComposeOpen(true)}
        onLogout={handleLogout}
        scheduledCount={counts.scheduled || scheduledEmails.length}
        sentCount={(counts.sent + counts.failed) || sentEmails.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen min-w-0 bg-white">
        {/* Top Search Bar (matching Figma) */}
        <TopSearchBar
          query={searchQuery}
          onChangeQuery={setSearchQuery}
          onRefresh={refreshData}
          refreshing={loadingData || searching}
        />

        {/* View Switcher: Email Detail vs Senders vs Email List */}
        {selectedEmail ? (
          <EmailDetailModal
            email={selectedEmail}
            user={user}
            onBack={() => setSelectedEmail(null)}
            onDelete={() => {
              if (selectedEmail.status === 'scheduled') {
                handleCancelEmail(selectedEmail.id);
              }
              setSelectedEmail(null);
            }}
          />
        ) : activeTab === 'senders' ? (
          <SendersModal
            user={user}
            senders={senders}
            onRefreshSenders={refreshData}
            onBack={() => setActiveTab('scheduled')}
          />
        ) : (
          <EmailList
            emails={displayedEmails}
            loading={loadingData && displayedEmails.length === 0}
            onSelectEmail={(email) => setSelectedEmail(email)}
            onCancelEmail={handleCancelEmail}
            tab={activeTab}
          />
        )}
      </main>

      {/* Compose Modal (matching Figma) */}
      {isComposeOpen && (
        <ComposeModal
          senders={senders}
          onClose={() => setIsComposeOpen(false)}
          onSuccess={() => {
            setIsComposeOpen(false);
            refreshData();
          }}
        />
      )}
    </div>
  );
};

export default App;
