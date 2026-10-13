import { Router, Request, Response, NextFunction } from 'express';
import { slackService } from '../services/slack.service.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * Initiates Slack OAuth flow by redirecting to Slack authorization URL.
 * Requires authenticated user.
 */
router.get('/connect', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const oauthUrl = slackService.getOAuthUrl(userId);
  return res.redirect(oauthUrl);
});

/**
 * Handles Slack OAuth callback with authorization code and state.
 * State is validated for cryptographic integrity and timestamp.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code || !state) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CALLBACK_PARAMS',
          message: 'Both code and state are required in the OAuth callback',
        },
      });
    }

    const connection = await slackService.exchangeCodeForToken(code, state);

    // Redirect to frontend dashboard or return JSON success
    return res.status(200).json({
      success: true,
      message: 'Slack successfully connected to ReachInbox!',
      data: {
        teamName: connection.team_name,
        channelName: connection.channel_name,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
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
