import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, CheckCircle, AlertTriangle, Unplug } from 'lucide-react';
import type { Sender, SlackConnection } from '../types';
import { api } from '../lib/api';

interface SendersModalProps {
  senders: Sender[];
  onRefreshSenders: () => void;
  onBack: () => void;
}

export const SendersModal: React.FC<SendersModalProps> = ({
  senders,
  onRefreshSenders,
  onBack,
}) => {
  const safeSenders = Array.isArray(senders) ? senders : [];
  const [slack, setSlack] = useState<SlackConnection>({ connected: false });

  // New sender form state
  const [showAddSender, setShowAddSender] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [host, setHost] = useState('smtp.ethereal.email');
  const [port, setPort] = useState(587);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [minDelay, setMinDelay] = useState(2);
  const [savingSender, setSavingSender] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadSlack();
  }, []);

  const loadSlack = async () => {
    try {
      const res = await api.getSlackConnection();
      setSlack(res);
    } catch {
      setSlack({ connected: false });
    }
  };

  const handleConnectSlack = async () => {
    try {
      const res = await api.getSlackAuthUrl();
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      alert(`Could not start Slack OAuth: ${err?.message}`);
    }
  };

  const handleDisconnectSlack = async () => {
    try {
      await api.disconnectSlack();
      await loadSlack();
    } catch (err: any) {
      alert(`Could not disconnect Slack: ${err?.message}`);
    }
  };

  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!email || !user || !pass) {
      setFormError('Please fill in email, username, and password.');
      return;
    }

    try {
      setSavingSender(true);
      await api.createSender({
        name: name || email.split('@')[0],
        email,
        smtp_host: host,
        smtp_port: Number(port),
        smtp_user: user,
        smtp_pass: pass,
        hourly_limit: Number(hourlyLimit),
        min_delay_seconds: Number(minDelay),
      });

      setFormSuccess('Sender verified and connected successfully!');
      setShowAddSender(false);
      onRefreshSenders();
      // Reset form
      setName('');
      setEmail('');
      setUser('');
      setPass('');
    } catch (err: any) {
      setFormError(err?.message || 'SMTP connection verification failed.');
    } finally {
      setSavingSender(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-700 transition cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-bold text-gray-900">
            Senders & Integrations
          </h2>
        </div>
      </div>

      <div className="p-8 max-w-4xl space-y-8">
        {/* Slack Quota Alert Integration Card */}
        <div className="p-6 rounded-2xl border border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#4A154B] text-white flex items-center justify-center font-bold text-lg">
                #
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span>Slack Hourly Limit Notifications</span>
                  {slack.connected ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                      Connected
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-semibold">
                      Disconnected
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Get notified automatically in Slack whenever a sender reaches its hourly outreach limit.
                </p>
              </div>
            </div>

            {slack.connected ? (
              <button
                onClick={handleDisconnectSlack}
                className="px-3.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                onClick={handleConnectSlack}
                className="px-4 py-1.5 rounded-lg bg-[#00A340] hover:bg-[#008f37] text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <span>Connect Slack</span>
              </button>
            )}
          </div>

          {slack.connected && (
            <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-600 flex items-center gap-4">
              <span><strong>Workspace:</strong> {slack.team_name || 'ReachInbox'}</span>
              <span><strong>Channel:</strong> {slack.channel || '#email-alerts'}</span>
            </div>
          )}
        </div>

        {/* Senders List Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Connected SMTP Senders</h3>
              <p className="text-xs text-gray-500">
                Outbox Labs uses Ethereal test accounts to safely send and preview outreach emails.
              </p>
            </div>
            <button
              onClick={() => setShowAddSender(!showAddSender)}
              className="px-3.5 py-1.5 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340]/5 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddSender ? 'Cancel' : 'Add Sender'}</span>
            </button>
          </div>

          {/* Add Sender Form */}
          {showAddSender && (
            <form onSubmit={handleCreateSender} className="mb-6 p-5 rounded-2xl border border-gray-200 bg-gray-50/60 space-y-4">
              <h4 className="text-xs font-bold text-gray-900">Connect SMTP Account</h4>

              {formError && (
                <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-gray-600 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Oliver Brown"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="oliver.brown@ethereal.email"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">SMTP Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">SMTP Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 587)}
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">SMTP Username</label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="Ethereal user"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">SMTP Password</label>
                  <input
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    placeholder="Ethereal password"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Hourly Limit</label>
                  <input
                    type="number"
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(parseInt(e.target.value) || 1)}
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Min Delay Between Emails (seconds)</label>
                  <input
                    type="number"
                    value={minDelay}
                    onChange={(e) => setMinDelay(parseInt(e.target.value) || 0)}
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSender(false)}
                  className="px-4 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSender}
                  className="px-4 py-1.5 rounded-lg bg-[#00A340] hover:bg-[#008f37] text-white text-xs font-semibold transition cursor-pointer"
                >
                  {savingSender ? 'Verifying SMTP...' : 'Save & Verify'}
                </button>
              </div>
            </form>
          )}

          {/* Senders Cards */}
          <div className="space-y-3">
            {safeSenders.map((s) => (
              <div
                key={s.id}
                className="p-4 rounded-xl border border-gray-200 bg-white flex items-center justify-between hover:border-gray-300 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#E5F4EC] text-[#00A340] flex items-center justify-center font-bold text-xs">
                    {s.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">{s.name}</h4>
                    <p className="text-[11px] text-gray-500">{s.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs text-gray-600">
                  <span><strong>Host:</strong> {s.smtp_host}:{s.smtp_port}</span>
                  <span><strong>Hourly Quota:</strong> {s.hourly_limit}/hr</span>
                  <span><strong>Min Delay:</strong> {s.min_delay_seconds}s</span>
                  <div className="flex items-center gap-1 text-emerald-600 text-[11px] font-medium">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Verified</span>
                  </div>
                </div>
              </div>
            ))}

            {safeSenders.length === 0 && (
              <div className="p-8 text-center border border-dashed border-gray-200 rounded-xl text-gray-400 text-xs">
                No senders connected yet. Click "Add Sender" above to configure your outreach mailbox.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
