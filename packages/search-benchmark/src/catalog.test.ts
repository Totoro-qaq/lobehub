import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PG_SEARCH_CALL_SITES,
  PG_SEARCH_ENTRY_POINTS,
  PG_SEARCH_INDEXES,
  SEARCH_BENCHMARK_CASES,
} from './catalog';

describe('pg_search inventory', () => {
  it('matches all 14 indexes declared by the migration', async () => {
    const migration = await readFile(
      new URL('../../database/migrations/0093_add_bm25_indexes_with_icu.sql', import.meta.url),
      'utf8',
    );
    const migrationIndexes = [
      ...migration.matchAll(/CREATE INDEX ([a-z\d_]+) ON ([a-z\d_]+)/g),
    ].map((match) => ({ indexName: match[1], table: match[2] }));

    expect(migrationIndexes).toHaveLength(14);
    expect(PG_SEARCH_INDEXES.map(({ indexName, table }) => ({ indexName, table }))).toEqual(
      migrationIndexes,
    );
  });

  it('keeps every active index connected to a production call site', () => {
    const activeIndexes = new Set(PG_SEARCH_CALL_SITES.flatMap((callSite) => callSite.indexes));
    const indexesWithoutQueries = PG_SEARCH_INDEXES.filter(
      ({ indexName }) => !activeIndexes.has(indexName),
    ).map(({ indexName }) => indexName);

    expect(indexesWithoutQueries).toEqual(['user_memory_persona_documents_bm25_idx']);
  });

  it('keeps production call-site entries connected to BM25 source files', async () => {
    await Promise.all(
      PG_SEARCH_CALL_SITES.map(async (callSite) => {
        const source = await readFile(
          new URL(`../../../${callSite.file}`, import.meta.url),
          'utf8',
        );
        const [owner, member] = callSite.symbol.replace(' (lexical leg)', '').split('.');

        expect(callSite.scope.trim()).not.toBe('');
        expect(source).toContain(owner);
        if (member) expect(source).toContain(member);
        expect(source).toMatch(/@@@|buildBm25MatchCondition/);
      }),
    );
  });

  it('keeps product entry points connected to their recorded model/repository calls', async () => {
    await Promise.all(
      PG_SEARCH_ENTRY_POINTS.map(async (entryPoint) => {
        const source = await readFile(
          new URL(`../../../${entryPoint.file}`, import.meta.url),
          'utf8',
        );
        const [owner, member] = entryPoint.symbol.split('.');

        expect(source).toContain(owner);
        expect(source).toContain(member);
      }),
    );
  });

  it('covers entity, query-shape, ranking, zero-result, and permission cases', () => {
    const caseIds = SEARCH_BENCHMARK_CASES.map(({ id }) => id);
    const groups = new Set(SEARCH_BENCHMARK_CASES.map(({ group }) => group));

    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(groups).toEqual(
      new Set(['callsite', 'entity', 'permission', 'query_shape', 'ranking', 'result_state']),
    );
    expect(caseIds).toEqual(
      expect.arrayContaining([
        'query.zh_continuous',
        'query.en_stemming',
        'query.special_characters',
        'ranking.title_weight',
        'result.zero',
        'callsite.home',
        'callsite.legacy_session',
        'callsite.legacy_topic',
        'callsite.legacy_message',
        'callsite.memory_activity_direct',
        'callsite.memory_context_list',
        'callsite.memory_preference_list',
        'callsite.memory_hybrid',
        'permission.personal_isolation',
        'permission.public_agent',
        'permission.private_agent',
        'permission.private_agent_topic',
        'permission.private_agent_message',
        'permission.legacy_private_agent_topic',
        'permission.legacy_private_agent_message',
        'permission.public_knowledge_base',
        'permission.private_knowledge_base',
        'permission.agent_scope_allowed',
        'permission.agent_scope_denied',
        'permission.workspace_denied',
        'permission.restricted_file',
        'permission.restricted_folder',
        'permission.restricted_page',
        'permission.revoked_access',
        'permission.deleted_object',
      ]),
    );
  });
});
