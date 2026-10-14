import { Router } from 'express';
import { senderController } from '../controllers/sender.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Senders routes are strictly protected by requireAuth
router.use(requireAuth);

// Admin-only operations: create, ethereal generator, update, delete
router.post('/', requireAdmin, (req, res, next) => senderController.createSender(req, res, next));
router.post('/ethereal', requireAdmin, (req, res, next) => senderController.createEtherealSender(req, res, next));
router.put('/:id', requireAdmin, (req, res, next) => senderController.updateSender(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => senderController.deleteSender(req, res, next));

// User & Admin accessible (role-differentiated response shape)
router.get('/', (req, res, next) => senderController.getSenders(req, res, next));
router.get('/:id', (req, res, next) => senderController.getSenderById(req, res, next));

export default router;
