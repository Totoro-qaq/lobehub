import { describe, expect, it, vi } from 'vitest';

import type { SearchResult } from '../../packages/database/src/repositories/search';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import {
  CONTENT_INSPECTION_QUERY,
  CONTENT_SAMPLE_RATE_PERCENT,
  CONTENT_SAMPLE_SEED,
  hasLiteralResultMatch,
  inspectContent,
} from './pgSearchAdapter';

describe('pg search benchmark inspection', () => {
  it('uses a repeatable bounded sample and reports its size', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          field_name: 'content',
          max_bytes: '128',
          p50_bytes: '16',
          p95_bytes: '64',
          p99_bytes: '96',
          row_count: '24000000',
          sampled_rows: '120000',
          table_name: 'messages',
        },
      ],
    });

    const result = await inspectContent({ execute } as unknown as LobeChatDatabase);

    expect(CONTENT_INSPECTION_QUERY).toContain('TABLESAMPLE SYSTEM (0.5)');
    expect(CONTENT_INSPECTION_QUERY).toContain('REPEATABLE (13431)');
    expect(CONTENT_SAMPLE_SEED).toBe(13_431);
    expect(result).toEqual([
      {
        field: 'content',
        maxBytes: 128,
        p50Bytes: 16,
        p95Bytes: 64,
        p99Bytes: 96,
        rowCount: 24_000_000,
        sampleRatePercent: CONTENT_SAMPLE_RATE_PERCENT,
        sampledRows: 120_000,
        table: 'messages',
      },
    ]);
  });
});

describe('pg search quality literal relevance', () => {
  const baseResult = {
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    description: null,
    id: 'agent-id',
    relevance: 1,
    title: 'Data Analysis Coding Assistant',
    type: 'agent' as const,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };

  it('matches normalized Chinese text and English stems on the visible result surface', () => {
    const result: SearchResult = {
      ...baseResult,
      avatar: null,
      backgroundColor: null,
      slug: 'github-search-tool',
      tags: [],
    };

    expect(hasLiteralResultMatch(result, ['data', 'analy'])).toBe(true);
    expect(hasLiteralResultMatch(result, ['github'])).toBe(true);
    expect(hasLiteralResultMatch({ ...result, title: '小红书内容搜索' }, ['小红书'])).toBe(true);
  });

  it('does not treat descriptions as literal Top-5 relevance', () => {
    const result: SearchResult = {
      ...baseResult,
      avatar: null,
      backgroundColor: null,
      description: 'Weather automation',
      slug: null,
      tags: [],
    };

    expect(hasLiteralResultMatch(result, ['weather'])).toBe(false);
  });
});
