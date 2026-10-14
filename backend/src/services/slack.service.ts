import crypto from 'crypto';
import { getPrisma } from '../lib/prisma.js';
import { getEnv } from '../config/env.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { SlackAlertData } from '../queue/slack.queue.js';

export class SlackService {
  private getSigningKey(): string {
    const env = getEnv();
    return env.SLACK_SIGNING_SECRET || env.SUPABASE_JWT_SECRET;
  }

  private usedStates = new Set<string>();

  /**
   * Generates a tamper-proof signed OAuth state string.
   * Format: <userId>.<timestamp>.<hmacSignature>
   */
  generateSignedState(userId: string): string {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = `${userId}:${timestamp}:${nonce}`;
    const hmac = crypto
      .createHmac('sha256', this.getSigningKey())
      .update(payload)
      .digest('hex');

    return `${userId}.${timestamp}.${nonce}.${hmac}`;
  }

  /**
   * Validates state signature and expiration (10 minutes, single-use).
   */
  verifySignedState(state: string): { valid: boolean; userId?: string; error?: string } {
    if (this.usedStates.has(state)) {
      return { valid: false, error: 'OAuth state parameter has already been used (replay detected)' };
    }

    const parts = state.split('.');
    if (parts.length !== 4) {
      return { valid: false, error: 'Malformed OAuth state parameter' };
    }

    const [userId, timestampStr, nonce, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);
    const now = Date.now();

    // Expire state after 10 minutes
    if (now - timestamp > 10 * 60 * 1000 || now < timestamp - 60000) {
      return { valid: false, error: 'OAuth state parameter has expired' };
    }

    const expectedHmac = crypto
      .createHmac('sha256', this.getSigningKey())
      .update(`${userId}:${timestampStr}:${nonce}`)
      .digest('hex');

    if (expectedHmac !== signature) {
      return { valid: false, error: 'OAuth state signature verification failed (tampered state)' };
    }

    // Mark as consumed
    this.usedStates.add(state);
    return { valid: true, userId };
  }

  /**
   * Generates Slack OAuth v2 authorization redirect URL.
   */
  getOAuthUrl(userId: string): string {
    const env = getEnv();
    const state = this.generateSignedState(userId);
    const redirectUri = env.SLACK_REDIRECT_URI || `http://localhost:${env.PORT}/api/slack/callback`;
    const clientId = env.SLACK_CLIENT_ID || 'dummy_client_id';

    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'incoming-webhook,chat:write,chat:write.public',
      redirect_uri: redirectUri,
      state,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  /**
   * Exchanges OAuth authorization code for Slack tokens.
   */
  async exchangeCodeForToken(code: string, state: string) {
    const verification = this.verifySignedState(state);
    if (!verification.valid || !verification.userId) {
      const err: any = new Error(verification.error || 'Invalid OAuth state');
      err.statusCode = 400;
      err.code = 'INVALID_OAUTH_STATE';
      throw err;
    }

    const userId = verification.userId;
    const env = getEnv();
    const redirectUri = env.SLACK_REDIRECT_URI || `http://localhost:${env.PORT}/api/slack/callback`;

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID || '',
        client_secret: env.SLACK_CLIENT_SECRET || '',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data: any = await response.json();
    if (!data.ok) {
      const err: any = new Error(`Slack OAuth exchange failed: ${data.error}`);
      err.statusCode = 400;
      err.code = 'SLACK_OAUTH_FAILED';
      throw err;
    }

    const prisma = getPrisma();
    const accessToken = data.access_token || '';
    const webhookUrl = data.incoming_webhook?.url || null;

    const encryptedAccessToken = encrypt(accessToken);
    const encryptedWebhook = webhookUrl ? encrypt(webhookUrl) : null;

    const connection = await prisma.slackConnection.upsert({
      where: { user_id: userId },
      update: {
        team_id: data.team?.id || 'T000000',
        team_name: data.team?.name || 'Slack Team',
        channel_id: data.incoming_webhook?.channel_id || null,
        channel_name: data.incoming_webhook?.channel || null,
        encrypted_access_token: encryptedAccessToken,
        encrypted_incoming_webhook: encryptedWebhook,
        status: 'active',
      },
      create: {
        user_id: userId,
        team_id: data.team?.id || 'T000000',
        team_name: data.team?.name || 'Slack Team',
        channel_id: data.incoming_webhook?.channel_id || null,
        channel_name: data.incoming_webhook?.channel || null,
        encrypted_access_token: encryptedAccessToken,
        encrypted_incoming_webhook: encryptedWebhook,
        status: 'active',
      },
    });

    logger.info({ userId, teamName: connection.team_name }, 'Slack connection connected successfully');
    return connection;
  }

  /**
   * Sends a manual test message to verify the Slack OAuth integration.
   */
  async sendTestMessage(userId: string) {
    const prisma = getPrisma();
    const connection = await prisma.slackConnection.findUnique({
      where: { user_id: userId },
    });

    if (!connection || connection.status !== 'active') {
      const err: any = new Error('Slack is not connected for this account');
      err.statusCode = 400;
      err.code = 'SLACK_NOT_CONNECTED';
      throw err;
    }

    const now = new Date();
    const oneHourAgo = new Date(Date.now() - 3600000);

    const testAlert: SlackAlertData = {
      userId,
      senderId: 'test-sender-id',
      senderEmail: 'test-outreach@reachinbox.ai',
      hourlyLimit: 50,
      currentCount: 50,
      windowStart: oneHourAgo.toISOString(),
      windowEnd: now.toISOString(),
    };

    return this.sendRateLimitAlert(testAlert);
  }

  /**
   * Retrieves active connection status for user.
   */
  async getConnectionStatus(userId: string) {
    const prisma = getPrisma();
    const connection = await prisma.slackConnection.findUnique({
      where: { user_id: userId },
    });

    if (!connection || connection.status !== 'active') {
      return { connected: false };
    }

    return {
      connected: true,
      teamId: connection.team_id,
      teamName: connection.team_name,
      channelId: connection.channel_id,
      channelName: connection.channel_name,
      status: connection.status,
    };
  }

  /**
   * Disconnects and removes Slack connection.
   */
  async disconnect(userId: string) {
    const prisma = getPrisma();
    await prisma.slackConnection.deleteMany({
      where: { user_id: userId },
    });
    return { disconnected: true };
  }

  /**
   * Sends rate limit alert message to user's Slack webhook or chat channel.
   * Decoupled from email sending pipeline.
   */
  async sendRateLimitAlert(data: SlackAlertData) {
    const prisma = getPrisma();
    const connection = await prisma.slackConnection.findUnique({
      where: { user_id: data.userId },
    });

    if (!connection || connection.status !== 'active') {
      logger.info(
        { userId: data.userId, senderId: data.senderId },
        'Slack not connected for user. Skipping rate limit alert notification.'
      );
      return { skipped: true, reason: 'Slack not connected' };
    }

    const webhookUrl = connection.encrypted_incoming_webhook
      ? decrypt(connection.encrypted_incoming_webhook)
      : null;
    const token = decrypt(connection.encrypted_access_token);

    const messagePayload = {
      text: `🚨 Rate Limit Alert: Sender ${data.senderEmail} reached quota (${data.currentCount}/${data.hourlyLimit})`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Sender Hourly Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender Account:*\n\`${data.senderEmail}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Quota Used:*\n*${data.currentCount}* / ${data.hourlyLimit} emails`,
            },
            {
              type: 'mrkdwn',
              text: `*UTC Window:*\n${data.windowStart} - ${data.windowEnd}`,
            },
            {
              type: 'mrkdwn',
              text: `*Queue Status:*\nRemaining jobs safely rescheduled to next window`,
            },
          ],
        },
      ],
    };

    try {
      if (webhookUrl) {
        // Send via incoming webhook
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messagePayload),
        });

        if (!res.ok) {
          throw new Error(`Slack webhook returned status ${res.status}`);
        }
      } else {
        // Send via chat.postMessage
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channel: connection.channel_id,
            ...messagePayload,
          }),
        });

        const json: any = await res.json();
        if (!json.ok) {
          if (json.error === 'token_revoked' || json.error === 'invalid_auth') {
            await prisma.slackConnection.update({
              where: { user_id: data.userId },
              data: { status: 'revoked' },
            });
          }
          throw new Error(`Slack API error: ${json.error}`);
        }
      }

      logger.info({ userId: data.userId, senderId: data.senderId }, 'Slack rate limit alert posted successfully');
      return { success: true };
    } catch (err: any) {
      logger.error({ err: err.message, userId: data.userId }, 'Failed to deliver Slack alert');
      throw err; // Trigger BullMQ notification retry
    }
  }
}

export const slackService = new SlackService();
