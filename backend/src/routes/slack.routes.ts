import { Router, Request, Response, NextFunction } from 'express';
import { slackService } from '../services/slack.service.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/slack/auth-url
 * Returns Slack authorization URL for the authenticated user.
 * Avoids auth-header drop when opening OAuth directly in browser.
 */
router.get('/auth-url', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const oauthUrl = slackService.getOAuthUrl(userId);
  return res.status(200).json({
    data: {
      url: oauthUrl,
    },
  });
});

/**
 * GET /api/slack/connect
 * Fallback browser redirect (requires auth token query or bearer).
 */
router.get('/connect', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const oauthUrl = slackService.getOAuthUrl(userId);
  return res.redirect(oauthUrl);
});

/**
 * GET /api/slack/callback
 * Unauthenticated callback route: identifies user purely through signed single-use state.
 * Redirects user back to frontend dashboard with status query param.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const errorParam = req.query.error as string;

    if (errorParam) {
      return res.redirect(`${frontendUrl}/?slack=error&reason=${encodeURIComponent(errorParam)}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/?slack=error&reason=Missing+code+or+state+in+OAuth+callback`);
    }

    const connection = await slackService.exchangeCodeForToken(code, state);

    return res.redirect(
      `${frontendUrl}/?slack=connected&team=${encodeURIComponent(connection.team_name || 'Slack')}`
    );
  } catch (err: any) {
    return res.redirect(
      `${frontendUrl}/?slack=error&reason=${encodeURIComponent(err?.message || 'Slack+authentication+failed')}`
    );
  }
});

/**
 * POST /api/slack/test
 * Sends a manual test rate limit alert to the connected Slack channel.
 */
router.post('/test', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    await slackService.sendTestMessage(userId);
    return res.status(200).json({
      success: true,
      message: 'Test rate limit alert posted to your Slack channel successfully!',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/slack/connection
 * Returns current Slack connection status for authenticated user.
 */
router.get('/connection', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const status = await slackService.getConnectionStatus(userId);
    return res.status(200).json({ data: status });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/slack/connection
 * Disconnects and removes Slack integration for authenticated user.
 */
router.delete('/connection', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    await slackService.disconnect(userId);
    return res.status(200).json({
      success: true,
      message: 'Slack integration disconnected successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
