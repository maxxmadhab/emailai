import { getElasticsearch } from '../lib/elasticsearch.js';
import { getPrisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export const EMAILS_INDEX = 'emails';

export interface EmailIndexDocument {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  messageId?: string | null;
  previewUrl?: string | null;
  createdAt: string;
}

export class ElasticsearchService {
  /**
   * Initializes the emails index with strict mappings if it doesn't exist yet.
   */
  async initIndex(): Promise<void> {
    try {
      const client = getElasticsearch();
      const exists = await client.indices.exists({ index: EMAILS_INDEX });

      if (!exists) {
        await client.indices.create({
          index: EMAILS_INDEX,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              campaignId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              recipient: {
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' },
                },
              },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              messageId: { type: 'keyword' },
              previewUrl: { type: 'keyword' },
              createdAt: { type: 'date' },
            },
          },
        });
        logger.info(`Elasticsearch index '${EMAILS_INDEX}' created successfully`);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to initialize Elasticsearch index (cluster may be offline)');
    }
  }

  /**
   * Upserts an email document in Elasticsearch.
   */
  async indexEmail(doc: EmailIndexDocument): Promise<boolean> {
    try {
      const client = getElasticsearch();
      await client.index({
        index: EMAILS_INDEX,
        id: doc.id,
        document: doc,
        refresh: true, // Immediate search visibility
      });
      return true;
    } catch (err: any) {
      logger.warn({ err: err.message, emailId: doc.id }, 'Elasticsearch indexing skipped (cluster offline or errored)');
      return false;
    }
  }

  /**
   * Updates status fields of an email in Elasticsearch.
   */
  async updateEmailStatus(
    emailId: string,
    updates: {
      status: string;
      sentAt?: string | null;
      messageId?: string | null;
      previewUrl?: string | null;
      error?: string | null;
    }
  ): Promise<boolean> {
    try {
      const client = getElasticsearch();
      await client.update({
        index: EMAILS_INDEX,
        id: emailId,
        doc: updates,
        refresh: true,
      });
      return true;
    } catch (err: any) {
      logger.warn({ err: err.message, emailId }, 'Elasticsearch update skipped');
      return false;
    }
  }

  /**
   * Performs tenant-isolated full-text search on emails.
   * If Elasticsearch is unavailable, falls back gracefully to PostgreSQL.
   */
  async searchEmails(
    userId: string,
    params: {
      q?: string;
      status?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const from = (page - 1) * limit;

    try {
      const client = getElasticsearch();

      const mustClauses: any[] = [{ term: { userId } }];

      if (params.status) {
        mustClauses.push({ term: { status: params.status } });
      }

      if (params.q && params.q.trim()) {
        mustClauses.push({
          multi_match: {
            query: params.q.trim(),
            fields: ['subject^2', 'recipient^3', 'body'],
            fuzziness: 'AUTO',
          },
        });
      }

      const response = await client.search({
        index: EMAILS_INDEX,
        from,
        size: limit,
        query: {
          bool: {
            must: mustClauses,
          },
        },
        sort: [{ scheduledAt: { order: 'desc' } }],
      });

      const totalHits =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      const items = response.hits.hits.map((h: any) => h._source);

      return {
        source: 'elasticsearch',
        items,
        pagination: {
          page,
          limit,
          total: totalHits,
          totalPages: Math.ceil(totalHits / limit),
        },
      };
    } catch (esErr: any) {
      logger.warn({ err: esErr.message }, 'Elasticsearch search failed; falling back to PostgreSQL hydration');
      return this.searchPostgresFallback(userId, params);
    }
  }

  /**
   * Resilient fallback to PostgreSQL full-text/ilike search when Elasticsearch is down.
   */
  private async searchPostgresFallback(
    userId: string,
    params: { q?: string; status?: string; page?: number; limit?: number }
  ) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const prisma = getPrisma();
    const where: any = { user_id: userId };

    if (params.status) {
      where.status = params.status;
    }

    if (params.q && params.q.trim()) {
      const query = params.q.trim();
      where.OR = [
        { subject: { contains: query, mode: 'insensitive' } },
        { recipient: { contains: query, mode: 'insensitive' } },
        { body: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduled_at: 'desc' },
      }),
    ]);

    return {
      source: 'postgres_fallback',
      items: items.map((e) => ({
        id: e.id,
        userId: e.user_id,
        campaignId: e.campaign_id,
        senderId: e.sender_id,
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
        status: e.status,
        scheduledAt: e.scheduled_at ? new Date(e.scheduled_at).toISOString() : new Date().toISOString(),
        sentAt: e.sent_at ? new Date(e.sent_at).toISOString() : null,
        messageId: e.message_id,
        previewUrl: e.preview_url,
        createdAt: e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const elasticsearchService = new ElasticsearchService();
