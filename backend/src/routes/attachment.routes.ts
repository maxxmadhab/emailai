import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { attachmentService } from '../services/attachment.service.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * POST /api/attachments
 * Upload a file attachment (multipart/form-data with field 'file').
 */
router.post(
  '/',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          error: {
            code: 'MISSING_FILE',
            message: 'No file provided in multipart request',
          },
        });
      }

      const userId = req.user!.id;
      const attachment = await attachmentService.uploadAttachment(userId, {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });

      return res.status(201).json({
        data: attachment,
        message: 'Attachment uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/attachments/:id
 * Remove an uploaded attachment before scheduling.
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const attachmentId = req.params.id;
    await attachmentService.deleteAttachment(userId, attachmentId);
    return res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/attachments/:id/download
 * Get short-lived signed URL or download redirect for an attachment.
 */
router.get('/:id/download', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const attachmentId = req.params.id;
    const download = await attachmentService.getDownloadUrl(userId, attachmentId);
    return res.status(200).json({
      data: download,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
