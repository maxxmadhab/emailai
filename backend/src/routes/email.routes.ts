import { Router } from 'express';
import { emailController } from '../controllers/email.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All email endpoints require authentication
router.use(requireAuth);

router.get('/counts', (req, res, next) => emailController.getCounts(req, res, next));
router.get('/events', (req, res) => emailController.subscribeEvents(req, res));
router.get('/search', (req, res, next) => emailController.searchEmails(req, res, next));
router.get('/scheduled', (req, res, next) => emailController.getScheduledEmails(req, res, next));
router.get('/sent', (req, res, next) => emailController.getSentEmails(req, res, next));
router.get('/failed', (req, res, next) => emailController.getFailedEmails(req, res, next));
router.post('/:id/cancel', (req, res, next) => emailController.cancelEmail(req, res, next));

export default router;
