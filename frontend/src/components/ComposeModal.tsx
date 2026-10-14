import React, { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
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
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Strikethrough as StrikethroughIcon,
  X,
  FileText,
  Upload,
} from 'lucide-react';
import type { Sender, Attachment } from '../types';
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
  const safeSenders = Array.isArray(senders) ? senders : [];
  const [selectedSenderId, setSelectedSenderId] = useState<string>(
    safeSenders[0]?.id || ''
  );

  const activeSender = safeSenders.find((s) => s.id === selectedSenderId) || safeSenders[0];
  const effectiveMinDelay = activeSender?.min_delay_seconds ?? 2;
  const effectiveMaxLimit = activeSender?.hourly_limit ?? 50;

  // Recipients state: input & chips
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientChips, setRecipientChips] = useState<string[]>(['recipient@example.com']);
  const [subject, setSubject] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(effectiveMinDelay);
  const [hourlyLimit, setHourlyLimit] = useState(Math.min(10, effectiveMaxLimit));
  const [scheduledAt, setScheduledAt] = useState<string>('');

  // CSV parsing state
  const [csvRecipients, setCsvRecipients] = useState<Array<{ email: string; name?: string }>>([]);
  const [csvStats, setCsvStats] = useState<{ total: number; valid: number; duplicates: number; invalid: number } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [isCsvMode, setIsCsvMode] = useState(false);

  // Attachments state (C4)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Send Later popover state
  const [showSendLater, setShowSendLater] = useState(false);
  const [sendLaterInput, setSendLaterInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // TipTap Editor instance
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder: 'Type Your Reply...',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-[#00A340] underline cursor-pointer',
        },
      }),
    ],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[160px] text-xs text-gray-800 leading-relaxed font-sans prose prose-sm max-w-none',
      },
    },
  });

  // Keep limits within bounds when active sender changes
  useEffect(() => {
    if (activeSender) {
      if (delaySeconds < (activeSender.min_delay_seconds ?? 2)) {
        setDelaySeconds(activeSender.min_delay_seconds ?? 2);
      }
      if (hourlyLimit > (activeSender.hourly_limit ?? 50)) {
        setHourlyLimit(activeSender.hourly_limit ?? 50);
      }
    }
  }, [activeSender]);

  // Handle adding recipient chips via Enter, Comma, or Space
  const handleAddRecipientChip = (text: string) => {
    const raw = text.trim();
    if (!raw) return;
    const parts = raw.split(/[\n,; ]+/).filter(Boolean);
    const newEmails: string[] = [];

    parts.forEach((p) => {
      const clean = p.toLowerCase().trim();
      if (clean.includes('@') && !recipientChips.includes(clean)) {
        newEmails.push(clean);
      }
    });

    if (newEmails.length > 0) {
      setRecipientChips((prev) => [...prev, ...newEmails]);
      setRecipientInput('');
    }
  };

  const handleRemoveChip = (indexToRemove: number) => {
    setRecipientChips((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  // CSV file parse
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
          let duplicates = 0;
          let invalid = 0;

          for (const row of rows) {
            const emailKey = Object.keys(row).find((k) => k.toLowerCase() === 'email');
            const nameKey = Object.keys(row).find(
              (k) => k.toLowerCase() === 'name' || k.toLowerCase() === 'firstname'
            );

            const emailVal = emailKey ? String(row[emailKey] || '').trim().toLowerCase() : '';
            if (!emailVal || !emailVal.includes('@')) {
              invalid++;
              continue;
            }

            if (seen.has(emailVal)) {
              duplicates++;
              continue;
            }

            seen.add(emailVal);
            valid.push({
              email: emailVal,
              name: nameKey ? String(row[nameKey] || '').trim() : undefined,
            });
          }

          if (valid.length === 0) {
            setCsvError('No valid email addresses found in CSV.');
          } else {
            setCsvRecipients(valid);
            setCsvStats({
              total: rows.length,
              valid: valid.length,
              duplicates,
              invalid,
            });
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

  // Attachment upload (C4)
  const handleAttachmentUpload = async (file: File) => {
    setAttachmentError(null);
    if (attachments.length >= 5) {
      setAttachmentError('Maximum of 5 files per email reached.');
      return;
    }

    try {
      setUploadingAttachment(true);
      const uploaded = await api.uploadAttachment(file);
      setAttachments((prev) => [...prev, uploaded]);
    } catch (err: any) {
      setAttachmentError(err?.message || 'Failed to upload attachment');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    try {
      await api.deleteAttachment(attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch {
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    }
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

  // Submit campaign
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    try {
      setLoading(true);
      setError(null);

      // Finalize recipient input if user typed but didn't press enter
      if (recipientInput.trim()) {
        handleAddRecipientChip(recipientInput);
      }

      let recipientsToSend: string[] = [];
      if (isCsvMode && csvRecipients.length > 0) {
        recipientsToSend = csvRecipients.map((r) => r.email);
      } else {
        recipientsToSend = [...recipientChips];
        if (recipientInput.trim() && recipientInput.includes('@')) {
          recipientsToSend.push(recipientInput.trim().toLowerCase());
        }
      }

      if (recipientsToSend.length === 0) {
        throw new Error('Please specify at least one recipient email address.');
      }

      if (delaySeconds < effectiveMinDelay) {
        throw new Error(`Delay between emails must be at least ${effectiveMinDelay}s (enforced by sender policy)`);
      }
      if (hourlyLimit > effectiveMaxLimit) {
        throw new Error(`Hourly limit cannot exceed ${effectiveMaxLimit}/hr (enforced by sender cap)`);
      }

      const rawHtml = editor?.getHTML() || '';
      const textBody = editor?.getText() || 'Hi, just wanted to follow up on our previous conversation.';
      const campaignName = subject ? `Campaign: ${subject}` : `Outreach - ${new Date().toLocaleDateString()}`;
      const finalSenderId = selectedSenderId || safeSenders[0]?.id || undefined;

      await api.createCampaign({
        sender_id: finalSenderId,
        name: campaignName,
        subject: subject || 'Meeting follow-up',
        body: textBody,
        body_html: rawHtml,
        delay_seconds: delaySeconds,
        hourly_limit: hourlyLimit,
        scheduled_start_at: scheduledAt || undefined,
        recipients: recipientsToSend,
        attachmentIds: attachments.map((a) => a.id),
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
        {/* Top Header (Matches Screenshot) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              aria-label="Back"
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-700 transition cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-base font-bold text-gray-900">
              Compose New Email
            </h2>
          </div>

          {/* Right Header Actions: Paperclip, Clock, Send */}
          <div className="relative flex items-center gap-3">
            {/* Attachment input (C4) */}
            <input
              type="file"
              ref={attachmentInputRef}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAttachmentUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              title="Add file attachment"
              aria-label="Add file attachment"
              className={`p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer ${
                attachments.length > 0 ? 'text-[#00A340] bg-[#00A340]/10' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Clock / Send Later button */}
            <button
              type="button"
              onClick={() => setShowSendLater(!showSendLater)}
              title="Schedule email"
              aria-label="Schedule email"
              className={`p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer ${
                scheduledAt ? 'text-[#00A340] bg-[#00A340]/10' : 'text-gray-500'
              }`}
            >
              <Clock className="w-4 h-4" />
            </button>

            {/* Green Outlined Send Button (Matches Screenshot) */}
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading}
              className="h-8 px-6 rounded-full border border-[#00A340] text-[#00A340] hover:bg-[#00A340] hover:text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              {loading ? 'Sending...' : 'Send'}
            </button>

            {/* Send Later Popover */}
            {showSendLater && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-4 z-50 text-xs animate-in fade-in duration-100">
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
                    Tomorrow, 9:00 AM
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

        {attachmentError && (
          <div className="mx-6 mt-3 p-2.5 rounded-lg bg-amber-50 text-amber-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{attachmentError}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-6 space-y-3 overflow-y-auto">
          {/* From Field (Pill dropdown matching screenshot) */}
          <div className="flex items-center gap-4 text-xs">
            <span className="w-12 text-gray-500 shrink-0">From</span>
            <div className="relative">
              <select
                value={selectedSenderId}
                onChange={(e) => setSelectedSenderId(e.target.value)}
                className="h-7 px-3.5 pr-8 rounded-full bg-[#F4F6F5] text-xs font-medium text-gray-800 border-0 focus:outline-none appearance-none cursor-pointer hover:bg-gray-200 transition"
              >
                {safeSenders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))}
                {safeSenders.length === 0 && (
                  <option value="">Default Verified Ethereal Account</option>
                )}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* To Field with Email Chips + Upload CSV Button */}
          <div className="flex items-start gap-4 text-xs">
            <span className="w-12 text-gray-500 shrink-0 pt-1.5">To</span>
            <div className="flex-1">
              {isCsvMode && csvStats ? (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-800 text-xs">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      <strong>{csvStats.valid}</strong> recipients loaded
                      {csvStats.duplicates > 0 && ` (${csvStats.duplicates} dupes deduped)`}
                      {csvStats.invalid > 0 && ` (${csvStats.invalid} invalid skipped)`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCsvMode(false);
                      setCsvRecipients([]);
                      setCsvStats(null);
                    }}
                    className="text-xs text-emerald-700 underline hover:text-emerald-900 cursor-pointer"
                  >
                    Switch to manual
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 border-b border-gray-200 pb-1 focus-within:border-[#00A340] transition">
                  <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[28px]">
                    {recipientChips.map((email, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[11px]"
                      >
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveChip(idx)}
                          className="hover:text-red-500 rounded-full cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={recipientInput}
                      onChange={(e) => setRecipientInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
                          e.preventDefault();
                          handleAddRecipientChip(recipientInput);
                        }
                      }}
                      onBlur={() => {
                        if (recipientInput.trim()) {
                          handleAddRecipientChip(recipientInput);
                        }
                      }}
                      placeholder={recipientChips.length === 0 ? 'recipient@example.com' : 'Add more...'}
                      className="flex-1 min-w-[140px] h-7 text-xs text-gray-800 placeholder-gray-400 focus:outline-none bg-transparent"
                    />
                  </div>

                  {/* Upload CSV button matching screenshot */}
                  <input
                    type="file"
                    ref={csvInputRef}
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvUpload(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => csvInputRef.current?.click()}
                    className="text-[11px] text-gray-500 hover:text-[#00A340] flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 transition cursor-pointer font-medium"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Upload CSV</span>
                  </button>
                </div>
              )}
              {csvError && <p className="text-[11px] text-red-600 mt-1">{csvError}</p>}
            </div>
          </div>

          {/* Subject Field (Underlined input matching screenshot) */}
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

          {/* Delay & Hourly Limit Row (Matches Screenshot Inputs) */}
          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span>Delay between 2 emails</span>
              <input
                type="number"
                min={effectiveMinDelay}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 0)}
                className="w-12 h-6 text-center rounded bg-[#F4F6F5] text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-[#00A340]"
              />
              <span className="text-gray-400">sec</span>
              <span className="text-[10px] text-gray-400">(min {effectiveMinDelay}s)</span>
            </div>

            <div className="flex items-center gap-2">
              <span>Hourly Limit</span>
              <input
                type="number"
                min="1"
                max={effectiveMaxLimit}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value) || 1)}
                className="w-12 h-6 text-center rounded bg-[#F4F6F5] text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-[#00A340]"
              />
              <span className="text-[10px] text-gray-400">(max {effectiveMaxLimit}/hr)</span>
            </div>

            {scheduledAt && (
              <div className="ml-auto flex items-center gap-1 text-[11px] text-[#00A340] bg-[#00A340]/10 px-2.5 py-0.5 rounded-full font-medium">
                <Clock className="w-3 h-3" />
                <span>Scheduled: {new Date(scheduledAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Attached Files Chips Section (C4) */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  <span className="truncate max-w-[180px] font-medium">{att.original_filename}</span>
                  <span className="text-[10px] text-gray-400">
                    ({(att.size_bytes / 1024).toFixed(0)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="p-0.5 hover:bg-gray-200 rounded text-gray-400 hover:text-red-500 transition cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {uploadingAttachment && (
                <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-400 animate-pulse">
                  <Upload className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading...</span>
                </div>
              )}
            </div>
          )}

          {/* Rich Text Editor Body + Bottom Toolbar (TipTap ProseMirror) */}
          <div className="flex-1 flex flex-col pt-2 min-h-[200px]">
            <div className="flex-1 p-3 rounded-t-lg bg-gray-50/50 border border-b-0 border-gray-100 overflow-y-auto">
              <EditorContent editor={editor} />
            </div>

            {/* Bottom Toolbar matching screenshot icons */}
            <div className="flex items-center flex-wrap gap-2 px-3 py-2 bg-white border border-gray-100 rounded-b-lg text-gray-400">
              <button
                type="button"
                onClick={() => editor?.chain().focus().undo().run()}
                disabled={!editor?.can().undo()}
                aria-label="Undo"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition ${
                  !editor?.can().undo() ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => editor?.chain().focus().redo().run()}
                disabled={!editor?.can().redo()}
                aria-label="Redo"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition ${
                  !editor?.can().redo() ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-3.5 bg-gray-200 mx-1"></div>

              {/* Text Heading / Size */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                aria-label="Heading"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('heading') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <Type className="w-3.5 h-3.5" />
              </button>

              {/* Bold */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBold().run()}
                aria-label="Bold"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('bold') ? 'text-[#00A340] bg-[#00A340]/10 font-bold' : ''
                }`}
              >
                <BoldIcon className="w-3.5 h-3.5" />
              </button>

              {/* Italic */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                aria-label="Italic"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('italic') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <ItalicIcon className="w-3.5 h-3.5" />
              </button>

              {/* Underline */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                aria-label="Underline"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('underline') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <UnderlineIcon className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-3.5 bg-gray-200 mx-1"></div>

              {/* Text Alignments */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().setTextAlign('left').run()}
                aria-label="Align Left"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive({ textAlign: 'left' }) ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => editor?.chain().focus().setTextAlign('center').run()}
                aria-label="Align Center"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive({ textAlign: 'center' }) ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => editor?.chain().focus().setTextAlign('right').run()}
                aria-label="Align Right"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive({ textAlign: 'right' }) ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-3.5 bg-gray-200 mx-1"></div>

              {/* Lists */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                aria-label="Bullet List"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('bulletList') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                aria-label="Numbered List"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('orderedList') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </button>

              {/* Quote */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                aria-label="Quote"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('blockquote') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <Quote className="w-3.5 h-3.5" />
              </button>

              {/* Link */}
              <button
                type="button"
                onClick={() => {
                  const currentUrl = editor?.getAttributes('link').href || '';
                  const url = window.prompt('Enter link URL (http:// or https://):', currentUrl);
                  if (url === null) return;
                  if (url === '') {
                    editor?.chain().focus().unsetLink().run();
                  } else {
                    editor?.chain().focus().setLink({ href: url }).run();
                  }
                }}
                aria-label="Insert Link"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('link') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <LinkIcon className="w-3.5 h-3.5" />
              </button>

              {/* Strikethrough */}
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleStrike().run()}
                aria-label="Strikethrough"
                className={`p-1 rounded hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer ${
                  editor?.isActive('strike') ? 'text-[#00A340] bg-[#00A340]/10' : ''
                }`}
              >
                <StrikethroughIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
