import React, { useState, useEffect, useCallback } from 'react';
import type { User, Email, Sender } from './types';
import { api, getCachedUser, getAuthToken, clearAuth } from './lib/api';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TopSearchBar } from './components/TopSearchBar';
import { EmailList } from './components/EmailList';
import { EmailDetailModal } from './components/EmailDetailModal';
import { ComposeModal } from './components/ComposeModal';
import { SendersModal } from './components/SendersModal';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(getCachedUser());
  const [loadingUser, setLoadingUser] = useState(false);

  // Navigation & Views
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent' | 'senders'>('scheduled');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  // Email & Sender Data
  const [scheduledEmails, setScheduledEmails] = useState<Email[]>([]);
  const [sentEmails, setSentEmails] = useState<Email[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Verify auth session on mount
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      setLoadingUser(true);
      api
        .getMe()
        .then((u) => setUser(u))
        .catch(() => {
          // Token expired or invalid
          clearAuth();
          setUser(null);
        })
        .finally(() => setLoadingUser(false));
    }
  }, []);

  // Fetch emails and senders
  const refreshData = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingData(true);
      const [sched, sent, snd] = await Promise.all([
        api.getScheduledEmails().catch(() => []),
        api.getSentEmails().catch(() => []),
        api.getSenders().catch(() => []),
      ]);
      setScheduledEmails(sched);
      setSentEmails(sent);
      setSenders(snd);
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      refreshData();
      // Periodically poll every 8 seconds for background dispatch updates
      const interval = setInterval(refreshData, 8000);
      return () => clearInterval(interval);
    }
  }, [user, refreshData]);

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

  // If user is not logged in, render the Figma Login Page
  if (!user && !loadingUser) {
    return <LoginPage onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  // Active email list based on search or tab
  const displayedEmails =
    searchResults !== null
      ? searchResults.filter((e) =>
          activeTab === 'scheduled' ? e.status === 'scheduled' : e.status === 'sent'
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
        scheduledCount={scheduledEmails.length}
        sentCount={sentEmails.length}
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
