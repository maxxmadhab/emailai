import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Calendar,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Quote,
  Link,
  Strikethrough,
} from 'lucide-react';
import type { Sender } from '../types';
import { api } from '../lib/api';

interface ComposeModalProps {
  senders: Sender[];
  onClose: () => void;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  senders,
  onClose,
  onSuccess,
}) => {
  const [selectedSenderId, setSelectedSenderId] = useState<string>(
    senders[0]?.id || ''
  );
  const [recipientInput, setRecipientInput] = useState('recipient@example.com');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(10);
  const [scheduledAt, setScheduledAt] = useState<string>('');

  // CSV parsing state
  const [csvRecipients, setCsvRecipients] = useState<Array<{ email: string; name?: string }>>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [isCsvMode, setIsCsvMode] = useState(false);

  // Send Later popover state
  const [showSendLater, setShowSendLater] = useState(false);
  const [sendLaterInput, setSendLaterInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCsvUpload = (file: File) => {
    setCsvError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as any[];
          const valid: Array<{ email: string; name?: string }> = [];
          const seen = new Set<string>();

          for (const row of rows) {
            // Find email key case-insensitively
            const emailKey = Object.keys(row).find((k) => k.toLowerCase() === 'email');
            const nameKey = Object.keys(row).find(
              (k) => k.toLowerCase() === 'name' || k.toLowerCase() === 'firstname'
            );

            const emailVal = emailKey ? String(row[emailKey] || '').trim().toLowerCase() : '';
            if (emailVal && emailVal.includes('@') && !seen.has(emailVal)) {
              seen.add(emailVal);
              valid.push({
                email: emailVal,
                name: nameKey ? String(row[nameKey] || '').trim() : undefined,
              });
            }
          }

          if (valid.length === 0) {
            setCsvError('No valid email addresses found in CSV.');
          } else {
            setCsvRecipients(valid);
            setIsCsvMode(true);
          }
        } catch (err: any) {
          setCsvError(`CSV parse error: ${err.message}`);
        }
      },
      error: (err) => {
        setCsvError(`Failed to read CSV: ${err.message}`);
      },
    });
  };

  const handleApplyPreset = (preset: 'tomorrow' | '10am' | '11am' | '3pm') => {
    const target = new Date();
    target.setDate(target.getDate() + 1);

    switch (preset) {
      case 'tomorrow':
        target.setHours(9, 0, 0, 0);
        break;
      case '10am':
        target.setHours(10, 0, 0, 0);
        break;
      case '11am':
        target.setHours(11, 0, 0, 0);
        break;
      case '3pm':
        target.setHours(15, 0, 0, 0);
        break;
    }

    const iso = target.toISOString().slice(0, 16);
    setSendLaterInput(iso);
    setScheduledAt(target.toISOString());
  };

  const handleConfirmSendLater = () => {
    if (sendLaterInput) {
      setScheduledAt(new Date(sendLaterInput).toISOString());
    }
    setShowSendLater(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedSenderId && senders.length > 0) {
      setSelectedSenderId(senders[0].id);
    }

    try {
      setLoading(true);
      setError(null);

      let recipientsToSend: Array<{ email: string; name?: string }> = [];

      if (isCsvMode && csvRecipients.length > 0) {
        recipientsToSend = csvRecipients;
      } else {
        const rawEmails = recipientInput
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        if (rawEmails.length === 0) {
          throw new Error('Please enter at least one recipient email.');
        }

        recipientsToSend = rawEmails.map((email) => ({
          email,
          name: email.split('@')[0],
        }));
      }

      const campaignName = subject ? `Campaign: ${subject}` : `Outreach - ${new Date().toLocaleDateString()}`;

      await api.createCampaign({
        sender_id: selectedSenderId || senders[0]?.id || '',
        name: campaignName,
        subject: subject || 'Meeting follow-up',
        body: body || 'Hi, just wanted to follow up on our previous conversation.',
        delay_seconds: delaySeconds,
        hourly_limit: hourlyLimit,
        scheduled_start_at: scheduledAt || undefined,
        recipients: recipientsToSend,
      });

      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh] border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-700 transition cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-base font-bold text-gray-900">
              Compose New Email
            </h2>
          </div>

          {/* Right Header Actions */}
          <div className="relative flex items-center gap-3">
            {/* Attachment / CSV button */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCsvUpload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload recipient CSV"
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Clock / Send Later button */}
            <button
              type="button"
              onClick={() => setShowSendLater(!showSendLater)}
              title="Schedule email"
              className={`p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer ${
                scheduledAt ? 'text-[#00A340] bg-[#00A340]/10' : 'text-gray-500'
              }`}
            >
              <Clock className="w-4 h-4" />
            </button>

            {/* Send Button */}
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading}
              className="h-8 px-5 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340] hover:text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              {loading ? 'Sending...' : 'Send'}
            </button>

            {/* "Send Later" Popover (matching Figma dropdown) */}
            {showSendLater && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-4 z-50 text-xs">
                <h4 className="font-semibold text-gray-900 mb-3">Send Later</h4>

                <div className="mb-3">
                  <div className="relative">
                    <input
                      type="datetime-local"
                      value={sendLaterInput}
                      onChange={(e) => setSendLaterInput(e.target.value)}
                      className="w-full h-8 px-3 pr-8 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#00A340]"
                    />
                    <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Preset Options */}
                <div className="space-y-1 mb-4 text-gray-600">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('tomorrow')}
                    className="w-full text-left py-1 px-1.5 rounded hover:bg-gray-50 transition"
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('10am')}
                    className="w-full text-left py-1 px-1.5 rounded hover:bg-gray-50 transition"
                  >
                    Tomorrow, 10:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('11am')}
                    className="w-full text-left py-1 px-1.5 rounded hover:bg-gray-50 transition"
                  >
                    Tomorrow, 11:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('3pm')}
                    className="w-full text-left py-1 px-1.5 rounded hover:bg-gray-50 transition"
                  >
                    Tomorrow, 3:00 PM
                  </button>
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowSendLater(false)}
                    className="text-gray-500 hover:text-gray-800 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSendLater}
                    className="px-4 py-1 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340] hover:text-white font-medium transition cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-6 space-y-3 overflow-y-auto">
          {/* From Field */}
          <div className="flex items-center gap-4 text-xs">
            <span className="w-12 text-gray-500 shrink-0">From</span>
            <div className="relative">
              <select
                value={selectedSenderId}
                onChange={(e) => setSelectedSenderId(e.target.value)}
                className="h-7 px-3 pr-7 rounded-full bg-[#F4F6F5] text-xs font-medium text-gray-800 border-0 focus:outline-none appearance-none cursor-pointer"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))}
                {senders.length === 0 && (
                  <option value="">oliver.brown@domain.io (Default)</option>
                )}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* To Field (Supports single email or CSV batch upload) */}
          <div className="flex items-start gap-4 text-xs">
            <span className="w-12 text-gray-500 shrink-0 pt-1.5">To</span>
            <div className="flex-1">
              {isCsvMode ? (
                <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>
                      <strong>{csvRecipients.length}</strong> validated recipients loaded from CSV
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCsvMode(false);
                      setCsvRecipients([]);
                    }}
                    className="text-xs text-emerald-700 underline hover:text-emerald-900"
                  >
                    Switch to manual input
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="recipient@example.com (or comma-separated)"
                    className="flex-1 h-7 border-b border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#00A340] transition"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] text-gray-500 hover:text-[#00A340] flex items-center gap-1 shrink-0 px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>Upload CSV</span>
                  </button>
                </div>
              )}
              {csvError && <p className="text-[11px] text-red-600 mt-1">{csvError}</p>}
            </div>
          </div>

          {/* Subject Field */}
          <div className="flex items-center gap-4 text-xs">
            <span className="w-12 text-gray-500 shrink-0">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 h-7 border-b border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#00A340] transition"
            />
          </div>

          {/* Spacing & Limits (matching Figma) */}
          <div className="flex items-center gap-6 pt-1 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span>Delay between 2 emails</span>
              <input
                type="number"
                min="0"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 0)}
                className="w-12 h-6 text-center rounded bg-[#F4F6F5] text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-[#00A340]"
              />
              <span className="text-gray-400">sec</span>
            </div>

            <div className="flex items-center gap-2">
              <span>Hourly Limit</span>
              <input
                type="number"
                min="1"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value) || 1)}
                className="w-12 h-6 text-center rounded bg-[#F4F6F5] text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-[#00A340]"
              />
            </div>

            {scheduledAt && (
              <div className="ml-auto flex items-center gap-1 text-[11px] text-[#00A340] bg-[#00A340]/10 px-2.5 py-0.5 rounded-full font-medium">
                <Clock className="w-3 h-3" />
                <span>Scheduled: {new Date(scheduledAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Text Area & Rich Toolbar */}
          <div className="flex-1 flex flex-col pt-3 min-h-[220px]">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type Your Reply..."
              className="flex-1 w-full p-3 rounded-lg bg-gray-50/50 border border-gray-100 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#00A340]/30 resize-none font-sans leading-relaxed"
            />

            {/* Toolbar Icons (matching Figma screenshot exactly) */}
            <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-100 text-gray-400 mt-2">
              <button type="button" className="hover:text-gray-700 transition"><Undo2 className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Redo2 className="w-3.5 h-3.5" /></button>
              <div className="w-px h-3.5 bg-gray-200"></div>
              <button type="button" className="hover:text-gray-700 transition"><Type className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Bold className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Italic className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Underline className="w-3.5 h-3.5" /></button>
              <div className="w-px h-3.5 bg-gray-200"></div>
              <button type="button" className="hover:text-gray-700 transition"><AlignLeft className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><AlignCenter className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><AlignRight className="w-3.5 h-3.5" /></button>
              <div className="w-px h-3.5 bg-gray-200"></div>
              <button type="button" className="hover:text-gray-700 transition"><List className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><ListOrdered className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Quote className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Link className="w-3.5 h-3.5" /></button>
              <button type="button" className="hover:text-gray-700 transition"><Strikethrough className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
