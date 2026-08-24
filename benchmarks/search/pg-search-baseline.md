# Search benchmark baseline report

Generated from schema 1 at 2026-08-24T14:45:30.696Z.

## Executive summary

- Provider: `pg_search`
- Environment: `tj-dev-latest` at 2026-08-24T14:34:06.666Z
- Revision: `de64589c5244407ce2d6010adb7c95fafe819dd7`
- Run: 54 cases × 10 measured runs after 2 warmups
- Hard gates: 0 failed cases, 0 permission leaks, 0.0% API error rate
- Result coverage: 42 representative results; 13 zero-result, 40 single-result, 1 multi-result cases; maximum 2 results in one case
- Typical API wall-clock: 296.7 ms median of per-case p50; 433.9 ms median of per-case p95
- Slowest per-case p50: `callsite.memory_context_list` at 1958.1 ms

> Quality limitation: no case returns 10 results. This artifact is strong contract and permission evidence, but it cannot support the Market-style Top-10 recall, overlap, or relevance review needed for a search-quality migration decision.

## Result coverage

| Measure                        | Value |
| ------------------------------ | ----: |
| Cases                          |    54 |
| Representative results         |    42 |
| Zero-result cases              |    13 |
| Single-result cases            |    40 |
| Multi-result cases             |     1 |
| Cases with at least 10 results |     0 |
| Maximum results in one case    |     2 |

## Latency across cases

These are distributions of each case's stored percentile, not a global request percentile.

| Per-case metric              | Median case | Cross-case p95 | Worst case |
| ---------------------------- | ----------: | -------------: | ---------: |
| API p50 wall-clock           |    296.7 ms |       653.2 ms |  1958.1 ms |
| API p95 wall-clock           |    433.9 ms |      1402.5 ms |  2466.3 ms |
| Database aggregate-work p50  |    296.6 ms |      3600.1 ms |  4034.3 ms |
| Hydration aggregate-work p50 |      0.0 ms |         0.1 ms |     0.1 ms |

For multi-entity searches, database and hydration branches run in parallel. Their values are summed work, so they may exceed API wall-clock and must not be reported as user-visible latency.

## Case groups

| Group         | Cases | Zero results | Representative results | Median case API p50 | Median case API p95 | Worst case API p95 |
| ------------- | ----: | -----------: | ---------------------: | ------------------: | ------------------: | -----------------: |
| query\_shape  |     5 |            0 |                      5 |            353.3 ms |            440.7 ms |          1079.4 ms |
| ranking       |     3 |            0 |                      4 |            311.6 ms |            552.9 ms |           584.7 ms |
| result\_state |     1 |            1 |                      0 |            644.1 ms |           1264.8 ms |          1264.8 ms |
| callsite      |    13 |            0 |                     13 |            328.6 ms |            468.7 ms |          2466.3 ms |
| entity        |    12 |            0 |                     12 |            296.7 ms |            313.6 ms |           576.1 ms |
| permission    |    20 |           12 |                      8 |            275.3 ms |            438.7 ms |          1074.6 ms |

## Query-shape and ranking evidence

Only public fixture labels are shown. Unknown database IDs remain pseudonymous.

| Case                      | Group        | Results |  API p50 |   API p95 | Stored order               |
| ------------------------- | ------------ | ------: | -------: | --------: | -------------------------- |
| query.zh\_continuous      | query\_shape |       1 | 345.5 ms |  411.5 ms | primary                    |
| query.en\_stemming        | query\_shape |       1 | 353.3 ms |  440.7 ms | primary                    |
| query.exact\_phrase       | query\_shape |       1 | 591.7 ms |  613.6 ms | primary                    |
| query.special\_characters | query\_shape |       1 | 245.2 ms |  260.1 ms | primary                    |
| query.long                | query\_shape |       1 | 556.3 ms | 1079.4 ms | primary                    |
| ranking.title\_weight     | ranking      |       2 | 311.6 ms |  420.2 ms | body\_match → title\_match |
| ranking.rare\_term        | ranking      |       1 | 295.9 ms |  584.7 ms | primary                    |
| ranking.frequent\_term    | ranking      |       1 | 500.5 ms |  552.9 ms | primary                    |

## Slowest API paths

| Case                            | Group         | Results |   API p50 |   API p95 |
| ------------------------------- | ------------- | ------: | --------: | --------: |
| callsite.memory\_context\_list  | callsite      |       1 | 1958.1 ms | 2466.3 ms |
| callsite.memory\_hybrid         | callsite      |       1 |  692.7 ms |  847.7 ms |
| callsite.memory\_identity\_list | callsite      |       1 |  670.2 ms | 2078.0 ms |
| result.zero                     | result\_state |       0 |  644.1 ms | 1264.8 ms |
| permission.revoked\_access      | permission    |       0 |  615.6 ms |  700.2 ms |
| permission.personal\_isolation  | permission    |       0 |  600.3 ms | 1074.6 ms |
| query.exact\_phrase             | query\_shape  |       1 |  591.7 ms |  613.6 ms |
| query.long                      | query\_shape  |       1 |  556.3 ms | 1079.4 ms |
| permission.deleted\_object      | permission    |       0 |  531.1 ms |  627.5 ms |
| permission.nonexistent\_scope   | permission    |       1 |  513.6 ms |  826.8 ms |

## Production-size snapshot

Content sample: system 0.5% with repeatable seed 13431 across documents, messages.

| Largest index             | Table          | Estimated rows |       Size |
| ------------------------- | -------------- | -------------: | ---------: |
| messages\_bm25\_idx       | messages       |     25,090,372 |  30.34 GiB |
| documents\_bm25\_idx      | documents      |      1,537,135 |  19.59 GiB |
| agents\_bm25\_idx         | agents         |      1,318,382 |   1.45 GiB |
| topics\_bm25\_idx         | topics         |      1,259,782 | 295.42 MiB |
| user\_memories\_bm25\_idx | user\_memories |        621,010 | 258.14 MiB |
