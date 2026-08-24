import {
  collectSearchMeasurements,
  type SearchEntity,
} from '@lobechat/observability-otel/modules/search';
import type {
  ActivityListParams,
  ExperienceListParams,
  IdentityListParams,
  SearchMemoryParams,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import { sql } from 'drizzle-orm';

import { getRestrictedKnowledgeBaseIds } from '../../apps/server/src/services/knowledgeBaseAccess';
import { MessageModel } from '../../packages/database/src/models/message';
import { SessionModel } from '../../packages/database/src/models/session';
import { type TopicKeywordScope, TopicModel } from '../../packages/database/src/models/topic';
import { UserMemoryActivityModel } from '../../packages/database/src/models/userMemory/activity';
import { UserMemoryExperienceModel } from '../../packages/database/src/models/userMemory/experience';
import { UserMemoryIdentityModel } from '../../packages/database/src/models/userMemory/identity';
import {
  type QueryUserMemoriesParams,
  UserMemoryModel,
} from '../../packages/database/src/models/userMemory/model';
import { hasActiveWorkspaceMembership } from '../../packages/database/src/models/workspace';
import { HomeRepository } from '../../packages/database/src/repositories/home';
import {
  type SearchOptions,
  SearchRepo,
  type SearchResultType,
} from '../../packages/database/src/repositories/search';
import { getServerDB } from '../../packages/database/src/server';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import { PG_SEARCH_INDEXES } from '../../packages/search-benchmark/src/catalog';
import type {
  SearchBenchmarkAdapter,
  SearchBenchmarkInspection,
  SearchBenchmarkResult,
} from '../../packages/search-benchmark/src/types';

interface PgSearchBenchmarkRequestBase {
  userId: string;
  workspaceId?: string;
}

export type PgSearchBenchmarkRequest = PgSearchBenchmarkRequestBase &
  (
    | {
        kind: 'home';
      }
    | {
        kind: 'legacy_message';
      }
    | {
        kind: 'legacy_session';
      }
    | {
        kind: 'legacy_topic';
        scope?: TopicKeywordScope;
      }
    | {
        kind: 'memory_activity_direct';
        params?: Omit<ActivityListParams, 'q'>;
      }
    | {
        kind: 'memory_experience_direct';
        params?: Omit<ExperienceListParams, 'q'>;
      }
    | {
        kind: 'memory_hybrid';
        params?: Omit<SearchMemoryParams, 'queries'>;
      }
    | {
        kind: 'memory_identity_direct';
        params?: Omit<IdentityListParams, 'q'>;
      }
    | {
        kind: 'memory_list';
        params: Omit<QueryUserMemoriesParams, 'q'>;
      }
    | {
        kind: 'knowledge_base_documents';
        knowledgeBaseIds: string[];
        limit?: number;
      }
    | {
        kind: 'unified';
        options: Omit<SearchOptions, 'excludeKnowledgeBaseIds' | 'query'>;
      }
  );

interface DatabaseRowResult {
  rows?: unknown[];
}

const toBenchmarkResult = (
  type: SearchEntity,
  id: string,
  scores?: Pick<SearchBenchmarkResult, 'relevance' | 'score'>,
): SearchBenchmarkResult => ({ id: `${type}:${id}`, ...scores, type });

const toUnifiedSearchEntity = (type: SearchResultType): SearchEntity => {
  switch (type) {
    case 'agent':
    case 'file':
    case 'folder':
    case 'memory':
    case 'message':
    case 'page':
    case 'topic': {
      return type;
    }
    case 'chatGroup': {
      return 'chat_group';
    }
    case 'knowledgeBase': {
      return 'knowledge_base';
    }
    case 'pageContent': {
      return 'document';
    }
    default: {
      throw new Error(`Unsupported pg_search benchmark result type: ${type}`);
    }
  }
};

const getRows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return ((result as DatabaseRowResult).rows ?? []) as Record<string, unknown>[];
  }

  return [];
};

const toNumber = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const expectedIndexNames = PG_SEARCH_INDEXES.map(({ indexName }) => `'${indexName}'`).join(', ');
const expectedTableNames = PG_SEARCH_INDEXES.map(({ table }) => `'${table}'`).join(', ');

const inspectIndexes = async (db: LobeChatDatabase) => {
  const result = await db.execute(
    sql.raw(`
    SELECT
      idx.relname AS index_name,
      tbl.relname AS table_name,
      GREATEST(tbl.reltuples, 0)::bigint AS row_estimate,
      pg_relation_size(idx.oid)::bigint AS index_bytes
    FROM pg_class idx
    INNER JOIN pg_index relation ON relation.indexrelid = idx.oid
    INNER JOIN pg_class tbl ON tbl.oid = relation.indrelid
    WHERE idx.relname IN (${expectedIndexNames})
    ORDER BY idx.relname
  `),
  );
  const rows = getRows(result);

  if (rows.length !== PG_SEARCH_INDEXES.length) {
    const actual = new Set(rows.map((row) => String(row.index_name)));
    const missing = PG_SEARCH_INDEXES.filter(({ indexName }) => !actual.has(indexName)).map(
      ({ indexName }) => indexName,
    );
    throw new Error(`Snapshot is missing pg_search indexes: ${missing.join(', ')}`);
  }

  return rows.map((row) => ({
    indexBytes: toNumber(row.index_bytes),
    indexName: String(row.index_name),
    rowEstimate: toNumber(row.row_estimate),
    table: String(row.table_name),
  }));
};

const inspectTables = async (db: LobeChatDatabase) => {
  const result = await db.execute(
    sql.raw(`
    SELECT
      relname AS table_name,
      GREATEST(reltuples, 0)::bigint AS row_estimate,
      pg_total_relation_size(oid)::bigint AS table_bytes
    FROM pg_class
    WHERE relkind = 'r' AND relname IN (${expectedTableNames})
    ORDER BY relname
  `),
  );

  return getRows(result).map((row) => ({
    rowEstimate: toNumber(row.row_estimate),
    table: String(row.table_name),
    tableBytes: toNumber(row.table_bytes),
  }));
};

const inspectContent = async (db: LobeChatDatabase) => {
  const result = await db.execute(
    sql.raw(`
    SELECT
      'messages' AS table_name,
      'content' AS field_name,
      COUNT(*)::bigint AS row_count,
      COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p50_bytes,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p95_bytes,
      COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p99_bytes,
      COALESCE(MAX(octet_length(COALESCE(content, ''))), 0)::bigint AS max_bytes
    FROM messages
    UNION ALL
    SELECT
      'documents' AS table_name,
      'content' AS field_name,
      COUNT(*)::bigint AS row_count,
      COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p50_bytes,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p95_bytes,
      COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY octet_length(COALESCE(content, ''))), 0)::bigint AS p99_bytes,
      COALESCE(MAX(octet_length(COALESCE(content, ''))), 0)::bigint AS max_bytes
    FROM documents
    ORDER BY table_name
  `),
  );

  return getRows(result).map((row) => ({
    field: String(row.field_name),
    maxBytes: toNumber(row.max_bytes),
    p50Bytes: toNumber(row.p50_bytes),
    p95Bytes: toNumber(row.p95_bytes),
    p99Bytes: toNumber(row.p99_bytes),
    rowCount: toNumber(row.row_count),
    table: String(row.table_name),
  }));
};

const inspectDatabase = async (db: LobeChatDatabase): Promise<SearchBenchmarkInspection> => {
  const [indexes, tables, content] = await Promise.all([
    inspectIndexes(db),
    inspectTables(db),
    inspectContent(db),
  ]);

  return { content, indexes, tables };
};

const readDatabaseSchemaVersion = async (db: LobeChatDatabase): Promise<string> => {
  const result = await db.execute(
    sql`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
  );
  const latest = getRows(result)[0];

  if (!latest) throw new Error('Snapshot does not contain Drizzle migration metadata');

  return `${String(latest.created_at)}:${String(latest.hash)}`;
};

export interface PgSearchBenchmarkAdapter extends SearchBenchmarkAdapter<PgSearchBenchmarkRequest> {
  getDatabaseSchemaVersion: () => Promise<string>;
}

export const createPgSearchBenchmarkAdapter = async (): Promise<PgSearchBenchmarkAdapter> => {
  const db = await getServerDB();

  return {
    execute: async ({ query, request }) => {
      const workspaceId =
        request.workspaceId &&
        (await hasActiveWorkspaceMembership(db, {
          userId: request.userId,
          workspaceId: request.workspaceId,
        }))
          ? request.workspaceId
          : undefined;
      const repo = new SearchRepo(db, request.userId, workspaceId);
      const { measurements, value } = await collectSearchMeasurements(async () => {
        switch (request.kind) {
          case 'home': {
            const results = await new HomeRepository(db, request.userId, workspaceId).searchAgents(
              query,
            );
            return results.map((result) =>
              toBenchmarkResult(result.type === 'group' ? 'chat_group' : 'agent', result.id),
            );
          }
          case 'knowledge_base_documents': {
            const results = await repo.searchKnowledgeBaseDocuments(
              query,
              request.knowledgeBaseIds,
              request.limit,
            );
            return results.map((result) =>
              toBenchmarkResult('document', result.documentId, {
                relevance: result.relevance,
              }),
            );
          }
          case 'legacy_message': {
            const results = await new MessageModel(db, request.userId, workspaceId).queryByKeyword(
              query,
            );
            return results.map((result) => toBenchmarkResult('message', result.id));
          }
          case 'legacy_session': {
            const results = await new SessionModel(db, request.userId, workspaceId).queryByKeyword(
              query,
            );
            return results.map((result) => toBenchmarkResult('session', result.id));
          }
          case 'legacy_topic': {
            const results = await new TopicModel(db, request.userId, workspaceId).queryByKeyword(
              query,
              request.scope,
            );
            return results.map((result) => toBenchmarkResult('topic', result.id));
          }
          case 'memory_activity_direct': {
            const result = await new UserMemoryActivityModel(db, request.userId).queryList({
              ...request.params,
              q: query,
            });
            return result.items.map((item) => toBenchmarkResult('memory_activity', item.id));
          }
          case 'memory_experience_direct': {
            const result = await new UserMemoryExperienceModel(db, request.userId).queryList({
              ...request.params,
              q: query,
            });
            return result.items.map((item) => toBenchmarkResult('memory_experience', item.id));
          }
          case 'memory_hybrid': {
            const result = await new UserMemoryModel(db, request.userId).searchMemory({
              ...request.params,
              queries: [query],
            });
            return [
              ...result.activities.map((item) =>
                toBenchmarkResult('memory_activity', item.id, {
                  score: result.meta.ranking.activities?.[item.id]?.final,
                }),
              ),
              ...result.contexts.map((item) =>
                toBenchmarkResult('memory_context', item.id, {
                  score: result.meta.ranking.contexts?.[item.id]?.final,
                }),
              ),
              ...result.experiences.map((item) =>
                toBenchmarkResult('memory_experience', item.id, {
                  score: result.meta.ranking.experiences?.[item.id]?.final,
                }),
              ),
              ...result.identities.map((item) =>
                toBenchmarkResult('memory_identity', item.id, {
                  score: result.meta.ranking.identities?.[item.id]?.final,
                }),
              ),
              ...result.preferences.map((item) =>
                toBenchmarkResult('memory_preference', item.id, {
                  score: result.meta.ranking.preferences?.[item.id]?.final,
                }),
              ),
            ];
          }
          case 'memory_identity_direct': {
            const result = await new UserMemoryIdentityModel(db, request.userId).queryList({
              ...request.params,
              q: query,
            });
            return result.items.map((item) => toBenchmarkResult('memory_identity', item.id));
          }
          case 'memory_list': {
            const result = await new UserMemoryModel(db, request.userId).queryMemories({
              ...request.params,
              q: query,
            });
            return result.items.map((item) => {
              switch (item.layer) {
                case LayersEnum.Activity: {
                  return toBenchmarkResult('memory_activity', item.activity.id);
                }
                case LayersEnum.Context: {
                  return toBenchmarkResult('memory_context', item.context.id);
                }
                case LayersEnum.Experience: {
                  return toBenchmarkResult('memory_experience', item.experience.id);
                }
                case LayersEnum.Identity: {
                  return toBenchmarkResult('memory_identity', item.identity.id);
                }
                case LayersEnum.Preference: {
                  return toBenchmarkResult('memory_preference', item.preference.id);
                }
              }
            });
          }
          case 'unified': {
            const needsKnowledgeBaseExclusion =
              !request.options.type ||
              ['file', 'folder', 'knowledgeBase', 'page'].includes(request.options.type);
            const excludeKnowledgeBaseIds = needsKnowledgeBaseExclusion
              ? await getRestrictedKnowledgeBaseIds({
                  serverDB: db,
                  userId: request.userId,
                  workspaceId,
                })
              : [];
            const results = await repo.search({
              ...request.options,
              excludeKnowledgeBaseIds,
              query,
            });
            return results.map((result) => {
              const type = toUnifiedSearchEntity(result.type);
              return toBenchmarkResult(type, result.id, { relevance: result.relevance });
            });
          }
        }
      });

      return { measurements, results: value };
    },
    getDatabaseSchemaVersion: () => readDatabaseSchemaVersion(db),
    inspect: () => inspectDatabase(db),
    provider: 'pg_search',
  };
};
