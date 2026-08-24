// @vitest-environment node
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import type { Pool as NodePool } from 'pg';
import { describe, expect, it } from 'vitest';

import * as schema from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MessageModel } from '../message';
import { TopicModel } from '../topic';

const captureQueries = () => {
  const queries: string[] = [];
  const client = { query: async () => ({ rows: [] }) } as unknown as NodePool;
  const db = nodeDrizzle(client, {
    logger: { logQuery: (query: string) => queries.push(query) },
    schema,
  });

  return { db: db as unknown as LobeChatDatabase, queries };
};

describe('legacy search parent-agent visibility SQL', () => {
  it('filters legacy message BM25 results through visible workspace agents', async () => {
    const { db, queries } = captureQueries();

    await new MessageModel(db, 'viewer', 'workspace').queryByKeyword('visibility');

    const statement = queries.find((query) => query.includes('@@@'));
    expect(statement).toContain('"agents"."visibility"');
  });

  it('filters every legacy topic BM25 leg through visible workspace agents', async () => {
    const { db, queries } = captureQueries();

    await new TopicModel(db, 'viewer', 'workspace').queryByKeyword('visibility');

    const statements = queries.filter((query) => query.includes('@@@'));
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement).toContain('"agents"."visibility"');
  });
});
