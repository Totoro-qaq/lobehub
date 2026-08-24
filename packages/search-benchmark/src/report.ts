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

export interface SearchBenchmarkQualityEntityReport {
  apiP50MedianMs: number;
  apiP95MedianMs: number;
  entity: SearchBenchmarkCaseArtifact['entity'];
  literalTop1: number;
  literalTopK: number;
  queryCount: number;
  returnedTopK: number;
  zeroResultQueries: number;
}

export interface SearchBenchmarkQualityQueryReport {
  apiP50MedianMs: number;
  cases: SearchBenchmarkCaseArtifact[];
  entityCount: number;
  literalTop1: number;
  literalTopK: number;
  locale: 'en-US' | 'zh-CN';
  nonEmptyEntities: number;
  publicQuery: string;
  returnedTopK: number;
  zeroResultEntities: SearchBenchmarkCaseArtifact['entity'][];
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
  quality?: {
    entities: SearchBenchmarkQualityEntityReport[];
    queries: SearchBenchmarkQualityQueryReport[];
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

type QualityArtifactCase = SearchBenchmarkCaseArtifact & {
  quality: NonNullable<SearchBenchmarkCaseArtifact['quality']>;
};

const isQualityCase = (
  benchmarkCase: SearchBenchmarkCaseArtifact,
): benchmarkCase is QualityArtifactCase => benchmarkCase.quality !== undefined;

const createQualityReport = (cases: QualityArtifactCase[]) => {
  if (cases.length === 0) return undefined;

  const entities = [...new Set(cases.map(({ entity }) => entity))].map((entity) => {
    const entityCases = cases.filter((benchmarkCase) => benchmarkCase.entity === entity);

    return {
      apiP50MedianMs: summarizeLatency(entityCases.map(({ latencyMs }) => latencyMs.api.p50)).p50,
      apiP95MedianMs: summarizeLatency(entityCases.map(({ latencyMs }) => latencyMs.api.p95)).p50,
      entity,
      literalTop1: entityCases.filter(({ quality }) => quality.literalTop1).length,
      literalTopK: entityCases.reduce((total, { quality }) => total + quality.literalTopK, 0),
      queryCount: entityCases.length,
      returnedTopK: entityCases.reduce((total, { quality }) => total + quality.returnedTopK, 0),
      zeroResultQueries: entityCases.filter(({ quality }) => quality.returnedTopK === 0).length,
    };
  });
  const queryKeys = [
    ...new Set(cases.map(({ quality }) => `${quality.locale}:${quality.publicQuery}`)),
  ];
  const queries = queryKeys.map((queryKey) => {
    const queryCases = cases.filter(
      ({ quality }) => `${quality.locale}:${quality.publicQuery}` === queryKey,
    );
    const quality = queryCases[0]!.quality;

    return {
      apiP50MedianMs: summarizeLatency(queryCases.map(({ latencyMs }) => latencyMs.api.p50)).p50,
      cases: queryCases,
      entityCount: queryCases.length,
      literalTop1: queryCases.filter(({ quality: result }) => result.literalTop1).length,
      literalTopK: queryCases.reduce((total, { quality: result }) => total + result.literalTopK, 0),
      locale: quality.locale,
      nonEmptyEntities: queryCases.filter(({ quality: result }) => result.returnedTopK > 0).length,
      publicQuery: quality.publicQuery,
      returnedTopK: queryCases.reduce(
        (total, { quality: result }) => total + result.returnedTopK,
        0,
      ),
      zeroResultEntities: queryCases
        .filter(({ quality: result }) => result.returnedTopK === 0)
        .map(({ entity }) => entity),
    };
  });

  return { entities, queries };
};

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
  const quality = createQualityReport(artifact.cases.filter(isQualityCase));

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
    ...(quality ? { quality } : {}),
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

const formatRatio = (numerator: number, denominator: number): string =>
  `${numerator}/${denominator}`;

const renderQualitySection = (quality: NonNullable<SearchBenchmarkReport['quality']>): string => {
  const entityTable = renderTable(
    [
      'Entity',
      'Zero queries',
      'Top-1 literal',
      'Top-5 literal',
      'Returned Top-5',
      'Median path p50',
      'Median path p95',
    ],
    quality.entities.map((entity) => [
      entity.entity,
      formatRatio(entity.zeroResultQueries, entity.queryCount),
      formatRatio(entity.literalTop1, entity.queryCount),
      formatRatio(entity.literalTopK, entity.returnedTopK),
      String(entity.returnedTopK),
      formatMs(entity.apiP50MedianMs),
      formatMs(entity.apiP95MedianMs),
    ]),
    [1, 2, 3, 4, 5, 6],
  );
  const queryTable = renderTable(
    [
      'Query',
      'Locale',
      'Non-empty types',
      'Top-1 literal',
      'Top-5 literal',
      'Returned Top-5',
      'Median path p50',
      'Zero-result types',
    ],
    quality.queries.map((query) => [
      query.publicQuery,
      query.locale,
      formatRatio(query.nonEmptyEntities, query.entityCount),
      formatRatio(query.literalTop1, query.entityCount),
      formatRatio(query.literalTopK, query.returnedTopK),
      String(query.returnedTopK),
      formatMs(query.apiP50MedianMs),
      query.zeroResultEntities.join(', ') || 'none',
    ]),
    [2, 3, 4, 5, 6],
  );
  const entityNames = quality.entities.map(({ entity }) => entity);
  const renderMatrix = (locale: 'en-US' | 'zh-CN') =>
    renderTable(
      ['Query', ...entityNames],
      quality.queries
        .filter((query) => query.locale === locale)
        .map((query) => [
          query.publicQuery,
          ...entityNames.map((entity) => {
            const benchmarkCase = query.cases.find((item) => item.entity === entity);
            if (!benchmarkCase?.quality) return '—';

            const top1 = benchmarkCase.quality.literalTop1 ? 'Y' : 'N';
            return `${benchmarkCase.quality.returnedTopK}/${benchmarkCase.quality.literalTopK}/${top1}/${Math.round(benchmarkCase.latencyMs.api.p50)}`;
          }),
        ]),
    );

  return `## High-frequency search quality

This is the migration quality baseline. Each cell in the matrices is \`returned / literal Top-5 / literal Top-1 (Y/N) / product-path p50 ms\`.

The product-path timing covers the same final in-process search and hydration semantics used by the typed unified-search API. It does not include HTTP, CDN, or client transport; those remain a separate production telemetry comparison.

### Entity summary

${entityTable}

### Query summary

${queryTable}

### Chinese query matrix

${renderMatrix('zh-CN')}

### English query matrix

${renderMatrix('en-US')}`;
};

export const renderSearchBenchmarkReport = (report: SearchBenchmarkReport): string => {
  const { artifact, resultCoverage } = report;
  const largestIndexes = [...artifact.inspection.indexes]
    .sort((left, right) => right.indexBytes - left.indexBytes)
    .slice(0, 5);
  const qualityWarning = report.quality
    ? `> Quality method: fixed 20-query Chinese/English corpus × 9 user-visible database entity types × ${artifact.run.measuredRuns} measured runs. Top-1/Top-5 literal relevance checks only public query terms against the final title/identifier surface; it is a stable comparison signal, not a complete semantic judgment.`
    : resultCoverage.topTenComparableCases === 0
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
        'Product-path p50',
        formatMs(report.latencyAcrossCases.apiP50.p50),
        formatMs(report.latencyAcrossCases.apiP50.p95),
        formatMs(report.latencyAcrossCases.apiP50.max),
      ],
      [
        'Product-path p95',
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
      'Median path p50',
      'Median path p95',
      'Worst path p95',
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
    ['Case', 'Group', 'Results', 'Path p50', 'Path p95', 'Stored order'],
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
    ['Case', 'Group', 'Results', 'Path p50', 'Path p95'],
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
  const qualitySection = report.quality ? renderQualitySection(report.quality) : '';

  return `# Search benchmark baseline report

Generated from schema ${artifact.schemaVersion} at ${artifact.generatedAt}.

## Executive summary

- Provider: \`${artifact.provider}\`
- Environment: \`${artifact.metadata.environment}\` at ${artifact.metadata.snapshotAt}
- Revision: \`${artifact.metadata.revision}\`
- Run: ${artifact.cases.length} cases × ${artifact.run.measuredRuns} measured runs after ${artifact.run.warmupRuns} warmups
- Hard gates: ${artifact.run.failedCases} failed cases, ${artifact.run.permissionLeaks} permission leaks, ${(artifact.run.errorRate * 100).toFixed(1)}% search-path error rate
- Result coverage: ${resultCoverage.totalResults} representative results; ${resultCoverage.zeroResultCases} zero-result, ${resultCoverage.singleResultCases} single-result, ${resultCoverage.multiResultCases} multi-result cases; maximum ${resultCoverage.maxResultsPerCase} results in one case
- Typical product-path duration: ${formatMs(report.latencyAcrossCases.apiP50.p50)} median of per-case p50; ${formatMs(report.latencyAcrossCases.apiP95.p50)} median of per-case p95
- Slowest per-case p50: \`${report.slowestCases[0]?.id ?? 'n/a'}\` at ${formatMs(report.slowestCases[0]?.apiP50Ms ?? 0)}

${qualityWarning}

${qualitySection}

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

## Slowest product paths

${slowestCasesTable}

## Production-size snapshot

Content sample: ${artifact.inspection.plan.contentSample.method} ${artifact.inspection.plan.contentSample.ratePercent}% with repeatable seed ${artifact.inspection.plan.contentSample.repeatableSeed} across ${artifact.inspection.plan.contentSample.tables.join(', ')}.

${indexTable}
`;
};
