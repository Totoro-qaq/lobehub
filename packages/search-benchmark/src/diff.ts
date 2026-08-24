import type {
  SearchBenchmarkArtifact,
  SearchBenchmarkCaseArtifact,
  SearchBenchmarkCaseDiff,
  SearchBenchmarkDiff,
  SearchBenchmarkDiffOptions,
  SearchBenchmarkSemanticDifference,
} from './types';
import { SEARCH_BENCHMARK_SCHEMA_VERSION } from './types';

const latencyDeltaPercent = (baseline: number, candidate: number): number | null => {
  if (baseline === 0) return null;
  return Number((((candidate - baseline) / baseline) * 100).toFixed(2));
};

const diffCase = (
  baseline: SearchBenchmarkCaseArtifact,
  candidate: SearchBenchmarkCaseArtifact,
): SearchBenchmarkCaseDiff => {
  const baselineResultRefs = baseline.orderedResults.map(({ resultRef }) => resultRef);
  const candidateResultRefs = candidate.orderedResults.map(({ resultRef }) => resultRef);
  const baselineRefs = new Set(baselineResultRefs);
  const candidateRefs = new Set(candidateResultRefs);
  const withoutRank = (benchmarkCase: SearchBenchmarkCaseArtifact) =>
    benchmarkCase.orderedResults
      .map(({ rank: _rank, ...result }) => result)
      .sort((left, right) => left.resultRef.localeCompare(right.resultRef));

  return {
    addedResultRefs: candidateResultRefs.filter((resultRef) => !baselineRefs.has(resultRef)),
    approvedDifferences: [],
    assertionChanged: baseline.assertion.passed !== candidate.assertion.passed,
    id: baseline.id,
    inputChanged: baseline.inputFingerprint !== candidate.inputFingerprint,
    latencyDeltaPercent: {
      apiP95: latencyDeltaPercent(baseline.latencyMs.api.p95, candidate.latencyMs.api.p95),
      databaseP95: latencyDeltaPercent(
        baseline.latencyMs.database.p95,
        candidate.latencyMs.database.p95,
      ),
      hydrationP95: latencyDeltaPercent(
        baseline.latencyMs.hydration.p95,
        candidate.latencyMs.hydration.p95,
      ),
    },
    orderChanged: JSON.stringify(baselineResultRefs) !== JSON.stringify(candidateResultRefs),
    regressions: [],
    removedResultRefs: baselineResultRefs.filter((resultRef) => !candidateRefs.has(resultRef)),
    resultCountDeltaPercent: {
      apiP95: latencyDeltaPercent(baseline.resultCounts.api.p95, candidate.resultCounts.api.p95),
      databaseP95: latencyDeltaPercent(
        baseline.resultCounts.database.p95,
        candidate.resultCounts.database.p95,
      ),
      hydrationP95: latencyDeltaPercent(
        baseline.resultCounts.hydration.p95,
        candidate.resultCounts.hydration.p95,
      ),
    },
    resultDetailsChanged:
      JSON.stringify(withoutRank(baseline)) !== JSON.stringify(withoutRank(candidate)),
  };
};

export const diffSearchBenchmarks = (
  baseline: SearchBenchmarkArtifact,
  candidate: SearchBenchmarkArtifact,
  options: SearchBenchmarkDiffOptions = {},
): SearchBenchmarkDiff => {
  if (
    baseline.schemaVersion !== SEARCH_BENCHMARK_SCHEMA_VERSION ||
    candidate.schemaVersion !== SEARCH_BENCHMARK_SCHEMA_VERSION
  ) {
    throw new Error('Unsupported search benchmark artifact schema version');
  }
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error('Cannot compare search benchmark artifacts with different schema versions');
  }
  if (baseline.metadata.fixtureVersion !== candidate.metadata.fixtureVersion) {
    throw new Error('Cannot compare search benchmark artifacts with different fixture versions');
  }

  const candidateCases = new Map(
    candidate.cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]),
  );
  const baselineCaseIds = new Set(baseline.cases.map(({ id }) => id));
  const missingCases: string[] = [];
  const inputMismatches: string[] = [];
  const unexpectedCases = candidate.cases
    .filter(({ id }) => !baselineCaseIds.has(id))
    .map(({ id }) => id);
  const cases: SearchBenchmarkCaseDiff[] = [];
  const approvedDifferences = new Set(options.approvedDifferences ?? []);
  for (const approval of approvedDifferences) {
    if (!/^[a-z\d][a-z\d._-]{0,127}:(?:details|order|results)$/.test(approval)) {
      throw new Error(`Invalid search benchmark difference approval: ${approval}`);
    }
  }
  const usedApprovals = new Set<string>();
  const semanticRegressions: string[] = [];

  for (const baselineCase of baseline.cases) {
    const candidateCase = candidateCases.get(baselineCase.id);
    if (!candidateCase) {
      missingCases.push(baselineCase.id);
      continue;
    }
    const caseDiff = diffCase(baselineCase, candidateCase);
    const semanticDifferences: SearchBenchmarkSemanticDifference[] = [
      ...(caseDiff.addedResultRefs.length > 0 || caseDiff.removedResultRefs.length > 0
        ? (['results'] as const)
        : []),
      ...(caseDiff.orderChanged ? (['order'] as const) : []),
      ...(caseDiff.resultDetailsChanged ? (['details'] as const) : []),
    ];
    for (const difference of semanticDifferences) {
      const token = `${caseDiff.id}:${difference}`;
      if (approvedDifferences.has(token)) {
        caseDiff.approvedDifferences.push(difference);
        usedApprovals.add(token);
      } else {
        caseDiff.regressions.push(difference);
        semanticRegressions.push(token);
      }
    }
    cases.push(caseDiff);
    if (caseDiff.inputChanged) inputMismatches.push(caseDiff.id);
  }

  const candidatePermissionLeaks = candidate.run.permissionLeaks;
  const candidateFailedCases = candidate.run.failedCases;
  const baselinePermissionLeaks = baseline.run.permissionLeaks;
  const baselineFailedCases = baseline.run.failedCases;
  const metadataMismatches = ['databaseSchemaVersion', 'environment', 'snapshotAt'].filter(
    (key) =>
      baseline.metadata[key as keyof typeof baseline.metadata] !==
      candidate.metadata[key as keyof typeof candidate.metadata],
  );
  const runMismatches = ['measuredRuns', 'warmupRuns'].filter(
    (key) =>
      baseline.run[key as 'measuredRuns' | 'warmupRuns'] !==
      candidate.run[key as 'measuredRuns' | 'warmupRuns'],
  );
  const unusedApprovals = [...approvedDifferences]
    .filter((approval) => !usedApprovals.has(approval))
    .sort();

  return {
    baseline: { metadata: baseline.metadata, provider: baseline.provider },
    candidate: { metadata: candidate.metadata, provider: candidate.provider },
    cases,
    gates: {
      baselineFailedCases,
      baselinePermissionLeaks,
      candidateFailedCases,
      candidatePermissionLeaks,
      inputMismatches,
      metadataMismatches,
      missingCases,
      passed:
        baselineFailedCases === 0 &&
        baselinePermissionLeaks === 0 &&
        candidateFailedCases === 0 &&
        candidatePermissionLeaks === 0 &&
        inputMismatches.length === 0 &&
        metadataMismatches.length === 0 &&
        missingCases.length === 0 &&
        runMismatches.length === 0 &&
        semanticRegressions.length === 0 &&
        unexpectedCases.length === 0 &&
        unusedApprovals.length === 0,
      runMismatches,
      semanticRegressions,
      unexpectedCases,
      unusedApprovals,
    },
    schemaVersion: SEARCH_BENCHMARK_SCHEMA_VERSION,
  };
};

const formatDelta = (value: number | null): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const renderSearchBenchmarkDiff = (diff: SearchBenchmarkDiff): string => {
  const rows = diff.cases
    .map((benchmarkCase) => {
      const status =
        benchmarkCase.regressions.length > 0
          ? 'regression'
          : benchmarkCase.approvedDifferences.length > 0
            ? 'approved'
            : 'stable';
      return `| ${benchmarkCase.id} | ${status} | ${benchmarkCase.orderChanged ? 'changed' : 'stable'} | ${benchmarkCase.resultDetailsChanged ? 'changed' : 'stable'} | ${benchmarkCase.addedResultRefs.length} | ${benchmarkCase.removedResultRefs.length} | ${formatDelta(benchmarkCase.latencyDeltaPercent.apiP95)} | ${formatDelta(benchmarkCase.latencyDeltaPercent.databaseP95)} | ${formatDelta(benchmarkCase.latencyDeltaPercent.hydrationP95)} | ${formatDelta(benchmarkCase.resultCountDeltaPercent.apiP95)} | ${formatDelta(benchmarkCase.resultCountDeltaPercent.databaseP95)} | ${formatDelta(benchmarkCase.resultCountDeltaPercent.hydrationP95)} |`;
    })
    .join('\n');

  return `# Search benchmark diff

- Baseline: ${diff.baseline.provider} at ${diff.baseline.metadata.revision}
- Candidate: ${diff.candidate.provider} at ${diff.candidate.metadata.revision}
- Gate: ${diff.gates.passed ? 'PASS' : 'FAIL'}
- Baseline failed cases: ${diff.gates.baselineFailedCases}
- Baseline permission leaks: ${diff.gates.baselinePermissionLeaks}
- Failed cases: ${diff.gates.candidateFailedCases}
- Permission leaks: ${diff.gates.candidatePermissionLeaks}
- Input mismatches: ${diff.gates.inputMismatches.join(', ') || 'none'}
- Metadata mismatches: ${diff.gates.metadataMismatches.join(', ') || 'none'}
- Run mismatches: ${diff.gates.runMismatches.join(', ') || 'none'}
- Semantic regressions: ${diff.gates.semanticRegressions.join(', ') || 'none'}
- Unused approvals: ${diff.gates.unusedApprovals.join(', ') || 'none'}
- Missing cases: ${diff.gates.missingCases.join(', ') || 'none'}
- Unexpected cases: ${diff.gates.unexpectedCases.join(', ') || 'none'}

| Case | Status | Order | Details | Added | Removed | API p95 | DB p95 | Hydration p95 | API count p95 | DB candidates p95 | Hydration candidates p95 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}
`;
};
