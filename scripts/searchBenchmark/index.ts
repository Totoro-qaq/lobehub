import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LayersEnum } from '@lobechat/types';

import {
  createSearchBenchmarkReport,
  diffSearchBenchmarks,
  renderSearchBenchmarkDiff,
  renderSearchBenchmarkReport,
  runSearchBenchmark,
} from '../../packages/search-benchmark/src';
import {
  SEARCH_BENCHMARK_CASES,
  SEARCH_BENCHMARK_FIXTURE_VERSION,
  SEARCH_QUALITY_CASES,
  SEARCH_QUALITY_FIXTURE_VERSION,
} from '../../packages/search-benchmark/src/catalog';
import type {
  SearchBenchmarkArtifact,
  SearchBenchmarkCaseBinding,
} from '../../packages/search-benchmark/src/types';
import type { PgSearchBenchmarkRequest } from './pgSearchAdapter';
import { getCleanRevision } from './revision';

interface SearchBenchmarkConfig {
  bindings: Record<string, SearchBenchmarkCaseBinding<PgSearchBenchmarkRequest>>;
  environment: string;
  environmentKind: 'snapshot_fork';
  measuredRuns?: number;
  qualityMeasuredRuns?: number;
  qualityWarmupRuns?: number;
  snapshotAt: string;
  warmupRuns?: number;
}

const getArgument = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const requireArgument = (name: string): string => {
  const value = getArgument(name);
  if (!value) throw new Error(`Missing required --${name}=... argument`);
  return value;
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(path.resolve(filePath), 'utf8')) as T;

/** `writeFile` does not apply its mode to an existing file, so always tighten it after writing. */
const writePrivateFile = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { mode: 0o600 });
  await chmod(filePath, 0o600);
};

const resolveEnvironmentReferences = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const match = /^\$\{ENV:([A-Z][A-Z\d_]*)\}$/.exec(value);
    if (!match) return value;

    const resolved = process.env[match[1]!];
    if (!resolved)
      throw new Error(`Required benchmark environment variable is missing: ${match[1]}`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map(resolveEnvironmentReferences);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        resolveEnvironmentReferences(nestedValue),
      ]),
    );
  }

  return value;
};

const currentRevision = async (): Promise<string> => {
  return getCleanRevision(fileURLToPath(new URL('../..', import.meta.url)));
};

type BenchmarkMode = 'contract' | 'quality';

const runBaseline = async (mode: BenchmarkMode) => {
  const configPath = requireArgument('config');
  const outputPath = path.resolve(requireArgument('output'));
  const confirmedEnvironment = requireArgument('confirmed-environment');
  const rawConfig = await readJson<unknown>(configPath);
  const config = resolveEnvironmentReferences(rawConfig) as SearchBenchmarkConfig;

  if (config.environmentKind !== 'snapshot_fork') {
    throw new Error('Deterministic search benchmarks may run only against a snapshot fork');
  }
  if (config.environment !== confirmedEnvironment) {
    throw new Error(
      `Environment confirmation mismatch: expected ${config.environment}, received ${confirmedEnvironment}`,
    );
  }
  if (!Number.isFinite(Date.parse(config.snapshotAt))) {
    throw new Error('Snapshot timestamp must be a valid ISO-8601 value');
  }

  const hashKey = process.env.SEARCH_BENCHMARK_HASH_KEY;
  if (!hashKey) throw new Error('SEARCH_BENCHMARK_HASH_KEY is required');

  const { createPgSearchBenchmarkAdapter } = await import('./pgSearchAdapter');
  const adapter = await createPgSearchBenchmarkAdapter();
  const [databaseSchemaVersion, revision] = await Promise.all([
    adapter.getDatabaseSchemaVersion(),
    currentRevision(),
  ]);
  const qualityBindings = mode === 'quality' ? createQualityBindings(config.bindings) : undefined;
  const artifact = await runSearchBenchmark({
    adapter,
    bindings: qualityBindings ?? config.bindings,
    cases: mode === 'quality' ? SEARCH_QUALITY_CASES : SEARCH_BENCHMARK_CASES,
    hashKey,
    measuredRuns:
      mode === 'quality' ? (config.qualityMeasuredRuns ?? 3) : (config.measuredRuns ?? 10),
    metadata: {
      databaseSchemaVersion,
      environment: config.environment,
      fixtureVersion:
        mode === 'quality' ? SEARCH_QUALITY_FIXTURE_VERSION : SEARCH_BENCHMARK_FIXTURE_VERSION,
      revision,
      snapshotAt: config.snapshotAt,
    },
    warmupRuns: mode === 'quality' ? (config.qualityWarmupRuns ?? 0) : (config.warmupRuns ?? 2),
  });

  await writePrivateFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);

  if (artifact.run.failedCases > 0 || artifact.run.permissionLeaks > 0) {
    throw new Error(
      `Benchmark failed: ${artifact.run.failedCases} cases failed, ${artifact.run.permissionLeaks} permission leaks`,
    );
  }
};

const runDiff = async () => {
  const baseline = await readJson<SearchBenchmarkArtifact>(requireArgument('baseline'));
  const candidate = await readJson<SearchBenchmarkArtifact>(requireArgument('candidate'));
  const outputPath = path.resolve(requireArgument('output'));
  const approvalPath = getArgument('approved-differences');
  const approvedDifferences = approvalPath ? await readJson<string[]>(approvalPath) : [];
  const diff = diffSearchBenchmarks(baseline, candidate, { approvedDifferences });

  await writePrivateFile(outputPath, renderSearchBenchmarkDiff(diff));

  if (!diff.gates.passed) throw new Error('Search benchmark comparison failed its hard gates');
};

const runReport = async () => {
  const artifact = await readJson<SearchBenchmarkArtifact>(requireArgument('artifact'));
  const outputPath = path.resolve(requireArgument('output'));
  const report = createSearchBenchmarkReport(artifact);

  await writePrivateFile(outputPath, renderSearchBenchmarkReport(report));
};

const toEnvironmentName = (value: string): string =>
  value.toUpperCase().replaceAll(/[^A-Z\d]+/g, '_');

const toSearchResultType = (entity: (typeof SEARCH_BENCHMARK_CASES)[number]['entity']) => {
  switch (entity) {
    case 'all':
    case 'document': {
      return undefined;
    }
    case 'chat_group': {
      return 'chatGroup';
    }
    case 'knowledge_base': {
      return 'knowledgeBase';
    }
    case 'agent':
    case 'file':
    case 'folder':
    case 'memory':
    case 'message':
    case 'page':
    case 'topic': {
      return entity;
    }
    default: {
      return undefined;
    }
  }
};

const createQualityBindings = (
  bindings: SearchBenchmarkConfig['bindings'],
): SearchBenchmarkConfig['bindings'] => {
  const ownerBinding = bindings['entity.agent'];
  if (!ownerBinding || ownerBinding.request.kind !== 'unified') {
    throw new Error('Quality benchmark requires the entity.agent owner scope binding');
  }

  const { userId, workspaceId } = ownerBinding.request;

  return Object.fromEntries(
    SEARCH_QUALITY_CASES.map((benchmarkCase) => {
      const type = toSearchResultType(benchmarkCase.entity);
      if (!benchmarkCase.quality || !type) {
        throw new Error(`Invalid quality benchmark case: ${benchmarkCase.id}`);
      }

      return [
        benchmarkCase.requestKey,
        {
          query: benchmarkCase.quality.publicQuery,
          request: {
            kind: 'unified' as const,
            options: { limitPerType: benchmarkCase.quality.topK, type },
            userId,
            workspaceId,
          },
          resultRefs: {},
        },
      ];
    }),
  );
};

const createTemplate = (): SearchBenchmarkConfig => ({
  bindings: Object.fromEntries(
    SEARCH_BENCHMARK_CASES.map((benchmarkCase) => {
      const caseEnvironmentName = toEnvironmentName(benchmarkCase.id);
      const actorEnvironmentName = toEnvironmentName(benchmarkCase.actor);
      const resultRefs = Object.fromEntries(
        [
          ...(benchmarkCase.expectation.includes ?? []),
          ...(benchmarkCase.expectation.excludes ?? []),
        ].map((resultRef) => [
          resultRef,
          `\${ENV:SEARCH_BENCHMARK_RESULT_${caseEnvironmentName}_${toEnvironmentName(resultRef)}}`,
        ]),
      );
      const userId = `\${ENV:SEARCH_BENCHMARK_${actorEnvironmentName}_USER_ID}`;
      const queryEnvironmentName = benchmarkCase.queryGroup
        ? toEnvironmentName(benchmarkCase.queryGroup)
        : caseEnvironmentName;
      const query = `\${ENV:SEARCH_BENCHMARK_QUERY_${queryEnvironmentName}}`;
      const workspaceId = ['former_member', 'workspace_member'].includes(benchmarkCase.actor)
        ? `\${ENV:SEARCH_BENCHMARK_WORKSPACE_ID}`
        : undefined;
      const request: PgSearchBenchmarkRequest = (() => {
        switch (benchmarkCase.id) {
          case 'callsite.home': {
            return { kind: 'home', userId, workspaceId };
          }
          case 'callsite.legacy_message': {
            return { kind: 'legacy_message', userId, workspaceId };
          }
          case 'callsite.legacy_session': {
            return { kind: 'legacy_session', userId, workspaceId };
          }
          case 'callsite.legacy_topic': {
            return { kind: 'legacy_topic', userId, workspaceId };
          }
          case 'permission.legacy_private_agent_message': {
            return { kind: 'legacy_message', userId, workspaceId };
          }
          case 'permission.legacy_private_agent_topic': {
            return { kind: 'legacy_topic', userId, workspaceId };
          }
          case 'callsite.memory_activity_direct': {
            return { kind: 'memory_activity_direct', userId };
          }
          case 'callsite.memory_experience_direct': {
            return { kind: 'memory_experience_direct', userId };
          }
          case 'callsite.memory_identity_direct': {
            return { kind: 'memory_identity_direct', userId };
          }
          case 'callsite.memory_activity_list': {
            return { kind: 'memory_list', params: { layer: LayersEnum.Activity }, userId };
          }
          case 'callsite.memory_context_list': {
            return { kind: 'memory_list', params: { layer: LayersEnum.Context }, userId };
          }
          case 'callsite.memory_experience_list': {
            return { kind: 'memory_list', params: { layer: LayersEnum.Experience }, userId };
          }
          case 'callsite.memory_identity_list': {
            return { kind: 'memory_list', params: { layer: LayersEnum.Identity }, userId };
          }
          case 'callsite.memory_preference_list': {
            return { kind: 'memory_list', params: { layer: LayersEnum.Preference }, userId };
          }
          case 'callsite.memory_hybrid': {
            return { kind: 'memory_hybrid', userId };
          }
        }

        if (benchmarkCase.entity === 'document') {
          return {
            kind: 'knowledge_base_documents',
            knowledgeBaseIds: [`\${ENV:SEARCH_BENCHMARK_KNOWLEDGE_BASE_ID}`],
            userId,
            workspaceId,
          };
        }

        return {
          kind: 'unified',
          options: {
            ...(benchmarkCase.id.startsWith('permission.agent_scope_')
              ? { agentId: `\${ENV:SEARCH_BENCHMARK_SCOPED_AGENT_ID}` }
              : {}),
            ...(benchmarkCase.id === 'permission.nonexistent_scope'
              ? { agentId: `\${ENV:SEARCH_BENCHMARK_NONEXISTENT_AGENT_ID}` }
              : {}),
            type: toSearchResultType(benchmarkCase.entity),
          },
          userId,
          workspaceId,
        };
      })();

      return [benchmarkCase.requestKey, { query, request, resultRefs }];
    }),
  ),
  environment: 'replace-with-snapshot-fork-name',
  environmentKind: 'snapshot_fork',
  measuredRuns: 10,
  qualityMeasuredRuns: 3,
  qualityWarmupRuns: 0,
  snapshotAt: 'replace-with-ISO-8601-snapshot-time',
  warmupRuns: 2,
});

const writeTemplate = async () => {
  const outputPath = path.resolve(requireArgument('output'));
  await writePrivateFile(outputPath, `${JSON.stringify(createTemplate(), null, 2)}\n`);
};

const command = process.argv[2];

switch (command) {
  case 'diff': {
    await runDiff();
    break;
  }
  case 'run': {
    await runBaseline('contract');
    break;
  }
  case 'run-quality': {
    await runBaseline('quality');
    break;
  }
  case 'report': {
    await runReport();
    break;
  }
  case 'template': {
    await writeTemplate();
    break;
  }
  default: {
    throw new Error('Usage: search:benchmark <template|run|run-quality|report|diff> [arguments]');
  }
}
