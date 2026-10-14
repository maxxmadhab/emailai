import crypto from 'crypto';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getPrisma } from '../lib/prisma.js';
import { getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface AttachmentFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export class AttachmentService {
  private supabase: SupabaseClient | null = null;
  private readonly BUCKET_NAME = 'email-attachments';

  // Limits
  readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  readonly MAX_CAMPAIGN_TOTAL_SIZE = 20 * 1024 * 1024; // 20 MB
  readonly MAX_FILES_PER_CAMPAIGN = 5;

  private getSupabase(): SupabaseClient | null {
    if (this.supabase) return this.supabase;
    const env = getEnv();
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    }
    return this.supabase;
  }

  /**
   * Validates file signature / magic bytes against allowed MIME types and formats.
   */
  validateMagicBytes(buffer: Buffer, filename: string): { valid: boolean; detectedMime?: string; error?: string } {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const blockedExtensions = ['exe', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'js', 'jar', 'msi', 'com', 'scr'];

    if (blockedExtensions.includes(ext)) {
      return { valid: false, error: `Executable or script extension .${ext} is strictly prohibited.` };
    }

    const header = buffer.subarray(0, 8);

    // PDF: %PDF- (0x25, 0x50, 0x44, 0x46)
    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
      return { valid: true, detectedMime: 'application/pdf' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      return { valid: true, detectedMime: 'image/png' };
    }

    // JPEG: FF D8 FF
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return { valid: true, detectedMime: 'image/jpeg' };
    }

    // GIF: GIF87a or GIF89a (0x47, 0x49, 0x46, 0x38)
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
      return { valid: true, detectedMime: 'image/gif' };
    }

    // ZIP / DOCX / XLSX / PPTX: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
    if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04) {
      let mime = 'application/zip';
      if (ext === 'docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (ext === 'xlsx') mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (ext === 'pptx') mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      return { valid: true, detectedMime: mime };
    }

    // Plain text / CSV
    if (['txt', 'csv'].includes(ext)) {
      // Check for binary null bytes
      const isBinary = buffer.subarray(0, 1024).includes(0x00);
      if (!isBinary) {
        return { valid: true, detectedMime: ext === 'csv' ? 'text/csv' : 'text/plain' };
      }
    }

    return { valid: false, error: `Unsupported file format or spoofed file signature for .${ext}` };
  }

  /**
   * Sanitizes original filename to prevent directory traversal or script injection.
   */
  sanitizeFilename(name: string): string {
    const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    return base.substring(0, 100);
  }

  /**
   * Uploads file, validates size/magic bytes, and stores attachment record.
   */
  async uploadAttachment(userId: string, file: AttachmentFile) {
    if (file.size > this.MAX_FILE_SIZE) {
      const err: any = new Error(`File exceeds maximum size of 10MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      err.statusCode = 400;
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }

    const validation = this.validateMagicBytes(file.buffer, file.originalname);
    if (!validation.valid) {
      const err: any = new Error(validation.error || 'Invalid file format');
      err.statusCode = 400;
      err.code = 'INVALID_FILE_TYPE';
      throw err;
    }

    const sanitizedName = this.sanitizeFilename(file.originalname);
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const storagePath = `${userId}/${Date.now()}-${sanitizedName}`;

    // Upload to Supabase Storage if configured
    const client = this.getSupabase();
    if (client) {
      try {
        const { error: uploadError } = await client.storage
          .from(this.BUCKET_NAME)
          .upload(storagePath, file.buffer, {
            contentType: validation.detectedMime || file.mimetype,
            upsert: true,
          });

        if (uploadError) {
          logger.warn({ uploadError }, 'Supabase Storage upload warning, continuing with DB record');
        }
      } catch (storageErr) {
        logger.error({ storageErr }, 'Supabase Storage exception');
      }
    }

    const prisma = getPrisma();
    const attachment = await prisma.attachment.create({
      data: {
        user_id: userId,
        original_filename: sanitizedName,
        storage_path: storagePath,
        mime_type: validation.detectedMime || file.mimetype,
        size_bytes: file.size,
        sha256,
      },
    });

    return attachment;
  }

  /**
   * Links attachments to a campaign and validates ownership.
   */
  async linkAttachmentsToCampaign(userId: string, campaignId: string, attachmentIds: string[]) {
    if (!attachmentIds || attachmentIds.length === 0) return [];

    if (attachmentIds.length > this.MAX_FILES_PER_CAMPAIGN) {
      const err: any = new Error(`Cannot attach more than ${this.MAX_FILES_PER_CAMPAIGN} files per campaign`);
      err.statusCode = 400;
      err.code = 'TOO_MANY_ATTACHMENTS';
      throw err;
    }

    const prisma = getPrisma();
    const attachments = await prisma.attachment.findMany({
      where: {
        id: { in: attachmentIds },
        user_id: userId,
      },
    });

    if (attachments.length !== attachmentIds.length) {
      const err: any = new Error('One or more attachments not found or do not belong to you');
      err.statusCode = 403;
      err.code = 'ATTACHMENT_ACCESS_DENIED';
      throw err;
    }

    const totalBytes = attachments.reduce((acc, a) => acc + a.size_bytes, 0);
    if (totalBytes > this.MAX_CAMPAIGN_TOTAL_SIZE) {
      const err: any = new Error(`Total attachments exceed 20MB limit (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
      err.statusCode = 400;
      err.code = 'TOTAL_ATTACHMENT_SIZE_EXCEEDED';
      throw err;
    }

    await prisma.attachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { campaign_id: campaignId },
    });

    return attachments;
  }

  /**
   * Deletes an attachment (only allowed if owned by user).
   */
  async deleteAttachment(userId: string, attachmentId: string) {
    const prisma = getPrisma();
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.user_id !== userId) {
      const err: any = new Error('Attachment not found or permission denied');
      err.statusCode = 404;
      err.code = 'ATTACHMENT_NOT_FOUND';
      throw err;
    }

    // Remove from storage
    const client = this.getSupabase();
    if (client) {
      await client.storage.from(this.BUCKET_NAME).remove([attachment.storage_path]).catch(() => {});
    }

    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    return { deleted: true };
  }

  /**
   * Generates a signed download URL (valid for 15 minutes) or returns stream info.
   */
  async getDownloadUrl(userId: string, attachmentId: string) {
    const prisma = getPrisma();
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.user_id !== userId) {
      const err: any = new Error('Attachment not found or permission denied');
      err.statusCode = 404;
      err.code = 'ATTACHMENT_NOT_FOUND';
      throw err;
    }

    const client = this.getSupabase();
    if (client) {
      const { data, error } = await client.storage
        .from(this.BUCKET_NAME)
        .createSignedUrl(attachment.storage_path, 900); // 15 mins

      if (data?.signedUrl) {
        return {
          url: data.signedUrl,
          filename: attachment.original_filename,
          mimeType: attachment.mime_type,
        };
      }
    }

    return {
      url: `/api/attachments/${attachment.id}/raw`,
      filename: attachment.original_filename,
      mimeType: attachment.mime_type,
    };
  }

  /**
   * Retrieves all attachments for a campaign.
   */
  async getAttachmentsForCampaign(campaignId: string) {
    const prisma = getPrisma();
    return prisma.attachment.findMany({
      where: { campaign_id: campaignId },
      select: {
        id: true,
        original_filename: true,
        size_bytes: true,
        mime_type: true,
        created_at: true,
      },
    });
  }
}

export const attachmentService = new AttachmentService();
