import { Response } from 'express';
import { logger } from '../lib/logger.js';

interface ClientConnection {
  userId: string;
  res: Response;
}

class SseService {
  private clients: ClientConnection[] = [];

  addClient(userId: string, res: Response) {
    const client: ClientConnection = { userId, res };
    this.clients.push(client);

    logger.info({ userId, activeClients: this.clients.length }, 'SSE client connected');

    // Remove client on connection close
    res.on('close', () => {
      this.clients = this.clients.filter((c) => c !== client);
      logger.info({ userId, activeClients: this.clients.length }, 'SSE client disconnected');
    });
  }

  broadcastToUser(userId: string, event: { type: string; payload: any }) {
    const userClients = this.clients.filter((c) => c.userId === userId);
    if (userClients.length === 0) return;

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of userClients) {
      try {
        client.res.write(data);
      } catch (err) {
        logger.warn({ err, userId }, 'Error writing to SSE stream');
      }
    }
  }
}

export const sseService = new SseService();
