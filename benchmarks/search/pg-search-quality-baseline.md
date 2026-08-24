# Search benchmark baseline report

Generated from schema 1 at 2026-08-24T16:39:58.925Z.

## Executive summary

- Provider: `pg_search`
- Environment: `tj-dev-latest` at 2026-08-24T14:34:06.666Z
- Revision: `026638eeb0dbf055e88ec36862c7d11b391e6cd2`
- Run: 180 cases × 3 measured runs after 0 warmups
- Hard gates: 0 failed cases, 0 permission leaks, 0.0% search-path error rate
- Result coverage: 2 representative results; 178 zero-result, 2 single-result, 0 multi-result cases; maximum 1 results in one case
- Typical product-path duration: 299.6 ms median of per-case p50; 454.1 ms median of per-case p95
- Slowest per-case p50: `quality.folder.zh_weather` at 1098.1 ms

> Quality method: fixed 20-query Chinese/English corpus × 9 user-visible database entity types × 3 measured runs. Top-1/Top-5 literal relevance checks only public query terms against the final title/identifier surface; it is a stable comparison signal, not a complete semantic judgment.

## High-frequency search quality

This section determines whether the run can serve as the migration quality baseline. Each cell in the matrices is `returned / literal Top-5 / literal Top-1 (Y/N) / product-path p50 ms`.

The product-path timing covers the same final in-process search and hydration semantics used by the typed unified-search API. It does not include HTTP, CDN, or client transport; those remain a separate production telemetry comparison.

**Dataset coverage gate: INCONCLUSIVE — only 1/20 queries and 2/9 entity types produced any candidate. This actor/snapshot cannot establish recall or ranking; curate a representative golden dataset before using it as the migration baseline.**

### Entity summary

| Entity          | Zero queries | Top-1 literal | Top-5 literal | Returned Top-5 | Median path p50 | Median path p95 |
| --------------- | -----------: | ------------: | ------------: | -------------: | --------------: | --------------: |
| agent           |        20/20 |          0/20 |           0/0 |              0 |        306.5 ms |        463.8 ms |
| chat\_group     |        20/20 |          0/20 |           0/0 |              0 |        254.1 ms |        279.0 ms |
| topic           |        20/20 |          0/20 |           0/0 |              0 |        268.3 ms |        317.2 ms |
| message         |        20/20 |          0/20 |           0/0 |              0 |        537.0 ms |       1167.7 ms |
| file            |        20/20 |          0/20 |           0/0 |              0 |        246.3 ms |        455.1 ms |
| folder          |        20/20 |          0/20 |           0/0 |              0 |        378.0 ms |        586.0 ms |
| page            |        19/20 |          0/20 |           0/1 |              1 |        420.1 ms |        656.5 ms |
| memory          |        20/20 |          0/20 |           0/0 |              0 |        282.3 ms |        346.9 ms |
| knowledge\_base |        19/20 |          1/20 |           1/1 |              1 |        276.1 ms |        299.8 ms |

### Query summary

| Query         | Locale | Non-empty types | Top-1 literal | Top-5 literal | Returned Top-5 | Median path p50 | Zero-result types                                                               |
| ------------- | ------ | --------------: | ------------: | ------------: | -------------: | --------------: | ------------------------------------------------------------------------------- |
| 翻译          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        291.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 搜索          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        279.7 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 小红书        | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        323.4 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 数据分析      | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        290.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 编程          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        282.5 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 写作          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        302.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 图片          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        301.5 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 视频          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        273.1 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 浏览器        | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        322.1 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| 天气          | zh-CN  |             0/9 |           0/9 |           0/0 |              0 |        293.0 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| github        | en-US  |             0/9 |           0/9 |           0/0 |              0 |        333.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| search        | en-US  |             2/9 |           1/9 |           1/2 |              2 |        284.8 ms | agent, chat\_group, topic, message, file, folder, memory                        |
| browser       | en-US  |             0/9 |           0/9 |           0/0 |              0 |        301.4 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| translation   | en-US  |             0/9 |           0/9 |           0/0 |              0 |        292.7 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| data analysis | en-US  |             0/9 |           0/9 |           0/0 |              0 |        327.2 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| coding        | en-US  |             0/9 |           0/9 |           0/0 |              0 |        361.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| image         | en-US  |             0/9 |           0/9 |           0/0 |              0 |        303.5 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| automation    | en-US  |             0/9 |           0/9 |           0/0 |              0 |        291.5 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| research      | en-US  |             0/9 |           0/9 |           0/0 |              0 |        267.8 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |
| notion        | en-US  |             0/9 |           0/9 |           0/0 |              0 |        276.6 ms | agent, chat\_group, topic, message, file, folder, page, memory, knowledge\_base |

### Chinese query matrix

| Query    | agent     | chat\_group | topic     | message   | file      | folder     | page      | memory    | knowledge\_base |
| -------- | --------- | ----------- | --------- | --------- | --------- | ---------- | --------- | --------- | --------------- |
| 翻译     | 0/0/N/306 | 0/0/N/258   | 0/0/N/287 | 0/0/N/525 | 0/0/N/235 | 0/0/N/378  | 0/0/N/424 | 0/0/N/292 | 0/0/N/272       |
| 搜索     | 0/0/N/302 | 0/0/N/271   | 0/0/N/263 | 0/0/N/716 | 0/0/N/236 | 0/0/N/365  | 0/0/N/404 | 0/0/N/274 | 0/0/N/280       |
| 小红书   | 0/0/N/362 | 0/0/N/254   | 0/0/N/323 | 0/0/N/768 | 0/0/N/257 | 0/0/N/487  | 0/0/N/501 | 0/0/N/296 | 0/0/N/302       |
| 数据分析 | 0/0/N/367 | 0/0/N/254   | 0/0/N/271 | 0/0/N/596 | 0/0/N/237 | 0/0/N/426  | 0/0/N/476 | 0/0/N/291 | 0/0/N/269       |
| 编程     | 0/0/N/322 | 0/0/N/248   | 0/0/N/269 | 0/0/N/862 | 0/0/N/240 | 0/0/N/414  | 0/0/N/440 | 0/0/N/283 | 0/0/N/271       |
| 写作     | 0/0/N/503 | 0/0/N/263   | 0/0/N/303 | 0/0/N/522 | 0/0/N/239 | 0/0/N/372  | 0/0/N/416 | 0/0/N/273 | 0/0/N/276       |
| 图片     | 0/0/N/302 | 0/0/N/253   | 0/0/N/266 | 0/0/N/537 | 0/0/N/249 | 0/0/N/362  | 0/0/N/428 | 0/0/N/272 | 0/0/N/366       |
| 视频     | 0/0/N/307 | 0/0/N/249   | 0/0/N/264 | 0/0/N/508 | 0/0/N/273 | 0/0/N/366  | 0/0/N/313 | 0/0/N/254 | 0/0/N/262       |
| 浏览器   | 0/0/N/322 | 0/0/N/269   | 0/0/N/326 | 0/0/N/580 | 0/0/N/234 | 0/0/N/348  | 0/0/N/376 | 0/0/N/264 | 0/0/N/287       |
| 天气     | 0/0/N/293 | 0/0/N/436   | 0/0/N/278 | 0/0/N/368 | 0/0/N/249 | 0/0/N/1098 | 0/0/N/435 | 0/0/N/276 | 0/0/N/276       |

### English query matrix

| Query         | agent     | chat\_group | topic     | message   | file      | folder    | page      | memory    | knowledge\_base |
| ------------- | --------- | ----------- | --------- | --------- | --------- | --------- | --------- | --------- | --------------- |
| github        | 0/0/N/345 | 0/0/N/251   | 0/0/N/298 | 0/0/N/537 | 0/0/N/244 | 0/0/N/378 | 0/0/N/481 | 0/0/N/334 | 0/0/N/276       |
| search        | 0/0/N/341 | 0/0/N/271   | 0/0/N/263 | 0/0/N/585 | 0/0/N/260 | 0/0/N/625 | 1/0/N/454 | 0/0/N/285 | 1/1/Y/277       |
| browser       | 0/0/N/301 | 0/0/N/245   | 0/0/N/301 | 0/0/N/574 | 0/0/N/240 | 0/0/N/376 | 0/0/N/441 | 0/0/N/305 | 0/0/N/275       |
| translation   | 0/0/N/301 | 0/0/N/247   | 0/0/N/263 | 0/0/N/537 | 0/0/N/284 | 0/0/N/388 | 0/0/N/411 | 0/0/N/275 | 0/0/N/293       |
| data analysis | 0/0/N/327 | 0/0/N/247   | 0/0/N/268 | 0/0/N/644 | 0/0/N/261 | 0/0/N/455 | 0/0/N/445 | 0/0/N/346 | 0/0/N/276       |
| coding        | 0/0/N/362 | 0/0/N/752   | 0/0/N/262 | 0/0/N/524 | 0/0/N/282 | 0/0/N/408 | 0/0/N/401 | 0/0/N/302 | 0/0/N/297       |
| image         | 0/0/N/303 | 0/0/N/236   | 0/0/N/269 | 0/0/N/402 | 0/0/N/475 | 0/0/N/305 | 0/0/N/315 | 0/0/N/263 | 0/0/N/283       |
| automation    | 0/0/N/280 | 0/0/N/291   | 0/0/N/246 | 0/0/N/393 | 0/0/N/235 | 0/0/N/356 | 0/0/N/378 | 0/0/N/282 | 0/0/N/298       |
| research      | 0/0/N/270 | 0/0/N/241   | 0/0/N/268 | 0/0/N/378 | 0/0/N/236 | 0/0/N/307 | 0/0/N/314 | 0/0/N/258 | 0/0/N/253       |
| notion        | 0/0/N/271 | 0/0/N/270   | 0/0/N/263 | 0/0/N/540 | 0/0/N/277 | 0/0/N/386 | 0/0/N/317 | 0/0/N/384 | 0/0/N/255       |

## Result coverage

| Measure                        | Value |
| ------------------------------ | ----: |
| Cases                          |   180 |
| Representative results         |     2 |
| Zero-result cases              |   178 |
| Single-result cases            |     2 |
| Multi-result cases             |     0 |
| Cases with at least 10 results |     0 |
| Maximum results in one case    |     1 |

## Latency across cases

These are distributions of each case's stored percentile, not a global request percentile.

| Per-case metric              | Median case | Cross-case p95 | Worst case |
| ---------------------------- | ----------: | -------------: | ---------: |
| Product-path p50             |    299.6 ms |       580.2 ms |  1098.1 ms |
| Product-path p95             |    454.1 ms |      2106.4 ms | 12723.8 ms |
| Database aggregate-work p50  |    299.3 ms |       579.9 ms |  1097.8 ms |
| Hydration aggregate-work p50 |      0.0 ms |         0.0 ms |     0.1 ms |

For multi-entity searches, database and hydration branches run in parallel. Their values are summed work, so they may exceed API wall-clock and must not be reported as user-visible latency.

## Case groups

| Group   | Cases | Zero results | Representative results | Median path p50 | Median path p95 | Worst path p95 |
| ------- | ----: | -----------: | ---------------------: | --------------: | --------------: | -------------: |
| quality |   180 |          178 |                      2 |        299.6 ms |        454.1 ms |     12723.8 ms |

## Query-shape and ranking evidence

Only public fixture labels are shown. Unknown database IDs remain pseudonymous.

| Case | Group | Results | Path p50 | Path p95 | Stored order |
| ---- | ----- | ------: | -------: | -------: | ------------ |

## Slowest product paths

| Case                               | Group   | Results |  Path p50 |  Path p95 |
| ---------------------------------- | ------- | ------: | --------: | --------: |
| quality.folder.zh\_weather         | quality |       0 | 1098.1 ms | 2162.5 ms |
| quality.message.zh\_coding         | quality |       0 |  861.5 ms | 1300.1 ms |
| quality.message.zh\_xiaohongshu    | quality |       0 |  767.8 ms | 2473.5 ms |
| quality.chat\_group.en\_coding     | quality |       0 |  752.2 ms | 1957.2 ms |
| quality.message.zh\_search         | quality |       0 |  716.3 ms | 1528.8 ms |
| quality.message.en\_data\_analysis | quality |       0 |  644.2 ms | 1355.6 ms |
| quality.folder.en\_search          | quality |       0 |  624.9 ms |  797.9 ms |
| quality.message.zh\_data\_analysis | quality |       0 |  596.0 ms | 2607.2 ms |
| quality.message.en\_search         | quality |       0 |  585.2 ms |  992.2 ms |
| quality.message.zh\_browser        | quality |       0 |  579.9 ms | 1354.2 ms |

## Production-size snapshot

Content sample: system 0.5% with repeatable seed 13431 across documents, messages.

| Largest index             | Table          | Estimated rows |       Size |
| ------------------------- | -------------- | -------------: | ---------: |
| messages\_bm25\_idx       | messages       |     25,090,372 |  30.34 GiB |
| documents\_bm25\_idx      | documents      |      1,537,135 |  19.59 GiB |
| agents\_bm25\_idx         | agents         |      1,318,382 |   1.45 GiB |
| topics\_bm25\_idx         | topics         |      1,259,782 | 295.42 MiB |
| user\_memories\_bm25\_idx | user\_memories |        621,010 | 258.14 MiB |
