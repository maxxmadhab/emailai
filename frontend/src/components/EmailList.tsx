import React from 'react';
import { Clock, Star, ExternalLink, XCircle } from 'lucide-react';
import type { Email } from '../types';

interface EmailListProps {
  emails: Email[];
  loading: boolean;
  onSelectEmail: (email: Email) => void;
  onCancelEmail?: (emailId: string) => void;
  tab: 'scheduled' | 'sent';
}

function formatScheduledBadge(isoString: string): string {
  try {
    const date = new Date(isoString);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return `${dayName} ${timeStr}`;
  } catch {
    return 'Upcoming';
  }
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  loading,
  onSelectEmail,
  onCancelEmail,
  tab,
}) => {
  const safeEmails = Array.isArray(emails) ? emails : [];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-gray-400 text-xs">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-[#00A340] border-t-transparent rounded-full animate-spin"></div>
          <span>Loading emails...</span>
        </div>
      </div>
    );
  }

  if (safeEmails.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-16 text-center text-gray-400 text-xs">
        <p className="font-medium text-gray-500 mb-1">No {tab} emails found</p>
        <p className="text-gray-400">
          {tab === 'scheduled'
            ? 'Compose an email to schedule outreach campaigns.'
            : 'Sent emails and delivery records will show up here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-gray-100 bg-white">
      {safeEmails.map((email) => {
        const isScheduled = email.status === 'scheduled';
        const rawRecipient = email.recipient || 'recipient@example.com';
        const recipientName = rawRecipient.split('@')[0].replace(/[._]/g, ' ');
        const capitalizedRecipient =
          recipientName.charAt(0).toUpperCase() + recipientName.slice(1);

        const bodySnippet = (email.body || '').replace(/<[^>]*>?/gm, '').substring(0, 100);

        return (
          <div
            key={email.id}
            onClick={() => onSelectEmail(email)}
            className="group flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/70 transition cursor-pointer"
          >
            {/* Left: Recipient & Badge & Excerpt */}
            <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
              {/* "To: Recipient" */}
              <div className="w-36 shrink-0 truncate text-xs font-semibold text-gray-900">
                To: {capitalizedRecipient}
              </div>

              {/* Status Pill Badge */}
              {email.status === 'processing' ? (
                <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-medium">
                  <div className="w-2.5 h-2.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>Sending</span>
                </div>
              ) : email.status === 'scheduled' ? (
                <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FFE8D6] text-[#D96B27] text-[11px] font-medium">
                  <Clock className="w-3 h-3 text-[#D96B27]" />
                  <span>{formatScheduledBadge(email.scheduled_at)}</span>
                </div>
              ) : email.status === 'failed' ? (
                <div className="shrink-0 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-medium">
                  Failed
                </div>
              ) : (
                <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EEEEEE] text-gray-600 text-[11px] font-medium">
                  <span>Sent</span>
                  {email.sent_at && (
                    <span className="text-[10px] text-gray-400">
                      • {new Date(email.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              )}

              {/* Subject & Snippet */}
              <div className="flex-1 min-w-0 truncate text-xs">
                <span className="font-medium text-gray-900">{email.subject || '(No subject)'}</span>
                <span className="text-gray-500 ml-1">
                  - {bodySnippet}...
                </span>
              </div>
            </div>

            {/* Right: Actions & Star */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Ethereal Preview link if available */}
              {email.preview_url && (
                <a
                  href={email.preview_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="View live Ethereal rendered email"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[#00A340] bg-[#E5F4EC] hover:bg-[#00A340] hover:text-white transition font-medium"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Preview</span>
                </a>
              )}

              {/* Cancel Button for Scheduled items */}
              {isScheduled && onCancelEmail && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEmail(email.id);
                  }}
                  title="Cancel scheduled email"
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Star Icon */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className="p-1 text-gray-300 hover:text-yellow-400 transition"
              >
                <Star className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
