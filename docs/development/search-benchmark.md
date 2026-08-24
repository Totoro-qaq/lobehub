# Search benchmark baseline

This benchmark freezes the current `pg_search` behavior before a search-provider migration. OpenTelemetry is the shared measurement path; it is not a replacement for the deterministic result, ordering, and permission fixtures.

## Safety boundary

- Run deterministic benchmarks only on an explicitly confirmed production-size snapshot fork.
- Never run this command against Production. Production evidence is read-only Prometheus/Tempo telemetry.
- Do not put database URLs, tokens, raw user/workspace/document IDs, or private content in an artifact.
- Keep runtime bindings in `search-benchmark.local.json`, which is ignored by Git and written with mode `0600` by the template command.
- Load environment values through the repository-approved secret mechanism. Do not source or inspect `.env*` files.
- Use one `SEARCH_BENCHMARK_HASH_KEY` of at least 32 characters for both compared runs. It HMAC-pseudonymizes unknown result IDs and is never written to an artifact.
- Stop if the confirmed environment label does not exactly match the configuration, any of the 14 indexes is missing, a phase has no instrumentation, results change between measured runs, or a permission negative returns its forbidden fixture.

## Current inventory

The executable inventory lives in `packages/search-benchmark/src/catalog.ts` and is checked against migration `0093_add_bm25_indexes_with_icu.sql`. It also pins the unified search, Home, legacy session/topic/message, memory list/hybrid, and KB-document product entry points to their current model/repository calls, including each call site's ownership, visibility, and business filters.

| Index                                    | Table                           | Current query path                                   |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `agents_bm25_idx`                        | `agents`                        | unified search, Home, legacy session                 |
| `topics_bm25_idx`                        | `topics`                        | unified search, legacy topic                         |
| `files_bm25_idx`                         | `files`                         | unified file search                                  |
| `knowledge_bases_bm25_idx`               | `knowledge_bases`               | unified knowledge-base search                        |
| `user_memories_bm25_idx`                 | `user_memories`                 | unified and hybrid/list memory search                |
| `chat_groups_bm25_idx`                   | `chat_groups`                   | unified search and Home                              |
| `user_memories_contexts_bm25_idx`        | `user_memories_contexts`        | memory list and hybrid lexical leg                   |
| `user_memories_preferences_bm25_idx`     | `user_memories_preferences`     | memory list and hybrid lexical leg                   |
| `user_memories_activities_bm25_idx`      | `user_memories_activities`      | activity list and hybrid lexical leg                 |
| `user_memories_identities_bm25_idx`      | `user_memories_identities`      | identity list and hybrid lexical leg                 |
| `user_memories_experiences_bm25_idx`     | `user_memories_experiences`     | experience list and hybrid lexical leg               |
| `user_memory_persona_documents_bm25_idx` | `user_memory_persona_documents` | no production BM25 query currently found             |
| `documents_bm25_idx`                     | `documents`                     | pages, folders, and direct/file-backed KB documents  |
| `messages_bm25_idx`                      | `messages`                      | unified, legacy message, and topic-by-message search |

The fixed catalog covers ICU Chinese tokenization, English stemming, phrases, special characters, long/high-frequency/rare queries, title weighting, zero results, every unified entity, direct/file-backed document deduplication, tool-message exclusion, personal/workspace isolation, public/private agents and private descendant inheritance, restricted KB descendants, revoked access, deleted records, and nonexistent scopes.

## Prepare the runtime bindings

From the repository root:

```bash
bun run search:benchmark template --output=search-benchmark.local.json
```

The generated file contains every fixed case. Replace the environment label and snapshot time, then supply each `${ENV:...}` value through the approved environment-access workflow. Query and result bindings may use the confirmed snapshot's existing data; the artifact input fingerprint prevents two providers from being compared if any query, actor, scope, or expected result binding changed. Result references use the adapter identity format `type:id` (for example, `agent:<database-id>`); KB document references use `document:<database-id>`.

Bindings are deliberately separate from the fixture catalog:

- query text and scope inputs never enter the artifact;
- public fixture names such as `primary` and `restricted_file` remain stable across providers;
- real IDs exist only in process memory and are converted to `fixture:<name>` or an HMAC before serialization.
- an HMAC input fingerprint proves the compared runs used the same query, actor, scope, and binding without revealing them.

## Capture the pg\_search baseline

After a human has confirmed the snapshot-fork identity and freshness:

```bash
bun run search:benchmark run \
  --config=search-benchmark.local.json \
  --confirmed-environment=snapshot-fork-label \
  --output=benchmarks/search/pg-search-baseline.json
```

The runner executes cases serially to avoid cross-case load, performs two warmups and ten measured runs by default, and fails closed. The artifact includes:

- environment, snapshot time, Git revision, Drizzle schema version, fixture version, sample counts, API error rate, and API zero-result rate;
- all 14 index sizes and row estimates, table sizes, and message/document content-size p50/p95/p99/max;
- per-case canonical result type, explicit rank, pseudonymous result reference, available score/relevance, and positive/negative assertions;
- API result counts plus aggregate database/hydration candidate-count p50/p95/p99/max from the measured runs;
- API, aggregate database-work, and aggregate hydration-work p50/p95/p99/max from the same instrumentation used by OTel.

For an untyped query, database and hydration branches execute in parallel. The artifact reports their aggregate work, while API duration remains wall-clock end to end. Use Tempo to inspect the critical path.

## Compare a provider candidate

An Elasticsearch adapter must implement `SearchBenchmarkAdapter` and emit the same artifact schema and fixture version. Reuse the same runtime bindings and hash key, then create the report:

```bash
bun run search:benchmark diff \
  --baseline=benchmarks/search/pg-search-baseline.json \
  --candidate=benchmarks/search/elasticsearch-candidate.json \
  --output=benchmarks/search/pg-search-to-elasticsearch.md
```

The report lists added/removed/order/detail changes, API/DB/hydration p95 deltas, and candidate-count p95 deltas per case. Missing or unexpected cases, input-fingerprint mismatches, environment/snapshot/schema mismatches, sampling-plan mismatches, any failed assertion, or any permission leak is a hard failure. Revisions may differ because the candidate provider can be implemented in a later commit.

Result membership, order, or score/relevance changes are regressions by default. A reviewed difference can be approved with a JSON string array whose entries use `<case-id>:results`, `<case-id>:order`, or `<case-id>:details`, then passed as `--approved-differences=reviewed-search-differences.json`. Unused approvals fail the gate, so a stale approval cannot silently carry forward. Latency and candidate-count deltas remain report-only until the migration review confirms numerical thresholds.

## OTel contract

Search metrics and spans use only these low-cardinality attributes:

- `search.provider`: `pg_search` or `elasticsearch`
- `search.entity`: fixed entity enum
- `search.operation`: `unified`, `home`, legacy endpoints, memory list/hybrid, or KB documents
- `search.phase`: `api`, `database`, or `hydration`
- `search.result`: `success`, `zero_result`, or `error`

Queries, content, and user/workspace/document IDs are never attributes. `search.result.count` exists only on spans. The Node resource supplies a process-lifetime-stable, cold-start-unique `service.instance.id`, which prevents cumulative metric streams from different Serverless instances from overwriting one another.

Metric instruments:

- `search.operation.duration` histogram in milliseconds
- `search.operations` counter
- `search.operation.results` result-count histogram

Depending on the OTLP-to-Prometheus translation settings, dots and units are normalized. The expected Prometheus duration family is `search_operation_duration_milliseconds_bucket`; confirm the emitted family once in Explore before saving the dashboard.

### Minimal Prometheus queries

API/DB/hydration p50, p95, or p99 (replace `0.95` as needed):

```promql
histogram_quantile(
  0.95,
  sum by (le, search_provider, search_entity, search_phase) (
    rate(search_operation_duration_milliseconds_bucket{service_name="lobehub"}[5m])
  )
)
```

Throughput by provider/entity/result:

```promql
sum by (search_provider, search_entity, search_result) (
  rate(search_operations_total{service_name="lobehub", search_phase="api"}[5m])
)
```

Error and zero-result ratios:

```promql
sum by (search_provider, search_entity, search_result) (
  rate(search_operations_total{service_name="lobehub", search_phase="api", search_result=~"error|zero_result"}[5m])
)
/
sum by (search_provider, search_entity) (
  rate(search_operations_total{service_name="lobehub", search_phase="api"}[5m])
)
```

### Minimal Tempo queries

All pg\_search spans:

```traceql
{ resource.service.name = "lobehub" && span.search.provider = "pg_search" }
```

Slow unified-search database spans:

```traceql
{ resource.service.name = "lobehub" && span.search.operation = "unified" && span.search.phase = "database" && duration > 250ms }
```

Search errors:

```traceql
{ resource.service.name = "lobehub" && span.search.result = "error" }
```

### Minimal dashboard

1. Search request rate by provider and entity.
2. API p50/p95/p99 by provider and entity.
3. Database p50/p95/p99 by provider and entity.
4. Hydration p50/p95/p99 by provider and entity.
5. Error and zero-result ratios by provider/entity.
6. Tempo links filtered by provider, operation, phase, and result.

Do not group production panels by `service.instance.id`; it exists to keep cumulative streams distinct at ingestion, and the dashboard should aggregate across instances.
