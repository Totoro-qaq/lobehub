import type {
  SearchEntity,
  SearchMeasurement,
  SearchProvider,
} from '@lobechat/observability-otel/modules/search';

export const SEARCH_BENCHMARK_SCHEMA_VERSION = 1 as const;

export type BenchmarkCaseGroup =
  'callsite' | 'entity' | 'permission' | 'query_shape' | 'ranking' | 'result_state';

export interface SearchBenchmarkExpectation {
  /** Stable fixture references which must never be visible to this actor. */
  excludes?: string[];
  /** Stable fixture references which must be present in the result set. */
  includes?: string[];
  maxResultCount?: number;
  minResultCount?: number;
}

export interface SearchBenchmarkCase {
  actor: string;
  description: string;
  entity: SearchEntity;
  expectation: SearchBenchmarkExpectation;
  group: BenchmarkCaseGroup;
  id: string;
  /** Cases in one group must use identical query text. */
  queryGroup?: string;
  queryShape?:
    'chinese_continuous' | 'english_words' | 'long' | 'quoted_phrase' | 'special_characters';
  requestKey: string;
}

export interface SearchBenchmarkCaseBinding<TRequest = unknown> {
  /** Never copied into a benchmark artifact. */
  query: string;
  /** Never copied into a benchmark artifact. */
  request: TRequest;
  /** Maps public fixture references to private database result IDs at runtime. */
  resultRefs: Record<string, string>;
}

export interface SearchBenchmarkIndexScale {
  indexBytes: number;
  indexName: string;
  rowEstimate: number;
  table: string;
}

export interface SearchBenchmarkContentScale {
  field: string;
  maxBytes: number;
  p50Bytes: number;
  p95Bytes: number;
  p99Bytes: number;
  rowCount: number;
  sampledRows: number;
  sampleRatePercent: number;
  table: string;
}

export interface SearchBenchmarkTableScale {
  rowEstimate: number;
  table: string;
  tableBytes: number;
}

export interface SearchBenchmarkInspection {
  content: SearchBenchmarkContentScale[];
  indexes: SearchBenchmarkIndexScale[];
  tables: SearchBenchmarkTableScale[];
}

export interface SearchBenchmarkMetadata {
  databaseSchemaVersion: string;
  environment: string;
  fixtureVersion: string;
  revision: string;
  snapshotAt: string;
}

export interface SearchBenchmarkAdapterResult {
  measurements: SearchMeasurement[];
  /** Raw database IDs. The runner pseudonymizes them before producing an artifact. */
  results: SearchBenchmarkResult[];
}

export interface SearchBenchmarkResult {
  id: string;
  relevance?: number;
  score?: number;
  type: SearchEntity;
}

export interface SearchBenchmarkAdapter<TRequest = unknown> {
  execute: (params: {
    benchmarkCase: SearchBenchmarkCase;
    query: string;
    request: TRequest;
  }) => Promise<SearchBenchmarkAdapterResult>;
  inspect: () => Promise<SearchBenchmarkInspection>;
  provider: SearchProvider;
}

export interface SearchDistributionSummary {
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface SearchBenchmarkAssertionResult {
  actualResultCount: number;
  excludedPresent: string[];
  includedMissing: string[];
  measurementErrors: number;
  passed: boolean;
  permissionLeak: boolean;
  stable: boolean;
  zeroResultMeasurements: number;
}

export interface SearchBenchmarkCaseArtifact {
  assertion: SearchBenchmarkAssertionResult;
  entity: SearchEntity;
  group: BenchmarkCaseGroup;
  id: string;
  inputFingerprint: string;
  latencyMs: {
    api: SearchDistributionSummary;
    database: SearchDistributionSummary;
    hydration: SearchDistributionSummary;
  };
  orderedResults: Array<{
    rank: number;
    relevance?: number;
    resultRef: string;
    score?: number;
    type: SearchEntity;
  }>;
  resultCounts: {
    api: SearchDistributionSummary;
    database: SearchDistributionSummary;
    hydration: SearchDistributionSummary;
  };
}

export interface SearchBenchmarkArtifact {
  cases: SearchBenchmarkCaseArtifact[];
  generatedAt: string;
  inspection: SearchBenchmarkInspection;
  metadata: SearchBenchmarkMetadata;
  provider: SearchProvider;
  run: {
    errorRate: number;
    failedCases: number;
    measuredRuns: number;
    permissionLeaks: number;
    sampleSize: number;
    warmupRuns: number;
    zeroResultRate: number;
  };
  schemaVersion: typeof SEARCH_BENCHMARK_SCHEMA_VERSION;
}

export interface SearchBenchmarkRunOptions<TRequest = unknown> {
  adapter: SearchBenchmarkAdapter<TRequest>;
  bindings: Record<string, SearchBenchmarkCaseBinding<TRequest>>;
  cases: SearchBenchmarkCase[];
  /** Shared only across compared runs; never stored in the artifact. */
  hashKey: string;
  measuredRuns: number;
  metadata: SearchBenchmarkMetadata;
  warmupRuns: number;
}

export interface SearchBenchmarkCaseDiff {
  addedResultRefs: string[];
  approvedDifferences: SearchBenchmarkSemanticDifference[];
  assertionChanged: boolean;
  id: string;
  inputChanged: boolean;
  latencyDeltaPercent: {
    apiP95: number | null;
    databaseP95: number | null;
    hydrationP95: number | null;
  };
  orderChanged: boolean;
  regressions: SearchBenchmarkSemanticDifference[];
  removedResultRefs: string[];
  resultCountDeltaPercent: {
    apiP95: number | null;
    databaseP95: number | null;
    hydrationP95: number | null;
  };
  resultDetailsChanged: boolean;
}

export type SearchBenchmarkSemanticDifference = 'details' | 'order' | 'results';

export interface SearchBenchmarkDiffOptions {
  approvedDifferences?: string[];
}

export interface SearchBenchmarkDiff {
  baseline: Pick<SearchBenchmarkArtifact, 'metadata' | 'provider'>;
  candidate: Pick<SearchBenchmarkArtifact, 'metadata' | 'provider'>;
  cases: SearchBenchmarkCaseDiff[];
  gates: {
    baselineFailedCases: number;
    baselinePermissionLeaks: number;
    candidateFailedCases: number;
    candidatePermissionLeaks: number;
    inputMismatches: string[];
    metadataMismatches: string[];
    missingCases: string[];
    passed: boolean;
    runMismatches: string[];
    semanticRegressions: string[];
    unexpectedCases: string[];
    unusedApprovals: string[];
  };
  schemaVersion: typeof SEARCH_BENCHMARK_SCHEMA_VERSION;
}
