import { summarizeLatency } from './runner';
import type {
  BenchmarkCaseGroup,
  SearchBenchmarkArtifact,
  SearchBenchmarkCaseArtifact,
  SearchDistributionSummary,
} from './types';

export interface SearchBenchmarkResultCoverage {
  caseCount: number;
  maxResultsPerCase: number;
  multiResultCases: number;
  singleResultCases: number;
  topTenComparableCases: number;
  totalResults: number;
  zeroResultCases: number;
}

export interface SearchBenchmarkGroupReport {
  apiP50AcrossCases: SearchDistributionSummary;
  apiP95AcrossCases: SearchDistributionSummary;
  caseCount: number;
  group: BenchmarkCaseGroup;
  totalResults: number;
  zeroResultCases: number;
}

export interface SearchBenchmarkEvidenceCase {
  apiP50Ms: number;
  apiP95Ms: number;
  group: BenchmarkCaseGroup;
  id: string;
  orderedResults: string[];
  resultCount: number;
}

export interface SearchBenchmarkReport {
  artifact: SearchBenchmarkArtifact;
  groups: SearchBenchmarkGroupReport[];
  latencyAcrossCases: {
    apiP50: SearchDistributionSummary;
    apiP95: SearchDistributionSummary;
    databaseWorkP50: SearchDistributionSummary;
    hydrationWorkP50: SearchDistributionSummary;
  };
  queryAndRankingEvidence: SearchBenchmarkEvidenceCase[];
  resultCoverage: SearchBenchmarkResultCoverage;
  slowestCases: SearchBenchmarkEvidenceCase[];
}

const sumResults = (cases: SearchBenchmarkCaseArtifact[]): number =>
  cases.reduce((total, benchmarkCase) => total + benchmarkCase.assertion.actualResultCount, 0);

const toPublicResultRef = (resultRef: string): string =>
  resultRef.startsWith('fixture:') ? resultRef.slice('fixture:'.length) : 'pseudonymous';

const toEvidenceCase = (
  benchmarkCase: SearchBenchmarkCaseArtifact,
): SearchBenchmarkEvidenceCase => ({
  apiP50Ms: benchmarkCase.latencyMs.api.p50,
  apiP95Ms: benchmarkCase.latencyMs.api.p95,
  group: benchmarkCase.group,
  id: benchmarkCase.id,
  orderedResults: benchmarkCase.orderedResults.map(({ resultRef }) => toPublicResultRef(resultRef)),
  resultCount: benchmarkCase.assertion.actualResultCount,
});

export const createSearchBenchmarkReport = (
  artifact: SearchBenchmarkArtifact,
): SearchBenchmarkReport => {
  const resultCounts = artifact.cases.map(
    (benchmarkCase) => benchmarkCase.assertion.actualResultCount,
  );
  const groups = [...new Set(artifact.cases.map(({ group }) => group))].map((group) => {
    const cases = artifact.cases.filter((benchmarkCase) => benchmarkCase.group === group);

    return {
      apiP50AcrossCases: summarizeLatency(cases.map(({ latencyMs }) => latencyMs.api.p50)),
      apiP95AcrossCases: summarizeLatency(cases.map(({ latencyMs }) => latencyMs.api.p95)),
      caseCount: cases.length,
      group,
      totalResults: sumResults(cases),
      zeroResultCases: cases.filter(({ assertion }) => assertion.actualResultCount === 0).length,
    };
  });

  return {
    artifact,
    groups,
    latencyAcrossCases: {
      apiP50: summarizeLatency(artifact.cases.map(({ latencyMs }) => latencyMs.api.p50)),
      apiP95: summarizeLatency(artifact.cases.map(({ latencyMs }) => latencyMs.api.p95)),
      databaseWorkP50: summarizeLatency(
        artifact.cases.map(({ latencyMs }) => latencyMs.database.p50),
      ),
      hydrationWorkP50: summarizeLatency(
        artifact.cases.map(({ latencyMs }) => latencyMs.hydration.p50),
      ),
    },
    queryAndRankingEvidence: artifact.cases
      .filter(({ group }) => group === 'query_shape' || group === 'ranking')
      .map(toEvidenceCase),
    resultCoverage: {
      caseCount: artifact.cases.length,
      maxResultsPerCase: Math.max(...resultCounts, 0),
      multiResultCases: resultCounts.filter((count) => count > 1).length,
      singleResultCases: resultCounts.filter((count) => count === 1).length,
      topTenComparableCases: resultCounts.filter((count) => count >= 10).length,
      totalResults: sumResults(artifact.cases),
      zeroResultCases: resultCounts.filter((count) => count === 0).length,
    },
    slowestCases: [...artifact.cases]
      .sort((left, right) => right.latencyMs.api.p50 - left.latencyMs.api.p50)
      .slice(0, 10)
      .map(toEvidenceCase),
  };
};

const formatMs = (value: number): string => `${value.toFixed(1)} ms`;

const formatBytes = (value: number): string => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

const renderOrderedResults = (results: string[]): string =>
  results.length === 0 ? '—' : results.join(' → ');

const escapeTableCell = (value: string): string =>
  value.replaceAll('|', '\\|').replaceAll('_', '\\_');

const renderTable = (
  headers: string[],
  rows: string[][],
  rightAlignedColumns: number[] = [],
): string => {
  const escapedRows = [headers, ...rows].map((row) => row.map(escapeTableCell));
  const columnWidths = headers.map((_, columnIndex) =>
    Math.max(3, ...escapedRows.map((row) => row[columnIndex]?.length ?? 0)),
  );
  const rightAligned = new Set(rightAlignedColumns);
  const renderRow = (row: string[]): string =>
    `| ${columnWidths
      .map((width, columnIndex) => {
        const cell = row[columnIndex] ?? '';
        return rightAligned.has(columnIndex) ? cell.padStart(width) : cell.padEnd(width);
      })
      .join(' | ')} |`;
  const separator = columnWidths.map((width, columnIndex) =>
    rightAligned.has(columnIndex) ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width),
  );

  return [
    renderRow(escapedRows[0]!),
    renderRow(separator),
    ...escapedRows.slice(1).map(renderRow),
  ].join('\n');
};

export const renderSearchBenchmarkReport = (report: SearchBenchmarkReport): string => {
  const { artifact, resultCoverage } = report;
  const largestIndexes = [...artifact.inspection.indexes]
    .sort((left, right) => right.indexBytes - left.indexBytes)
    .slice(0, 5);
  const qualityWarning =
    resultCoverage.topTenComparableCases === 0
      ? '> Quality limitation: no case returns 10 results. This artifact is strong contract and permission evidence, but it cannot support the Market-style Top-10 recall, overlap, or relevance review needed for a search-quality migration decision.'
      : '> Quality note: use the Top-10-comparable cases for provider recall, overlap, and relevance review; contract and permission cases remain hard gates.';
  const resultCoverageTable = renderTable(
    ['Measure', 'Value'],
    [
      ['Cases', String(resultCoverage.caseCount)],
      ['Representative results', String(resultCoverage.totalResults)],
      ['Zero-result cases', String(resultCoverage.zeroResultCases)],
      ['Single-result cases', String(resultCoverage.singleResultCases)],
      ['Multi-result cases', String(resultCoverage.multiResultCases)],
      ['Cases with at least 10 results', String(resultCoverage.topTenComparableCases)],
      ['Maximum results in one case', String(resultCoverage.maxResultsPerCase)],
    ],
    [1],
  );
  const latencyTable = renderTable(
    ['Per-case metric', 'Median case', 'Cross-case p95', 'Worst case'],
    [
      [
        'API p50 wall-clock',
        formatMs(report.latencyAcrossCases.apiP50.p50),
        formatMs(report.latencyAcrossCases.apiP50.p95),
        formatMs(report.latencyAcrossCases.apiP50.max),
      ],
      [
        'API p95 wall-clock',
        formatMs(report.latencyAcrossCases.apiP95.p50),
        formatMs(report.latencyAcrossCases.apiP95.p95),
        formatMs(report.latencyAcrossCases.apiP95.max),
      ],
      [
        'Database aggregate-work p50',
        formatMs(report.latencyAcrossCases.databaseWorkP50.p50),
        formatMs(report.latencyAcrossCases.databaseWorkP50.p95),
        formatMs(report.latencyAcrossCases.databaseWorkP50.max),
      ],
      [
        'Hydration aggregate-work p50',
        formatMs(report.latencyAcrossCases.hydrationWorkP50.p50),
        formatMs(report.latencyAcrossCases.hydrationWorkP50.p95),
        formatMs(report.latencyAcrossCases.hydrationWorkP50.max),
      ],
    ],
    [1, 2, 3],
  );
  const groupTable = renderTable(
    [
      'Group',
      'Cases',
      'Zero results',
      'Representative results',
      'Median case API p50',
      'Median case API p95',
      'Worst case API p95',
    ],
    report.groups.map((group) => [
      group.group,
      String(group.caseCount),
      String(group.zeroResultCases),
      String(group.totalResults),
      formatMs(group.apiP50AcrossCases.p50),
      formatMs(group.apiP95AcrossCases.p50),
      formatMs(group.apiP95AcrossCases.max),
    ]),
    [1, 2, 3, 4, 5, 6],
  );
  const evidenceTable = renderTable(
    ['Case', 'Group', 'Results', 'API p50', 'API p95', 'Stored order'],
    report.queryAndRankingEvidence.map((benchmarkCase) => [
      benchmarkCase.id,
      benchmarkCase.group,
      String(benchmarkCase.resultCount),
      formatMs(benchmarkCase.apiP50Ms),
      formatMs(benchmarkCase.apiP95Ms),
      renderOrderedResults(benchmarkCase.orderedResults),
    ]),
    [2, 3, 4],
  );
  const slowestCasesTable = renderTable(
    ['Case', 'Group', 'Results', 'API p50', 'API p95'],
    report.slowestCases.map((benchmarkCase) => [
      benchmarkCase.id,
      benchmarkCase.group,
      String(benchmarkCase.resultCount),
      formatMs(benchmarkCase.apiP50Ms),
      formatMs(benchmarkCase.apiP95Ms),
    ]),
    [2, 3, 4],
  );
  const indexTable = renderTable(
    ['Largest index', 'Table', 'Estimated rows', 'Size'],
    largestIndexes.map((index) => [
      index.indexName,
      index.table,
      index.rowEstimate.toLocaleString('en-US'),
      formatBytes(index.indexBytes),
    ]),
    [2, 3],
  );

  return `# Search benchmark baseline report

Generated from schema ${artifact.schemaVersion} at ${artifact.generatedAt}.

## Executive summary

- Provider: \`${artifact.provider}\`
- Environment: \`${artifact.metadata.environment}\` at ${artifact.metadata.snapshotAt}
- Revision: \`${artifact.metadata.revision}\`
- Run: ${artifact.cases.length} cases × ${artifact.run.measuredRuns} measured runs after ${artifact.run.warmupRuns} warmups
- Hard gates: ${artifact.run.failedCases} failed cases, ${artifact.run.permissionLeaks} permission leaks, ${(artifact.run.errorRate * 100).toFixed(1)}% API error rate
- Result coverage: ${resultCoverage.totalResults} representative results; ${resultCoverage.zeroResultCases} zero-result, ${resultCoverage.singleResultCases} single-result, ${resultCoverage.multiResultCases} multi-result cases; maximum ${resultCoverage.maxResultsPerCase} results in one case
- Typical API wall-clock: ${formatMs(report.latencyAcrossCases.apiP50.p50)} median of per-case p50; ${formatMs(report.latencyAcrossCases.apiP95.p50)} median of per-case p95
- Slowest per-case p50: \`${report.slowestCases[0]?.id ?? 'n/a'}\` at ${formatMs(report.slowestCases[0]?.apiP50Ms ?? 0)}

${qualityWarning}

## Result coverage

${resultCoverageTable}

## Latency across cases

These are distributions of each case's stored percentile, not a global request percentile.

${latencyTable}

For multi-entity searches, database and hydration branches run in parallel. Their values are summed work, so they may exceed API wall-clock and must not be reported as user-visible latency.

## Case groups

${groupTable}

## Query-shape and ranking evidence

Only public fixture labels are shown. Unknown database IDs remain pseudonymous.

${evidenceTable}

## Slowest API paths

${slowestCasesTable}

## Production-size snapshot

Content sample: ${artifact.inspection.plan.contentSample.method} ${artifact.inspection.plan.contentSample.ratePercent}% with repeatable seed ${artifact.inspection.plan.contentSample.repeatableSeed} across ${artifact.inspection.plan.contentSample.tables.join(', ')}.

${indexTable}
`;
};
