import { Router } from 'express';
import { senderController } from '../controllers/sender.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Senders routes are strictly protected by requireAuth
router.use(requireAuth);

router.post('/', (req, res, next) => senderController.createSender(req, res, next));
router.post('/ethereal', (req, res, next) => senderController.createEtherealSender(req, res, next));
router.get('/', (req, res, next) => senderController.getSenders(req, res, next));

export default router;
