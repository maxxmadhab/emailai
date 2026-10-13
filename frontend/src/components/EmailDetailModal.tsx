import React from 'react';
import { ArrowLeft, Star, Archive, Trash2, ChevronDown, ExternalLink } from 'lucide-react';
import type { Email, User } from '../types';

interface EmailDetailModalProps {
  email: Email;
  user: User | null;
  onBack: () => void;
  onDelete?: () => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  email,
  user,
  onBack,
  onDelete,
}) => {
  const formattedDate = new Date(email.sent_at || email.scheduled_at || email.created_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-700 transition cursor-pointer"
            title="Back to inbox"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-bold text-gray-900 truncate">
            {email.subject}
          </h2>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-3 text-gray-400">
          <button className="p-1 hover:text-yellow-400 transition" title="Star">
            <Star className="w-4 h-4" />
          </button>
          <button className="p-1 hover:text-gray-700 transition" title="Archive">
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 hover:text-red-600 transition"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <img
            src={user?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80'}
            alt="Avatar"
            className="w-7 h-7 rounded-full object-cover ml-2 border border-gray-200"
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-8 max-w-4xl">
        {/* Sender Info Row */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#00A340] text-white font-semibold text-sm flex items-center justify-center">
              {(email.recipient || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {(email.recipient || 'user@example.com').split('@')[0]}
                </span>
                <span className="text-xs text-gray-400">
                  &lt;{email.recipient || 'user@example.com'}&gt;
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-gray-500">
                <span>to me</span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400">{formattedDate}</div>
        </div>

        {/* Live Ethereal Preview Banner if available */}
        {email.preview_url && (
          <div className="mb-6 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
            <div className="text-xs text-emerald-800">
              <span className="font-semibold">Live Ethereal SMTP message:</span> View the real rendered email in Ethereal webmail.
            </div>
            <a
              href={email.preview_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#00A340] text-white text-xs font-medium hover:bg-[#008f37] transition"
            >
              <span>Open Preview</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Email Body */}
        <div className="text-sm text-gray-800 leading-relaxed space-y-4 mb-8">
          <p className="whitespace-pre-line">{email.body}</p>

          {/* Highlight Callout Box (matching Figma screenshot style) */}
          <div className="p-4 rounded-lg bg-[#FEF9E7] border-l-4 border-[#F59E0B] text-amber-950 space-y-2 text-xs">
            <div className="font-bold flex items-center gap-2">
              <span>⚡</span>
              <span>Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment</span>
              <span>⚡</span>
            </div>
            <div className="flex items-center gap-2 text-amber-900">
              <span>⚡</span>
              <span>
                To explore securing your private transformation, simply reply right now with <strong className="font-bold">"FLY OUT FIX"</strong>.
              </span>
            </div>
          </div>
        </div>

        {/* Attachments Section (matching Figma cards) */}
        <div className="pt-6 border-t border-gray-100">
          <div className="flex items-center gap-4">
            {/* Attachment 1 */}
            <div className="w-48 border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition">
              <div className="h-24 bg-gradient-to-r from-blue-600 to-sky-400 flex items-center justify-center text-white">
                <span className="text-xs font-semibold">🎾 Tennis Coach Profile</span>
              </div>
              <div className="p-2.5 bg-white">
                <p className="text-xs font-medium text-gray-800 truncate">Tennis_Coach_Profile.png</p>
                <p className="text-[10px] text-gray-400">1.2 MB</p>
              </div>
            </div>

            {/* Attachment 2 */}
            <div className="w-48 border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition">
              <div className="h-24 bg-gradient-to-r from-indigo-500 to-cyan-400 flex items-center justify-center text-white">
                <span className="text-xs font-semibold">🎾 Tennis Coach Profile 2</span>
              </div>
              <div className="p-2.5 bg-white">
                <p className="text-xs font-medium text-gray-800 truncate">Tennis_Coach_Profile2.png</p>
                <p className="text-[10px] text-gray-400">1.2 MB</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
