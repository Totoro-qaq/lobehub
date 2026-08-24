import { AsyncLocalStorage } from 'node:async_hooks';

import { metrics, SpanStatusCode, trace } from '../../api';

export const SEARCH_ENTITIES = [
  'agent',
  'all',
  'chat_group',
  'document',
  'file',
  'folder',
  'knowledge_base',
  'memory',
  'memory_activity',
  'memory_context',
  'memory_experience',
  'memory_identity',
  'memory_persona',
  'memory_preference',
  'message',
  'page',
  'session',
  'topic',
] as const;

export const SEARCH_OPERATIONS = [
  'home',
  'knowledge_base_documents',
  'legacy_message',
  'legacy_session',
  'legacy_topic',
  'memory_hybrid',
  'memory_list',
  'unified',
] as const;

export const SEARCH_PHASES = ['api', 'database', 'hydration'] as const;
export const SEARCH_PROVIDERS = ['elasticsearch', 'pg_search'] as const;

export type SearchEntity = (typeof SEARCH_ENTITIES)[number];
export type SearchOperation = (typeof SEARCH_OPERATIONS)[number];
export type SearchPhase = (typeof SEARCH_PHASES)[number];
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];
export type SearchResult = 'error' | 'success' | 'zero_result';

export interface SearchMeasurementContext {
  entity: SearchEntity;
  operation: SearchOperation;
  phase: SearchPhase;
  provider: SearchProvider;
}

export interface SearchMeasurementOptions<T> extends SearchMeasurementContext {
  getResultCount?: (value: T) => number | undefined;
}

export interface SearchMeasurement extends SearchMeasurementContext {
  durationMs: number;
  result: SearchResult;
  resultCount?: number;
}

const measurementCollector = new AsyncLocalStorage<SearchMeasurement[]>();

const DURATION_MS_BUCKETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const RESULT_COUNT_BUCKETS = [0, 1, 3, 5, 10, 20, 50, 100, 250, 500, 1000];

const meter = metrics.getMeter('search');
const tracer = trace.getTracer('search');

const searchDuration = meter.createHistogram('search.operation.duration', {
  advice: { explicitBucketBoundaries: DURATION_MS_BUCKETS },
  description:
    'Search operation duration grouped by provider, entity, operation, phase, and result',
  unit: 'ms',
});

const searchOperations = meter.createCounter('search.operations', {
  description: 'Search operations grouped by provider, entity, operation, phase, and result',
});

const searchResults = meter.createHistogram('search.operation.results', {
  advice: { explicitBucketBoundaries: RESULT_COUNT_BUCKETS },
  description: 'Search result count grouped by provider, entity, operation, phase, and result',
});

/** Telemetry failures must never change search behavior. */
const safelyRecord = (recorder: () => void): void => {
  try {
    recorder();
  } catch {
    return;
  }
};

const inferResultCount = (value: unknown): number | undefined =>
  Array.isArray(value) ? value.length : undefined;

const collectMeasurement = (measurement: SearchMeasurement): void => {
  measurementCollector.getStore()?.push(measurement);
};

/**
 * Capture the same phase timings emitted to OTel for a deterministic benchmark run.
 * The collector is request-local so concurrent searches cannot mix their samples.
 */
export const collectSearchMeasurements = async <T>(
  operation: () => Promise<T>,
): Promise<{ measurements: SearchMeasurement[]; value: T }> => {
  const measurements: SearchMeasurement[] = [];
  const value = await measurementCollector.run(measurements, operation);

  return { measurements, value };
};

/**
 * Measure one search phase without exposing query text or tenant/entity identifiers.
 * Database auto-instrumentation attaches its spans below the active database phase.
 */
export const measureSearchOperation = async <T>(
  options: SearchMeasurementOptions<T>,
  operation: () => Promise<T> | T,
): Promise<T> => {
  const baseAttributes = {
    'search.entity': options.entity,
    'search.operation': options.operation,
    'search.phase': options.phase,
    'search.provider': options.provider,
  } as const;

  return tracer.startActiveSpan(`search.${options.operation}.${options.phase}`, async (span) => {
    const startedAt = performance.now();

    try {
      const value = await operation();
      const resultCount = (options.getResultCount ?? inferResultCount)(value);
      const result: SearchResult = resultCount === 0 ? 'zero_result' : 'success';
      const attributes = { ...baseAttributes, 'search.result': result } as const;
      const durationMs = performance.now() - startedAt;

      safelyRecord(() => {
        searchDuration.record(durationMs, attributes);
        searchOperations.add(1, attributes);
        if (resultCount !== undefined) searchResults.record(resultCount, attributes);
      });
      collectMeasurement({
        durationMs,
        entity: options.entity,
        operation: options.operation,
        phase: options.phase,
        provider: options.provider,
        result,
        resultCount,
      });

      span.setAttributes({
        ...attributes,
        ...(resultCount === undefined ? {} : { 'search.result.count': resultCount }),
      });
      span.setStatus({ code: SpanStatusCode.OK });

      return value;
    } catch (error) {
      const attributes = { ...baseAttributes, 'search.result': 'error' } as const;
      const durationMs = performance.now() - startedAt;

      safelyRecord(() => {
        searchDuration.record(durationMs, attributes);
        searchOperations.add(1, attributes);
      });
      collectMeasurement({
        durationMs,
        entity: options.entity,
        operation: options.operation,
        phase: options.phase,
        provider: options.provider,
        result: 'error',
      });

      span.setAttributes(attributes);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error instanceof Error ? error : String(error));
      throw error;
    } finally {
      span.end();
    }
  });
};
