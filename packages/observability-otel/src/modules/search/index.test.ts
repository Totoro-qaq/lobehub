import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectSearchMeasurements, measureSearchOperation } from '.';

const { instruments, span } = vi.hoisted(() => ({
  instruments: new Map<
    string,
    {
      add: ReturnType<typeof vi.fn>;
      record: ReturnType<typeof vi.fn>;
    }
  >(),
  span: {
    end: vi.fn(),
    recordException: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock('../../api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: (name: string) => {
        const instrument = { add: vi.fn(), record: vi.fn() };
        instruments.set(name, instrument);
        return instrument;
      },
      createHistogram: (name: string) => {
        const instrument = { add: vi.fn(), record: vi.fn() };
        instruments.set(name, instrument);
        return instrument;
      },
    }),
  },
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: {
    getTracer: () => ({
      startActiveSpan: async (_name: string, callback: (activeSpan: typeof span) => unknown) =>
        callback(span),
    }),
  },
}));

describe('search telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records only low-cardinality search attributes and a result count', async () => {
    await measureSearchOperation(
      {
        entity: 'agent',
        operation: 'unified',
        phase: 'database',
        provider: 'pg_search',
      },
      async () => [{ id: 'private-result-id' }],
    );

    const attributes = instruments.get('search.operations')!.add.mock.calls.at(-1)![1];

    expect(attributes).toEqual({
      'search.entity': 'agent',
      'search.operation': 'unified',
      'search.phase': 'database',
      'search.provider': 'pg_search',
      'search.result': 'success',
    });
    expect(attributes).not.toHaveProperty('query');
    expect(attributes).not.toHaveProperty('userId');
    expect(attributes).not.toHaveProperty('workspaceId');
    expect(instruments.get('search.operation.results')!.record).toHaveBeenCalledWith(1, attributes);
  });

  it('classifies an empty result without changing the returned value', async () => {
    const value = await measureSearchOperation(
      {
        entity: 'message',
        operation: 'legacy_message',
        phase: 'api',
        provider: 'pg_search',
      },
      async () => [],
    );

    expect(value).toEqual([]);
    expect(instruments.get('search.operations')!.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ 'search.result': 'zero_result' }),
    );
  });

  it('records failures and rethrows the original error', async () => {
    const error = new Error('database unavailable');

    await expect(
      measureSearchOperation(
        {
          entity: 'topic',
          operation: 'legacy_topic',
          phase: 'database',
          provider: 'pg_search',
        },
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(span.recordException).toHaveBeenCalledWith(error);
    expect(instruments.get('search.operations')!.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ 'search.result': 'error' }),
    );
  });

  it('collects request-local benchmark timings from the same measurement path', async () => {
    const { measurements, value } = await collectSearchMeasurements(async () =>
      measureSearchOperation(
        {
          entity: 'file',
          operation: 'unified',
          phase: 'hydration',
          provider: 'pg_search',
        },
        async () => [{ id: 'private-result-id' }],
      ),
    );

    expect(value).toEqual([{ id: 'private-result-id' }]);
    expect(measurements).toEqual([
      expect.objectContaining({
        durationMs: expect.any(Number),
        entity: 'file',
        operation: 'unified',
        phase: 'hydration',
        provider: 'pg_search',
        result: 'success',
        resultCount: 1,
      }),
    ]);
  });

  it('keeps concurrent benchmark collectors isolated', async () => {
    const [first, second] = await Promise.all([
      collectSearchMeasurements(async () =>
        measureSearchOperation(
          {
            entity: 'agent',
            operation: 'unified',
            phase: 'database',
            provider: 'pg_search',
          },
          async () => [],
        ),
      ),
      collectSearchMeasurements(async () =>
        measureSearchOperation(
          {
            entity: 'message',
            operation: 'legacy_message',
            phase: 'database',
            provider: 'pg_search',
          },
          async () => [],
        ),
      ),
    ]);

    expect(first.measurements).toHaveLength(1);
    expect(first.measurements[0]?.entity).toBe('agent');
    expect(second.measurements).toHaveLength(1);
    expect(second.measurements[0]?.entity).toBe('message');
  });
});
