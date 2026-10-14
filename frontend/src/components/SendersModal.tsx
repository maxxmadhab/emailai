import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, CheckCircle, AlertTriangle, Unplug, Shield, Trash2, Edit3, Users, Send } from 'lucide-react';
import type { Sender, SlackConnection, User } from '../types';
import { api } from '../lib/api';

interface SendersModalProps {
  user?: User | null;
  senders: Sender[];
  onRefreshSenders: () => void;
  onBack: () => void;
}

export const SendersModal: React.FC<SendersModalProps> = ({
  user: currentUser,
  senders,
  onRefreshSenders,
  onBack,
}) => {
  const isAdmin = currentUser?.role === 'admin';
  const safeSenders = Array.isArray(senders) ? senders : [];
  const [slack, setSlack] = useState<SlackConnection>({ connected: false });
  const [testAlertSending, setTestAlertSending] = useState(false);

  // New sender form state (Admin only)
  const [showAddSender, setShowAddSender] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [host, setHost] = useState('smtp.ethereal.email');
  const [port, setPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [minDelay, setMinDelay] = useState(2);
  const [savingSender, setSavingSender] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Editing sender state
  const [editingSenderId, setEditingSenderId] = useState<string | null>(null);
  const [editHourlyLimit, setEditHourlyLimit] = useState<number>(50);
  const [editMinDelay, setEditMinDelay] = useState<number>(2);

  // Admin users state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    loadSlack();
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  const loadSlack = async () => {
    try {
      const res = await api.getSlackConnection();
      setSlack(res);
    } catch {
      setSlack({ connected: false });
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await api.getAdminUsers();
      setUsersList(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
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

  const handleSendTestAlert = async () => {
    try {
      setTestAlertSending(true);
      const res = await api.sendSlackTest();
      alert(`Test message sent: ${res.message || 'Check your Slack channel!'}`);
    } catch (err: any) {
      alert(`Failed to send test alert: ${err?.message}`);
    } finally {
      setTestAlertSending(false);
    }
  };

  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!email || !smtpUser || !smtpPass) {
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
        smtp_user: smtpUser,
        smtp_pass: smtpPass,
        hourly_limit: Number(hourlyLimit),
        min_delay_seconds: Number(minDelay),
      });

      setFormSuccess('Sender verified and connected successfully!');
      setShowAddSender(false);
      onRefreshSenders();
      setName('');
      setEmail('');
      setSmtpUser('');
      setSmtpPass('');
    } catch (err: any) {
      setFormError(err?.message || 'SMTP connection verification failed.');
    } finally {
      setSavingSender(false);
    }
  };

  const handleUpdateLimits = async (senderId: string) => {
    try {
      await api.updateSender(senderId, {
        hourly_limit: editHourlyLimit,
        min_delay_seconds: editMinDelay,
      });
      setEditingSenderId(null);
      onRefreshSenders();
    } catch (err: any) {
      alert(`Could not update limits: ${err?.message}`);
    }
  };

  const handleDeleteSender = async (senderId: string) => {
    if (!confirm('Are you sure you want to delete this sender?')) return;
    try {
      await api.deleteSender(senderId);
      onRefreshSenders();
    } catch (err: any) {
      alert(`Could not delete sender: ${err?.message}`);
    }
  };

  const handleToggleUserRole = async (targetUser: any) => {
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`Change role of ${targetUser.email} to ${newRole}?`)) return;
    try {
      await api.updateUserRole(targetUser.id, newRole);
      await loadUsers();
    } catch (err: any) {
      alert(`Could not update user role: ${err?.message}`);
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
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">
              {isAdmin ? 'Admin Senders & Integrations' : 'Senders & Slack Integration'}
            </h2>
            {isAdmin ? (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Admin
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium">
                Shared Senders
              </span>
            )}
          </div>
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
                  Get notified automatically in Slack whenever a shared sender hits its hourly outreach cap.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {slack.connected ? (
                <>
                  <button
                    onClick={handleSendTestAlert}
                    disabled={testAlertSending}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{testAlertSending ? 'Sending...' : 'Send Test Alert'}</span>
                  </button>
                  <button
                    onClick={handleDisconnectSlack}
                    className="px-3.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Unplug className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnectSlack}
                  className="px-4 py-1.5 rounded-lg bg-[#00A340] hover:bg-[#008f37] text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <span>Connect Slack</span>
                </button>
              )}
            </div>
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
              <h3 className="text-sm font-bold text-gray-900">
                {isAdmin ? 'Manage Outreach Senders' : 'Available Outreach Senders (Shared)'}
              </h3>
              <p className="text-xs text-gray-500">
                {isAdmin
                  ? 'As an Admin, you can add senders, configure hourly limits, and enforce minimum delay caps.'
                  : 'These verified senders are managed by your team administrator. You can select them when composing.'}
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowAddSender(!showAddSender)}
                className="px-3.5 py-1.5 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340]/5 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddSender ? 'Cancel' : 'Add Sender'}</span>
              </button>
            )}
          </div>

          {/* Add Sender Form (Admin Only) */}
          {isAdmin && showAddSender && (
            <form onSubmit={handleCreateSender} className="mb-6 p-5 rounded-2xl border border-gray-200 bg-gray-50/60 space-y-4">
              <h4 className="text-xs font-bold text-gray-900">Add New Shared SMTP Sender</h4>

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
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="Ethereal user"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">SMTP Password</label>
                  <input
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder="Ethereal password"
                    className="w-full h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Max Hourly Outreach Limit</label>
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
                className="p-4 rounded-xl border border-gray-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-gray-300 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#E5F4EC] text-[#00A340] flex items-center justify-center font-bold text-xs shrink-0">
                    {s.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">{s.name}</h4>
                    <p className="text-[11px] text-gray-500">{s.email}</p>
                  </div>
                </div>

                {editingSenderId === s.id ? (
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">Max Limit:</span>
                      <input
                        type="number"
                        value={editHourlyLimit}
                        onChange={(e) => setEditHourlyLimit(parseInt(e.target.value) || 1)}
                        className="w-16 h-7 px-2 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">Min Delay:</span>
                      <input
                        type="number"
                        value={editMinDelay}
                        onChange={(e) => setEditMinDelay(parseInt(e.target.value) || 0)}
                        className="w-14 h-7 px-2 border border-gray-300 rounded text-xs"
                      />
                      <span>s</span>
                    </div>
                    <button
                      onClick={() => handleUpdateLimits(s.id)}
                      className="px-2.5 py-1 bg-[#00A340] text-white rounded text-xs font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingSenderId(null)}
                      className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                    {isAdmin && s.smtp_host && (
                      <span><strong>Host:</strong> {s.smtp_host}:{s.smtp_port}</span>
                    )}
                    <span><strong>Max Hourly Quota:</strong> {s.hourly_limit}/hr</span>
                    <span><strong>Enforced Min Delay:</strong> {s.min_delay_seconds}s</span>
                    <div className="flex items-center gap-1 text-emerald-600 text-[11px] font-medium">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Verified</span>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1 border-l pl-3 ml-2 border-gray-200">
                        <button
                          onClick={() => {
                            setEditingSenderId(s.id);
                            setEditHourlyLimit(s.hourly_limit);
                            setEditMinDelay(s.min_delay_seconds ?? 2);
                          }}
                          title="Edit Limits"
                          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-800 transition"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSender(s.id)}
                          title="Delete Sender"
                          className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {safeSenders.length === 0 && (
              <div className="p-8 text-center border border-dashed border-gray-200 rounded-xl text-gray-400 text-xs">
                No senders connected yet. {isAdmin ? 'Click "Add Sender" above to configure your outreach mailbox.' : 'Please ask an administrator to configure a shared sender.'}
              </div>
            )}
          </div>
        </div>

        {/* User Role Management (Admin only) */}
        {isAdmin && (
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-gray-700" />
              <h3 className="text-sm font-bold text-gray-900">User Role Management</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Admins can promote or demote workspace members. Senders and system queue limits are shared across all users.
            </p>

            {loadingUsers ? (
              <div className="p-4 text-center text-xs text-gray-400">Loading users...</div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {usersList.map((u) => (
                  <div key={u.id} className="p-3.5 flex items-center justify-between bg-white text-xs">
                    <div>
                      <p className="font-semibold text-gray-900">{u.name || u.email}</p>
                      <p className="text-[11px] text-gray-500">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          u.role === 'admin'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {u.role}
                      </span>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleToggleUserRole(u)}
                          className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 text-[11px] font-medium text-gray-700 transition cursor-pointer"
                        >
                          {u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
