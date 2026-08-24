# Search benchmark baseline

This benchmark freezes the current `pg_search` behavior before a search-provider migration. It deliberately produces two independent baselines:

- the contract suite freezes permissions, call sites, query shapes, and known fixture behavior;
- the quality suite copies the Market migration method: 20 fixed Chinese/English high-frequency queries × 9 user-visible database entity types × 3 runs, with Top-5 results, zero-result counts, literal relevance, and product-path latency.

OpenTelemetry is the shared measurement path; it is not a replacement for either deterministic result evidence or the high-frequency quality corpus.

## Safety boundary

- Run deterministic benchmarks only on an explicitly confirmed production-size snapshot fork.
- Never run this command against Production. Production evidence is read-only Prometheus/Tempo telemetry.
- Do not put database URLs, tokens, raw user/workspace/document IDs, or private content in an artifact.
- Keep runtime bindings in `search-benchmark.local.json`, which is ignored by Git and written with mode `0600` by the template command.
- Load environment values through the repository-approved secret mechanism. Do not source or inspect `.env*` files.
- Use one `SEARCH_BENCHMARK_HASH_KEY` of at least 32 characters for both compared runs. It HMAC-pseudonymizes unknown result IDs and is never written to an artifact.
- Stop if the confirmed environment label does not exactly match the configuration, any of the 14 indexes is missing, a phase has no instrumentation, results change between measured runs, or a permission negative returns its forbidden fixture.
- Run from a clean Git worktree. The CLI rejects dirty or untracked source so the artifact revision always identifies the exact code that produced it.

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

Capture the separate Market-style quality baseline with the same confirmed snapshot and actor scope:

```bash
bun run search:benchmark run-quality \
  --config=search-benchmark.local.json \
  --confirmed-environment=snapshot-fork-label \
  --output=benchmarks/search/pg-search-quality-baseline.json
```

The quality suite uses this fixed public corpus:

- Chinese: `翻译`, `搜索`, `小红书`, `数据分析`, `编程`, `写作`, `图片`, `视频`, `浏览器`, `天气`
- English: `github`, `search`, `browser`, `translation`, `data analysis`, `coding`, `image`, `automation`, `research`, `notion`

It queries `agent`, `chat_group`, `topic`, `message`, `file`, `folder`, `page`, `memory`, and `knowledge_base` through the same typed unified-search semantics with `limitPerType=5`. Public query text is serialized so the report is reviewable; private result titles are not. Only HMAC result references and literal-match booleans leave process memory.

The corpus still needs a representative private golden dataset for the confirmed actor scope. The report marks the dataset `INCONCLUSIVE` unless every fixed query and every entity type produces at least one candidate somewhere in the matrix. This is a dataset-validity check, not a claim that every query/entity cell must return a result. A sparse actor snapshot must not be presented as evidence about provider recall or ranking.

Both runners execute cases serially to avoid cross-case load and fail closed. The contract suite performs two warmups and ten measured runs by default; the quality suite performs three measured runs with no warmup to match the Market comparison. The artifact includes:

- environment, snapshot time, Git revision, Drizzle schema version, fixture version, sample counts, API error rate, and API zero-result rate;
- all 14 index sizes and row estimates, table sizes, and message/document content-size p50/p95/p99/max from a fixed-seed 0.5% page sample, including its sampled-row count;
- per-case canonical result type, explicit rank, pseudonymous result reference, available score/relevance, and positive/negative assertions;
- API result counts plus aggregate database/hydration candidate-count p50/p95/p99/max from the measured runs;
- API, aggregate database-work, and aggregate hydration-work p50/p95/p99/max from the same instrumentation used by OTel.

For an untyped query, database and hydration branches execute in parallel. The artifact reports their aggregate work, while API duration remains wall-clock end to end. Use Tempo to inspect the critical path.

## Summarize the baseline

Generate a readable report from any public benchmark artifact:

```bash
bun run search:benchmark report \
  --artifact=benchmarks/search/pg-search-baseline.json \
  --output=benchmarks/search/pg-search-baseline.md
```

For the quality artifact:

```bash
bun run search:benchmark report \
  --artifact=benchmarks/search/pg-search-quality-baseline.json \
  --output=benchmarks/search/pg-search-quality-baseline.md
```

The report separates final product-path duration from aggregate database/hydration work, summarizes latency across cases and case groups, lists the slowest paths, and shows the stored result order for query-shape and ranking cases without exposing raw IDs.

Contract and permission cases are hard migration gates, but they do not by themselves measure search quality. The quality report therefore leads with two direct tables: per-entity zero-result and literal Top-1/Top-5 rates, then all 20 high-frequency queries with their zero-result entity types. Chinese and English matrices show `returned / literal Top-5 / literal Top-1 / product-path p50` for every query/entity pair.

The product-path duration covers the final in-process search and hydration semantics used by the typed unified-search API. It does not include HTTP, CDN, or client transport. Production HTTP latency and cache behavior must be compared separately through OTel; do not relabel the in-process number as full network API latency.

## Compare a provider candidate

An Elasticsearch adapter must implement `SearchBenchmarkAdapter` and emit the same artifact schema and fixture version. Reuse the same runtime bindings and hash key, then create the report:

```bash
bun run search:benchmark diff \
  --baseline=benchmarks/search/pg-search-baseline.json \
  --candidate=benchmarks/search/elasticsearch-candidate.json \
  --output=benchmarks/search/pg-search-to-elasticsearch.md
```

The report lists added/removed/order/detail changes, Top-10 overlap, a rank-by-rank Top-10 comparison, API/DB/hydration p95 deltas, and candidate-count p95 deltas per case. Missing or unexpected cases, input-fingerprint mismatches, environment/snapshot/schema mismatches, sampling-plan mismatches, any failed assertion, or any permission leak is a hard failure. Revisions may differ because the candidate provider can be implemented in a later commit.

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
ignoring(search_result) group_left
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
