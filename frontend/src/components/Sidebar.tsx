import React, { useState } from 'react';
import { Clock, Send, ChevronDown, Plus, LogOut, Settings, Radio } from 'lucide-react';
import type { User } from '../types';
import { getAuthToken } from '../lib/api';

interface SidebarProps {
  user: User | null;
  activeTab: 'scheduled' | 'sent' | 'senders';
  onSelectTab: (tab: 'scheduled' | 'sent' | 'senders') => void;
  onOpenCompose: () => void;
  onLogout: () => void;
  scheduledCount: number;
  sentCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeTab,
  onSelectTab,
  onOpenCompose,
  onLogout,
  scheduledCount,
  sentCount,
}) => {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  return (
    <aside className="w-64 border-r border-gray-100 bg-white h-screen flex flex-col p-4 select-none shrink-0">
      {/* Top Logo */}
      <div className="flex items-center gap-2 mb-4 px-2">
        <div className="font-pixel text-2xl font-black tracking-tight text-black flex items-center">
          <span className="bg-black text-white px-1.5 py-0.5 rounded text-lg mr-1 font-mono">ONB</span>
        </div>
      </div>

      {/* User Profile Card */}
      <div className="relative mb-4">
        <div
          onClick={() => setUserDropdownOpen(!userDropdownOpen)}
          className="flex items-center gap-2.5 p-2 rounded-xl bg-[#F4F6F5] hover:bg-gray-100 transition cursor-pointer"
        >
          <img
            src={user?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80'}
            alt={user?.name || 'User'}
            className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-200"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-gray-900 truncate">
                {user?.name || 'Oliver Brown'}
              </p>
              {user?.role === 'admin' && (
                <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold tracking-wider uppercase">
                  Admin
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 truncate">
              {user?.email || 'oliver.brown@domain.io'}
            </p>
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        </div>

        {/* Dropdown Menu */}
        {userDropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-30 py-1 text-xs">
            <button
              onClick={() => {
                setUserDropdownOpen(false);
                onSelectTab('senders');
              }}
              className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700"
            >
              <Settings className="w-3.5 h-3.5 text-gray-400" />
              <span>{user?.role === 'admin' ? 'Admin Senders & Settings' : 'Senders & Slack'}</span>
            </button>
            {user?.role === 'admin' && (
              <a
                href={`${import.meta.env.VITE_API_URL || ''}/admin/queues?token=${encodeURIComponent(getAuthToken() || '')}`}
                target="_blank"
                rel="noreferrer"
                className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 block"
              >
                <Radio className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-medium text-emerald-700">BullMQ Queue Dashboard</span>
              </a>
            )}
            <div className="border-t border-gray-100 my-1"></div>
            <button
              onClick={() => {
                setUserDropdownOpen(false);
                onLogout();
              }}
              className="w-full px-3 py-2 text-left hover:bg-red-50 text-red-600 flex items-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>

      {/* Compose Button (Matching Figma pill outline style) */}
      <button
        onClick={onOpenCompose}
        className="w-full h-10 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340]/5 font-medium text-sm flex items-center justify-center gap-2 transition cursor-pointer mb-6"
      >
        <Plus className="w-4 h-4 text-[#00A340]" />
        <span>Compose</span>
      </button>

      {/* CORE Section */}
      <div className="mb-2 px-2">
        <span className="text-[11px] font-semibold text-gray-400 tracking-wider">
          CORE
        </span>
      </div>

      {/* Nav Items */}
      <nav className="space-y-1">
        {/* Scheduled Item */}
        <button
          onClick={() => onSelectTab('scheduled')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'scheduled'
              ? 'bg-[#E5F4EC] text-gray-900 font-semibold'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Clock className={`w-4 h-4 ${activeTab === 'scheduled' ? 'text-gray-900' : 'text-gray-400'}`} />
            <span>Scheduled</span>
          </div>
          <span className="text-[11px] text-gray-500 tabular-nums">
            {scheduledCount}
          </span>
        </button>

        {/* Sent Item */}
        <button
          onClick={() => onSelectTab('sent')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'sent'
              ? 'bg-[#E5F4EC] text-gray-900 font-semibold'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Send className={`w-4 h-4 ${activeTab === 'sent' ? 'text-gray-900' : 'text-gray-400'}`} />
            <span>Sent</span>
          </div>
          <span className="text-[11px] text-gray-500 tabular-nums">
            {sentCount}
          </span>
        </button>

        {/* Senders & Slack Integration */}
        <button
          onClick={() => onSelectTab('senders')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'senders'
              ? 'bg-[#E5F4EC] text-gray-900 font-semibold'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Settings className={`w-4 h-4 ${activeTab === 'senders' ? 'text-gray-900' : 'text-gray-400'}`} />
            <span>Senders & Slack</span>
          </div>
        </button>
      </nav>

      {/* Footer Info */}
      <div className="mt-auto px-2 pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
        <span>ReachInbox Outbox AI</span>
        {user?.role === 'admin' ? (
          <a
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="text-[#00A340] hover:underline"
          >
            Queues
          </a>
        ) : (
          <span className="text-gray-400">v1.2</span>
        )}
      </div>
    </aside>
  );
};
