import { createHmac } from 'node:crypto';

import type {
  SearchMeasurement,
  SearchPhase,
  SearchProvider,
} from '@lobechat/observability-otel/modules/search';

import type {
  SearchBenchmarkArtifact,
  SearchBenchmarkAssertionResult,
  SearchBenchmarkCase,
  SearchBenchmarkCaseArtifact,
  SearchBenchmarkCaseBinding,
  SearchBenchmarkResult,
  SearchBenchmarkRunOptions,
  SearchDistributionSummary,
} from './types';
import { SEARCH_BENCHMARK_SCHEMA_VERSION } from './types';

const percentile = (sorted: number[], quantile: number): number => {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
};

const round = (value: number): number => Number(value.toFixed(3));

const hasQuotedPhrase = (query: string): boolean => {
  for (const quote of ['"', "'"]) {
    const openingQuote = query.indexOf(quote);
    if (openingQuote >= 0 && query.indexOf(quote, openingQuote + 1) > openingQuote + 1) return true;
  }

  return false;
};

export const summarizeLatency = (values: number[]): SearchDistributionSummary => {
  const sorted = [...values].sort((left, right) => left - right);

  return {
    max: round(sorted.at(-1) ?? 0),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    samples: sorted.length,
  };
};

const pseudonymize = (value: string, hashKey: string): string =>
  `hmac:${createHmac('sha256', hashKey).update(value).digest('hex')}`;

const canonicalize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalize(nestedValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? String(value);
};

const createResultRefResolver = (
  binding: SearchBenchmarkCaseBinding,
  hashKey: string,
): ((resultId: string) => string) => {
  const idToRef = new Map<string, string>();

  for (const [fixtureRef, resultId] of Object.entries(binding.resultRefs)) {
    if (idToRef.has(resultId)) {
      throw new Error(`Multiple fixture references resolve to the same result in ${fixtureRef}`);
    }
    idToRef.set(resultId, `fixture:${fixtureRef}`);
  }

  return (resultId) => idToRef.get(resultId) ?? pseudonymize(resultId, hashKey);
};

const assertBoundExpectations = (
  benchmarkCase: SearchBenchmarkCase,
  binding: SearchBenchmarkCaseBinding,
): void => {
  const expectedRefs = [
    ...(benchmarkCase.expectation.includes ?? []),
    ...(benchmarkCase.expectation.excludes ?? []),
  ];
  const missingRefs = expectedRefs.filter((fixtureRef) => !binding.resultRefs[fixtureRef]);

  if (missingRefs.length > 0) {
    throw new Error(
      `Case ${benchmarkCase.id} is missing result bindings: ${missingRefs.sort().join(', ')}`,
    );
  }
};

const phaseDuration = (
  measurements: SearchMeasurement[],
  phase: SearchPhase,
  provider: SearchProvider,
): number => {
  const phaseMeasurements = measurements.filter(
    (measurement) => measurement.phase === phase && measurement.provider === provider,
  );

  if (phaseMeasurements.length === 0) {
    throw new Error(`Search instrumentation did not capture the ${phase} phase`);
  }

  if (phase === 'api') {
    return Math.max(...phaseMeasurements.map((measurement) => measurement.durationMs));
  }

  // One typed search normally has one sample per phase. Aggregate work is used for
  // multi-entity searches because their database and hydration branches run in parallel.
  return phaseMeasurements.reduce((total, measurement) => total + measurement.durationMs, 0);
};

const phaseResultCount = (
  measurements: SearchMeasurement[],
  phase: SearchPhase,
  provider: SearchProvider,
): number => {
  const counts = measurements
    .filter((measurement) => measurement.phase === phase && measurement.provider === provider)
    .map(({ resultCount }) => resultCount)
    .filter((resultCount): resultCount is number => resultCount !== undefined);

  if (counts.length === 0) {
    throw new Error(`Search instrumentation did not capture the ${phase} result count`);
  }

  return phase === 'api' ? Math.max(...counts) : counts.reduce((total, count) => total + count, 0);
};

const buildAssertion = (
  benchmarkCase: SearchBenchmarkCase,
  binding: SearchBenchmarkCaseBinding,
  results: SearchBenchmarkResult[],
  measurementErrors: number,
  zeroResultMeasurements: number,
  stable: boolean,
): SearchBenchmarkAssertionResult => {
  const resultIds = results.map(({ id }) => id);
  const resultSet = new Set(resultIds);
  const includedMissing = (benchmarkCase.expectation.includes ?? []).filter(
    (fixtureRef) => !resultSet.has(binding.resultRefs[fixtureRef]!),
  );
  const excludedPresent = (benchmarkCase.expectation.excludes ?? []).filter((fixtureRef) =>
    resultSet.has(binding.resultRefs[fixtureRef]!),
  );
  const aboveMinimum = resultIds.length >= (benchmarkCase.expectation.minResultCount ?? 0);
  const belowMaximum = resultIds.length <= (benchmarkCase.expectation.maxResultCount ?? Infinity);
  const passed =
    stable &&
    measurementErrors === 0 &&
    includedMissing.length === 0 &&
    excludedPresent.length === 0 &&
    aboveMinimum &&
    belowMaximum;

  return {
    actualResultCount: resultIds.length,
    excludedPresent,
    includedMissing,
    measurementErrors,
    passed,
    permissionLeak: excludedPresent.length > 0,
    stable,
    zeroResultMeasurements,
  };
};

const runCase = async <TRequest>(
  benchmarkCase: SearchBenchmarkCase,
  binding: SearchBenchmarkCaseBinding<TRequest>,
  options: SearchBenchmarkRunOptions<TRequest>,
): Promise<SearchBenchmarkCaseArtifact> => {
  assertBoundExpectations(benchmarkCase, binding);
  const resolveResultRef = createResultRefResolver(binding, options.hashKey);

  for (let index = 0; index < options.warmupRuns; index += 1) {
    await options.adapter.execute({
      benchmarkCase,
      query: binding.query,
      request: binding.request,
    });
  }

  const orderedRuns: SearchBenchmarkCaseArtifact['orderedResults'][] = [];
  const rawRuns: SearchBenchmarkResult[][] = [];
  let measurementErrors = 0;
  let zeroResultMeasurements = 0;
  const counts = { api: [] as number[], database: [] as number[], hydration: [] as number[] };
  const durations = { api: [] as number[], database: [] as number[], hydration: [] as number[] };

  for (let index = 0; index < options.measuredRuns; index += 1) {
    const result = await options.adapter.execute({
      benchmarkCase,
      query: binding.query,
      request: binding.request,
    });
    rawRuns.push(result.results);
    measurementErrors += result.measurements.filter(
      (measurement) =>
        measurement.phase === 'api' &&
        measurement.provider === options.adapter.provider &&
        measurement.result === 'error',
    ).length;
    zeroResultMeasurements += result.measurements.filter(
      (measurement) =>
        measurement.phase === 'api' &&
        measurement.provider === options.adapter.provider &&
        measurement.result === 'zero_result',
    ).length;
    orderedRuns.push(
      result.results.map(({ id, literalMatch, relevance, score, type }, index) => {
        if (!id)
          throw new Error(`Search benchmark returned an empty result ID: ${benchmarkCase.id}`);
        if (relevance !== undefined && !Number.isFinite(relevance)) {
          throw new Error(`Search benchmark returned invalid relevance: ${benchmarkCase.id}`);
        }
        if (score !== undefined && !Number.isFinite(score)) {
          throw new Error(`Search benchmark returned invalid score: ${benchmarkCase.id}`);
        }

        return {
          ...(literalMatch === undefined ? {} : { literalMatch }),
          rank: index + 1,
          ...(relevance === undefined ? {} : { relevance: round(relevance) }),
          resultRef: resolveResultRef(id),
          ...(score === undefined ? {} : { score: round(score) }),
          type,
        };
      }),
    );
    durations.api.push(phaseDuration(result.measurements, 'api', options.adapter.provider));
    durations.database.push(
      phaseDuration(result.measurements, 'database', options.adapter.provider),
    );
    durations.hydration.push(
      phaseDuration(result.measurements, 'hydration', options.adapter.provider),
    );
    counts.api.push(phaseResultCount(result.measurements, 'api', options.adapter.provider));
    counts.database.push(
      phaseResultCount(result.measurements, 'database', options.adapter.provider),
    );
    counts.hydration.push(
      phaseResultCount(result.measurements, 'hydration', options.adapter.provider),
    );
  }

  const representativeOrder = orderedRuns[0] ?? [];
  const stable = orderedRuns.every(
    (orderedResultRefs) =>
      JSON.stringify(orderedResultRefs) === JSON.stringify(representativeOrder),
  );
  const quality = benchmarkCase.quality
    ? {
        intent: benchmarkCase.quality.intent,
        literalTop1: representativeOrder[0]?.literalMatch === true,
        literalTopK: representativeOrder
          .slice(0, benchmarkCase.quality.topK)
          .filter(({ literalMatch }) => literalMatch).length,
        locale: benchmarkCase.quality.locale,
        publicQuery: benchmarkCase.quality.publicQuery,
        returnedTopK: Math.min(representativeOrder.length, benchmarkCase.quality.topK),
        topK: benchmarkCase.quality.topK,
      }
    : undefined;

  return {
    assertion: buildAssertion(
      benchmarkCase,
      binding,
      rawRuns[0] ?? [],
      measurementErrors,
      zeroResultMeasurements,
      stable,
    ),
    entity: benchmarkCase.entity,
    group: benchmarkCase.group,
    id: benchmarkCase.id,
    inputFingerprint: pseudonymize(
      canonicalize({
        caseContract: benchmarkCase.quality,
        query: binding.query,
        request: binding.request,
        resultRefs: binding.resultRefs,
      }),
      options.hashKey,
    ),
    latencyMs: {
      api: summarizeLatency(durations.api),
      database: summarizeLatency(durations.database),
      hydration: summarizeLatency(durations.hydration),
    },
    orderedResults: representativeOrder,
    ...(quality ? { quality } : {}),
    resultCounts: {
      api: summarizeLatency(counts.api),
      database: summarizeLatency(counts.database),
      hydration: summarizeLatency(counts.hydration),
    },
  };
};

const validateOptions = <TRequest>(options: SearchBenchmarkRunOptions<TRequest>): void => {
  const safeName = /^[a-z\d][a-z\d._-]{0,127}$/;

  if (options.hashKey.length < 32) {
    throw new Error('Search benchmark hash key must contain at least 32 characters');
  }
  if (!Number.isInteger(options.measuredRuns) || options.measuredRuns < 1) {
    throw new Error('Search benchmark measuredRuns must be a positive integer');
  }
  if (!Number.isInteger(options.warmupRuns) || options.warmupRuns < 0) {
    throw new Error('Search benchmark warmupRuns must be a non-negative integer');
  }
  if (!safeName.test(options.metadata.environment)) {
    throw new Error('Search benchmark environment must be a short, non-sensitive label');
  }
  if (!safeName.test(options.metadata.fixtureVersion)) {
    throw new Error('Search benchmark fixture version contains unsupported characters');
  }
  if (!/^[a-f\d]{7,64}$/.test(options.metadata.revision)) {
    throw new Error('Search benchmark revision must be a Git commit hash');
  }
  if (!Number.isFinite(Date.parse(options.metadata.snapshotAt))) {
    throw new Error('Search benchmark snapshotAt must be an ISO-8601 timestamp');
  }
  if (options.cases.length === 0) {
    throw new Error('Search benchmark must contain at least one case');
  }

  const caseIds = new Set<string>();
  const queryGroups = new Map<string, string>();
  const queryMatchesShape = (query: string, shape: SearchBenchmarkCase['queryShape']): boolean => {
    switch (shape) {
      case 'chinese_continuous': {
        return /\p{Script=Han}/u.test(query) && !/\s/u.test(query);
      }
      case 'english_words': {
        return /^[A-Z]+(?:\s+[A-Z]+)+$/i.test(query);
      }
      case 'long': {
        return query.length >= 128 || query.trim().split(/\s+/).length >= 20;
      }
      case 'quoted_phrase': {
        return hasQuotedPhrase(query);
      }
      case 'special_characters': {
        return /[^\p{L}\p{N}\s]/u.test(query);
      }
      default: {
        return true;
      }
    }
  };

  for (const benchmarkCase of options.cases) {
    if (!safeName.test(benchmarkCase.id) || !safeName.test(benchmarkCase.requestKey)) {
      throw new Error(`Search benchmark case contains an unsafe identifier: ${benchmarkCase.id}`);
    }
    if (caseIds.has(benchmarkCase.id)) {
      throw new Error(`Duplicate search benchmark case: ${benchmarkCase.id}`);
    }
    caseIds.add(benchmarkCase.id);
    if (!options.bindings[benchmarkCase.requestKey]) {
      throw new Error(`Missing search benchmark binding: ${benchmarkCase.requestKey}`);
    }
    const binding = options.bindings[benchmarkCase.requestKey]!;
    if (!binding.query.trim()) {
      throw new Error(`Search benchmark case has an empty query: ${benchmarkCase.id}`);
    }
    if (benchmarkCase.quality) {
      if (binding.query !== benchmarkCase.quality.publicQuery) {
        throw new Error(
          `Quality benchmark query does not match its public corpus: ${benchmarkCase.id}`,
        );
      }
      if (
        !Number.isInteger(benchmarkCase.quality.topK) ||
        benchmarkCase.quality.topK < 1 ||
        benchmarkCase.quality.literalMatchTerms.length === 0 ||
        benchmarkCase.quality.literalMatchTerms.some((term) => !term.trim())
      ) {
        throw new Error(`Quality benchmark case has an invalid contract: ${benchmarkCase.id}`);
      }
    }
    if (!queryMatchesShape(binding.query, benchmarkCase.queryShape)) {
      throw new Error(`Search benchmark query does not match its shape: ${benchmarkCase.id}`);
    }
    if (benchmarkCase.queryGroup) {
      const previousQuery = queryGroups.get(benchmarkCase.queryGroup);
      if (previousQuery !== undefined && previousQuery !== binding.query) {
        throw new Error(`Search benchmark query group does not match: ${benchmarkCase.queryGroup}`);
      }
      queryGroups.set(benchmarkCase.queryGroup, binding.query);
    }
    for (const fixtureRef of [
      ...(benchmarkCase.expectation.includes ?? []),
      ...(benchmarkCase.expectation.excludes ?? []),
    ]) {
      if (!safeName.test(fixtureRef)) {
        throw new Error(
          `Search benchmark case contains an unsafe fixture reference: ${fixtureRef}`,
        );
      }
    }
  }
};

export const runSearchBenchmark = async <TRequest>(
  options: SearchBenchmarkRunOptions<TRequest>,
): Promise<SearchBenchmarkArtifact> => {
  validateOptions(options);

  const inspection = await options.adapter.inspect();
  const cases: SearchBenchmarkCaseArtifact[] = [];

  // Preserve case order and avoid mixing database load between cases.
  for (const benchmarkCase of options.cases) {
    cases.push(await runCase(benchmarkCase, options.bindings[benchmarkCase.requestKey]!, options));
  }

  const measuredOperations = cases.length * options.measuredRuns;
  const errorMeasurements = cases.reduce(
    (total, benchmarkCase) => total + benchmarkCase.assertion.measurementErrors,
    0,
  );
  const zeroResultMeasurements = cases.reduce(
    (total, benchmarkCase) => total + benchmarkCase.assertion.zeroResultMeasurements,
    0,
  );

  return {
    cases,
    generatedAt: new Date().toISOString(),
    inspection,
    metadata: options.metadata,
    provider: options.adapter.provider,
    run: {
      errorRate: round(errorMeasurements / measuredOperations),
      failedCases: cases.filter((benchmarkCase) => !benchmarkCase.assertion.passed).length,
      measuredRuns: options.measuredRuns,
      permissionLeaks: cases.filter((benchmarkCase) => benchmarkCase.assertion.permissionLeak)
        .length,
      sampleSize: cases.reduce(
        (total, benchmarkCase) => total + benchmarkCase.assertion.actualResultCount,
        0,
      ),
      warmupRuns: options.warmupRuns,
      zeroResultRate: round(zeroResultMeasurements / measuredOperations),
    },
    schemaVersion: SEARCH_BENCHMARK_SCHEMA_VERSION,
  };
};
