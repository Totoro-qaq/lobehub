import type { SearchMeasurement } from '@lobechat/observability-otel/modules/search';
import { describe, expect, it } from 'vitest';

import { diffSearchBenchmarks, renderSearchBenchmarkDiff } from './diff';
import { runSearchBenchmark, summarizeLatency } from './runner';
import type { SearchBenchmarkAdapter, SearchBenchmarkArtifact, SearchBenchmarkCase } from './types';

const HASH_KEY = 'test-only-hash-key-with-at-least-32-characters';

const benchmarkCase: SearchBenchmarkCase = {
  actor: 'owner-user-id',
  description: 'Synthetic result visibility',
  entity: 'agent',
  expectation: { excludes: ['private'], includes: ['primary'], minResultCount: 1 },
  group: 'permission',
  id: 'permission.synthetic',
  requestKey: 'permission.synthetic',
};

const measurements = (): SearchMeasurement[] => [
  {
    durationMs: 10,
    entity: 'agent',
    operation: 'unified',
    phase: 'api',
    provider: 'pg_search',
    result: 'success',
    resultCount: 2,
  },
  {
    durationMs: 6,
    entity: 'agent',
    operation: 'unified',
    phase: 'database',
    provider: 'pg_search',
    result: 'success',
    resultCount: 2,
  },
  {
    durationMs: 2,
    entity: 'agent',
    operation: 'unified',
    phase: 'hydration',
    provider: 'pg_search',
    result: 'success',
    resultCount: 2,
  },
];

const createAdapter = (resultIds: string[]): SearchBenchmarkAdapter<{ surface: string }> => ({
  execute: async () => ({
    measurements: measurements(),
    results: resultIds.map((id, index) => ({ id, relevance: index + 1, type: 'agent' })),
  }),
  inspect: async () => ({
    content: [
      {
        field: 'content',
        maxBytes: 100,
        p50Bytes: 10,
        p95Bytes: 90,
        p99Bytes: 99,
        rowCount: 1,
        table: 'messages',
      },
    ],
    indexes: [{ indexBytes: 1000, indexName: 'agents_bm25_idx', rowEstimate: 10, table: 'agents' }],
    tables: [{ rowEstimate: 10, table: 'agents', tableBytes: 2000 }],
  }),
  provider: 'pg_search',
});

const run = (adapter = createAdapter(['result-primary', 'result-unknown'])) =>
  runSearchBenchmark({
    adapter,
    bindings: {
      'permission.synthetic': {
        query: 'sensitive search text',
        request: { surface: 'command-menu' },
        resultRefs: { primary: 'result-primary', private: 'private-result-id' },
      },
    },
    cases: [benchmarkCase],
    hashKey: HASH_KEY,
    measuredRuns: 2,
    metadata: {
      databaseSchemaVersion: '0093',
      environment: 'snapshot-fork',
      fixtureVersion: 'fixture-v1',
      revision: 'abcdef0',
      snapshotAt: '2026-08-24T00:00:00.000Z',
    },
    warmupRuns: 1,
  });

describe('search benchmark runner', () => {
  it('uses interpolated p50, p95, and p99 latency percentiles', () => {
    expect(summarizeLatency([1, 2, 3, 4])).toEqual({
      max: 4,
      p50: 2.5,
      p95: 3.85,
      p99: 3.97,
      samples: 4,
    });
  });

  it('freezes stable order and strips request text, raw IDs, actors, and the hash key', async () => {
    const artifact = await run();
    const serialized = JSON.stringify(artifact);

    expect(artifact.cases[0]).toEqual(
      expect.objectContaining({
        assertion: expect.objectContaining({ passed: true, permissionLeak: false, stable: true }),
        orderedResults: [
          {
            rank: 1,
            relevance: 1,
            resultRef: 'fixture:primary',
            type: 'agent',
          },
          {
            rank: 2,
            relevance: 2,
            resultRef: expect.stringMatching(/^hmac:[a-f\d]{64}$/),
            type: 'agent',
          },
        ],
      }),
    );
    expect(artifact.cases[0]?.latencyMs).toEqual({
      api: expect.objectContaining({ p50: 10, samples: 2 }),
      database: expect.objectContaining({ p50: 6, samples: 2 }),
      hydration: expect.objectContaining({ p50: 2, samples: 2 }),
    });
    expect(artifact.cases[0]?.resultCounts).toEqual({
      api: expect.objectContaining({ p50: 2, samples: 2 }),
      database: expect.objectContaining({ p50: 2, samples: 2 }),
      hydration: expect.objectContaining({ p50: 2, samples: 2 }),
    });
    expect(artifact.run).toEqual(expect.objectContaining({ errorRate: 0, zeroResultRate: 0 }));
    expect(serialized).not.toContain('sensitive search text');
    expect(serialized).not.toContain('result-primary');
    expect(serialized).not.toContain('result-unknown');
    expect(serialized).not.toContain('private-result-id');
    expect(serialized).not.toContain('owner-user-id');
    expect(serialized).not.toContain(HASH_KEY);
  });

  it('fails closed when a forbidden result becomes visible', async () => {
    const artifact = await run(createAdapter(['private-result-id']));

    expect(artifact.run).toEqual(expect.objectContaining({ failedCases: 1, permissionLeaks: 1 }));
    expect(artifact.cases[0]?.assertion).toEqual(
      expect.objectContaining({
        excludedPresent: ['private'],
        includedMissing: ['primary'],
        passed: false,
        permissionLeak: true,
      }),
    );
  });

  it('rejects a run when a required phase was not instrumented', async () => {
    const adapter = createAdapter(['result-primary']);
    adapter.execute = async () => ({
      measurements: measurements().filter((measurement) => measurement.phase !== 'hydration'),
      results: [{ id: 'result-primary', type: 'agent' }],
    });

    await expect(run(adapter)).rejects.toThrow('did not capture the hydration phase');
  });

  it('rejects a run when a required phase omits candidate counts', async () => {
    const adapter = createAdapter(['result-primary']);
    adapter.execute = async () => ({
      measurements: measurements().map((measurement) =>
        measurement.phase === 'database' ? { ...measurement, resultCount: undefined } : measurement,
      ),
      results: [{ id: 'result-primary', type: 'agent' }],
    });

    await expect(run(adapter)).rejects.toThrow('did not capture the database result count');
  });

  it('fails closed when search instrumentation reports an error', async () => {
    const adapter = createAdapter(['result-primary']);
    adapter.execute = async () => ({
      measurements: measurements().map((measurement) =>
        measurement.phase === 'api' ? { ...measurement, result: 'error' as const } : measurement,
      ),
      results: [{ id: 'result-primary', type: 'agent' }],
    });

    const artifact = await run(adapter);

    expect(artifact.run.failedCases).toBe(1);
    expect(artifact.run.errorRate).toBe(1);
    expect(artifact.cases[0]?.assertion).toEqual(
      expect.objectContaining({ measurementErrors: 2, passed: false }),
    );
  });

  it('fails closed when result relevance changes between measured runs', async () => {
    const adapter = createAdapter(['result-primary']);
    let callCount = 0;
    adapter.execute = async () => ({
      measurements: measurements(),
      results: [{ id: 'result-primary', relevance: (callCount += 1), type: 'agent' }],
    });

    const artifact = await run(adapter);

    expect(artifact.run.failedCases).toBe(1);
    expect(artifact.cases[0]?.assertion).toEqual(
      expect.objectContaining({ passed: false, stable: false }),
    );
  });

  it('rejects input which does not match the frozen query shape', async () => {
    await expect(
      runSearchBenchmark({
        adapter: createAdapter(['result-primary']),
        bindings: {
          'permission.synthetic': {
            query: 'single',
            request: { surface: 'command-menu' },
            resultRefs: { primary: 'result-primary', private: 'private-result-id' },
          },
        },
        cases: [{ ...benchmarkCase, queryShape: 'english_words' }],
        hashKey: HASH_KEY,
        measuredRuns: 1,
        metadata: {
          databaseSchemaVersion: '0093',
          environment: 'snapshot-fork',
          fixtureVersion: 'fixture-v1',
          revision: 'abcdef0',
          snapshotAt: '2026-08-24T00:00:00.000Z',
        },
        warmupRuns: 0,
      }),
    ).rejects.toThrow('query does not match its shape');
  });

  it('rejects permission pairs that do not use identical query text', async () => {
    const pairedCase: SearchBenchmarkCase = {
      ...benchmarkCase,
      id: 'permission.synthetic_pair',
      queryGroup: 'synthetic_visibility',
      requestKey: 'permission.synthetic_pair',
    };

    await expect(
      runSearchBenchmark({
        adapter: createAdapter(['result-primary']),
        bindings: {
          'permission.synthetic': {
            query: 'first query',
            request: { surface: 'command-menu' },
            resultRefs: { primary: 'result-primary', private: 'private-result-id' },
          },
          'permission.synthetic_pair': {
            query: 'different query',
            request: { surface: 'command-menu' },
            resultRefs: { primary: 'result-primary', private: 'private-result-id' },
          },
        },
        cases: [{ ...benchmarkCase, queryGroup: 'synthetic_visibility' }, pairedCase],
        hashKey: HASH_KEY,
        measuredRuns: 1,
        metadata: {
          databaseSchemaVersion: '0093',
          environment: 'snapshot-fork',
          fixtureVersion: 'fixture-v1',
          revision: 'abcdef0',
          snapshotAt: '2026-08-24T00:00:00.000Z',
        },
        warmupRuns: 0,
      }),
    ).rejects.toThrow('query group does not match');
  });
});

describe('search benchmark diff', () => {
  it('reports result/order/latency changes and makes permission leakage a hard gate', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.provider = 'elasticsearch';
    candidate.metadata.revision = 'candidate0';
    candidate.cases[0]!.orderedResults.reverse();
    candidate.cases[0]!.orderedResults[0]!.relevance = 99;
    candidate.cases[0]!.latencyMs.api.p95 = 12;
    candidate.cases[0]!.assertion.passed = false;
    candidate.cases[0]!.assertion.permissionLeak = true;
    candidate.run.failedCases = 1;
    candidate.run.permissionLeaks = 1;

    const diff = diffSearchBenchmarks(baseline, candidate);

    expect(diff.gates).toEqual({
      baselineFailedCases: 0,
      baselinePermissionLeaks: 0,
      candidateFailedCases: 1,
      candidatePermissionLeaks: 1,
      inputMismatches: [],
      metadataMismatches: [],
      missingCases: [],
      passed: false,
      runMismatches: [],
      semanticRegressions: ['permission.synthetic:order', 'permission.synthetic:details'],
      unexpectedCases: [],
      unusedApprovals: [],
    });
    expect(diff.cases[0]).toEqual(
      expect.objectContaining({
        assertionChanged: true,
        latencyDeltaPercent: expect.objectContaining({ apiP95: 20 }),
        orderChanged: true,
        resultDetailsChanged: true,
      }),
    );
    expect(renderSearchBenchmarkDiff(diff)).toContain(
      '| permission.synthetic | regression | changed | changed |',
    );
  });

  it('rejects comparisons which did not execute identical inputs', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.cases[0]!.inputFingerprint = 'hmac:different';

    const diff = diffSearchBenchmarks(baseline, candidate);

    expect(diff.gates.inputMismatches).toEqual(['permission.synthetic']);
    expect(diff.gates.passed).toBe(false);
  });

  it('allows an exact semantic difference only when it is explicitly approved', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.cases[0]!.orderedResults.reverse();

    const unapproved = diffSearchBenchmarks(baseline, candidate);
    const approved = diffSearchBenchmarks(baseline, candidate, {
      approvedDifferences: ['permission.synthetic:order'],
    });

    expect(unapproved.gates.semanticRegressions).toEqual(['permission.synthetic:order']);
    expect(unapproved.gates.passed).toBe(false);
    expect(approved.cases[0]?.approvedDifferences).toEqual(['order']);
    expect(approved.gates.semanticRegressions).toEqual([]);
    expect(approved.gates.passed).toBe(true);
  });

  it('rejects stale difference approvals and reports candidate-count changes', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.cases[0]!.resultCounts.database.p95 = 4;

    const diff = diffSearchBenchmarks(baseline, candidate, {
      approvedDifferences: ['permission.synthetic:order'],
    });

    expect(diff.cases[0]?.resultCountDeltaPercent.databaseP95).toBe(100);
    expect(diff.gates.unusedApprovals).toEqual(['permission.synthetic:order']);
    expect(diff.gates.passed).toBe(false);
  });

  it('rejects unsafe difference approval values', async () => {
    const baseline = await run();

    expect(() =>
      diffSearchBenchmarks(baseline, baseline, {
        approvedDifferences: ['permission.synthetic:order\nprivate text'],
      }),
    ).toThrow('Invalid search benchmark difference approval');
  });

  it('rejects comparisons with provider-specific extra cases', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.cases.push({ ...structuredClone(candidate.cases[0]!), id: 'provider.extra' });

    const diff = diffSearchBenchmarks(baseline, candidate);

    expect(diff.gates.unexpectedCases).toEqual(['provider.extra']);
    expect(diff.gates.passed).toBe(false);
  });

  it('rejects comparisons from a different snapshot or sampling plan', async () => {
    const baseline = await run();
    const candidate = structuredClone(baseline) as SearchBenchmarkArtifact;
    candidate.metadata.snapshotAt = '2026-08-25T00:00:00.000Z';
    candidate.run.measuredRuns = 3;

    const diff = diffSearchBenchmarks(baseline, candidate);

    expect(diff.gates.metadataMismatches).toEqual(['snapshotAt']);
    expect(diff.gates.runMismatches).toEqual(['measuredRuns']);
    expect(diff.gates.passed).toBe(false);
  });
});
