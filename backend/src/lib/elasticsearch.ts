import { Client } from '@elastic/elasticsearch';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

let esClient: Client | null = null;

export function getElasticsearch(): Client {
  if (!esClient) {
    const env = getEnv();
    esClient = new Client({
      node: env.ELASTICSEARCH_NODE,
      maxRetries: 1,
      requestTimeout: 1000,
    });
  }
  return esClient;
}

export async function checkElasticsearchHealth(): Promise<boolean> {
  try {
    const client = getElasticsearch();
    const health = await Promise.race([
      client.cluster.health({}, { requestTimeout: 1000 }),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Elasticsearch timeout')), 1200)
      ),
    ]);
    return health.status === 'green' || health.status === 'yellow';
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Elasticsearch health check failed');
    return false;
  }
}
