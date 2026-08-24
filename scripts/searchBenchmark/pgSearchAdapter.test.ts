import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../packages/database/src/type';
import {
  CONTENT_INSPECTION_QUERY,
  CONTENT_SAMPLE_RATE_PERCENT,
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
