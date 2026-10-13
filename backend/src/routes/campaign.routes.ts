import { Router } from 'express';
import multer from 'multer';
import { campaignController } from '../controllers/campaign.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireIdempotency } from '../middleware/idempotency.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max file size
  },
});

const router = Router();

// All campaign routes require authentication
router.use(requireAuth);

// Endpoint to preview/parse recipients without scheduling
router.post(
  '/parse-recipients',
  upload.single('file'),
  (req, res, next) => campaignController.parseRecipients(req, res, next)
);

// Campaign creation requires Idempotency-Key header
router.post(
  '/',
  upload.single('file'),
  requireIdempotency(),
  (req, res, next) => campaignController.createCampaign(req, res, next)
);

// Get campaign by ID
router.get('/:id', (req, res, next) => campaignController.getCampaign(req, res, next));

export default router;
