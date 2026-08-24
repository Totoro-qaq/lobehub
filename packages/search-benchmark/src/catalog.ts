import type { SearchEntity } from '@lobechat/observability-otel/modules/search';

import type { SearchBenchmarkCase } from './types';

export const PG_SEARCH_INDEXES = [
  {
    fields: ['title', 'description', 'slug', 'tags', 'system_role', 'user_id'],
    indexName: 'agents_bm25_idx',
    table: 'agents',
  },
  {
    fields: ['title', 'content', 'description', 'user_id'],
    indexName: 'topics_bm25_idx',
    table: 'topics',
  },
  {
    fields: ['name', 'user_id', 'file_type'],
    indexName: 'files_bm25_idx',
    table: 'files',
  },
  {
    fields: ['name', 'description', 'user_id'],
    indexName: 'knowledge_bases_bm25_idx',
    table: 'knowledge_bases',
  },
  {
    fields: ['title', 'summary', 'details', 'memory_layer', 'memory_category', 'status', 'user_id'],
    indexName: 'user_memories_bm25_idx',
    table: 'user_memories',
  },
  {
    fields: ['title', 'description', 'content', 'user_id'],
    indexName: 'chat_groups_bm25_idx',
    table: 'chat_groups',
  },
  {
    fields: ['title', 'description', 'current_status', 'type', 'user_id'],
    indexName: 'user_memories_contexts_bm25_idx',
    table: 'user_memories_contexts',
  },
  {
    fields: ['conclusion_directives', 'suggestions', 'type', 'user_id'],
    indexName: 'user_memories_preferences_bm25_idx',
    table: 'user_memories_preferences',
  },
  {
    fields: ['notes', 'narrative', 'feedback', 'type', 'status', 'user_id'],
    indexName: 'user_memories_activities_bm25_idx',
    table: 'user_memories_activities',
  },
  {
    fields: ['description', 'role', 'type', 'relationship', 'user_id'],
    indexName: 'user_memories_identities_bm25_idx',
    table: 'user_memories_identities',
  },
  {
    fields: [
      'situation',
      'reasoning',
      'possible_outcome',
      'action',
      'key_learning',
      'type',
      'user_id',
    ],
    indexName: 'user_memories_experiences_bm25_idx',
    table: 'user_memories_experiences',
  },
  {
    fields: ['tagline', 'persona', 'user_id'],
    indexName: 'user_memory_persona_documents_bm25_idx',
    table: 'user_memory_persona_documents',
  },
  {
    fields: ['title', 'description', 'content', 'slug', 'user_id', 'file_type', 'source_type'],
    indexName: 'documents_bm25_idx',
    table: 'documents',
  },
  {
    fields: ['content', 'summary', 'user_id', 'role'],
    indexName: 'messages_bm25_idx',
    table: 'messages',
  },
] as const;

export interface PgSearchCallSite {
  entities: SearchEntity[];
  file: string;
  indexes: string[];
  scope: string;
  symbol: string;
}

export interface PgSearchEntryPoint {
  file: string;
  symbol: string;
}

/** Product entry points which route requests to the BM25 query implementations. */
export const PG_SEARCH_ENTRY_POINTS: PgSearchEntryPoint[] = [
  { file: 'apps/server/src/routers/lambda/search.ts', symbol: 'searchRepo.search' },
  { file: 'apps/server/src/routers/lambda/home.ts', symbol: 'homeRepository.searchAgents' },
  { file: 'apps/server/src/routers/lambda/session.ts', symbol: 'sessionModel.queryByKeyword' },
  { file: 'apps/server/src/routers/lambda/topic.ts', symbol: 'topicModel.queryByKeyword' },
  { file: 'apps/server/src/routers/lambda/message.ts', symbol: 'messageModel.queryByKeyword' },
  { file: 'apps/server/src/routers/lambda/userMemories.ts', symbol: 'memoryModel.queryMemories' },
  { file: 'apps/server/src/routers/lambda/userMemories.ts', symbol: 'memoryModel.searchMemory' },
  {
    file: 'apps/server/src/services/knowledgeBase/index.ts',
    symbol: 'searchRepo.searchKnowledgeBaseDocuments',
  },
];

/** Production paths which currently execute a pg_search query. */
export const PG_SEARCH_CALL_SITES: PgSearchCallSite[] = [
  {
    entities: [
      'agent',
      'chat_group',
      'topic',
      'message',
      'file',
      'folder',
      'page',
      'memory',
      'knowledge_base',
      'document',
    ],
    file: 'packages/database/src/repositories/search/index.ts',
    indexes: [
      'agents_bm25_idx',
      'chat_groups_bm25_idx',
      'topics_bm25_idx',
      'messages_bm25_idx',
      'files_bm25_idx',
      'documents_bm25_idx',
      'knowledge_bases_bm25_idx',
    ],
    scope:
      'personal/workspace ownership, row visibility, agent scope, tool-role exclusion, and restricted-KB exclusion',
    symbol: 'SearchRepo',
  },
  {
    entities: ['agent', 'chat_group'],
    file: 'packages/database/src/repositories/home/index.ts',
    indexes: ['agents_bm25_idx', 'chat_groups_bm25_idx'],
    scope: 'personal/workspace ownership, row visibility, and virtual-agent exclusion',
    symbol: 'HomeRepository.searchAgents',
  },
  {
    entities: ['message'],
    file: 'packages/database/src/models/message.ts',
    indexes: ['messages_bm25_idx'],
    scope: 'personal/workspace ownership and visible parent-agent inheritance',
    symbol: 'MessageModel.queryByKeyword',
  },
  {
    entities: ['session'],
    file: 'packages/database/src/models/session.ts',
    indexes: ['agents_bm25_idx'],
    scope: 'personal/workspace agent visibility and valid session association',
    symbol: 'SessionModel.queryByKeyword',
  },
  {
    entities: ['topic', 'message'],
    file: 'packages/database/src/models/topic.ts',
    indexes: ['topics_bm25_idx', 'messages_bm25_idx'],
    scope:
      'personal/workspace ownership, visible parent-agent inheritance, and container/agent/group scope',
    symbol: 'TopicModel.queryByKeyword',
  },
  {
    entities: ['memory_activity'],
    file: 'packages/database/src/models/userMemory/activity.ts',
    indexes: ['user_memories_bm25_idx', 'user_memories_activities_bm25_idx'],
    scope: 'user ownership plus activity type/status/tag filters',
    symbol: 'UserMemoryActivityModel.queryList',
  },
  {
    entities: ['memory_experience'],
    file: 'packages/database/src/models/userMemory/experience.ts',
    indexes: ['user_memories_bm25_idx', 'user_memories_experiences_bm25_idx'],
    scope: 'user ownership plus experience type/tag filters',
    symbol: 'UserMemoryExperienceModel.queryList',
  },
  {
    entities: ['memory_identity'],
    file: 'packages/database/src/models/userMemory/identity.ts',
    indexes: ['user_memories_bm25_idx', 'user_memories_identities_bm25_idx'],
    scope: 'user ownership plus identity type/relationship/tag filters',
    symbol: 'UserMemoryIdentityModel.queryList',
  },
  {
    entities: [
      'memory_activity',
      'memory_context',
      'memory_experience',
      'memory_identity',
      'memory_preference',
    ],
    file: 'packages/database/src/models/userMemory/model.ts',
    indexes: [
      'user_memories_bm25_idx',
      'user_memories_activities_bm25_idx',
      'user_memories_contexts_bm25_idx',
      'user_memories_experiences_bm25_idx',
      'user_memories_identities_bm25_idx',
      'user_memories_preferences_bm25_idx',
    ],
    scope: 'user ownership plus memory layer/category/status/type/tag filters',
    symbol: 'UserMemoryModel.queryMemories',
  },
  {
    entities: [
      'memory_activity',
      'memory_context',
      'memory_experience',
      'memory_identity',
      'memory_preference',
    ],
    file: 'packages/database/src/models/userMemory/query.ts',
    indexes: [
      'user_memories_bm25_idx',
      'user_memories_activities_bm25_idx',
      'user_memories_contexts_bm25_idx',
      'user_memories_experiences_bm25_idx',
      'user_memories_identities_bm25_idx',
      'user_memories_preferences_bm25_idx',
    ],
    scope: 'user ownership plus layer-specific taxonomy/time filters; lexical leg only',
    symbol: 'UserMemoryQueryModel.searchMemory (lexical leg)',
  },
];

const positive = (id: string, description: string, entity: SearchEntity): SearchBenchmarkCase => ({
  actor: 'owner',
  description,
  entity,
  expectation: { includes: ['primary'], minResultCount: 1 },
  group: 'entity',
  id,
  requestKey: id,
});

export const SEARCH_BENCHMARK_CASES: SearchBenchmarkCase[] = [
  {
    ...positive('query.zh_continuous', 'Continuous Chinese terms use ICU tokenization', 'agent'),
    group: 'query_shape',
    queryShape: 'chinese_continuous',
  },
  {
    ...positive('query.en_stemming', 'English inflections preserve stemming behavior', 'agent'),
    group: 'query_shape',
    queryShape: 'english_words',
  },
  {
    ...positive('query.exact_phrase', 'Exact phrase behavior remains stable', 'message'),
    group: 'query_shape',
    queryShape: 'quoted_phrase',
  },
  {
    ...positive('query.special_characters', 'Special characters remain safely searchable', 'file'),
    group: 'query_shape',
    queryShape: 'special_characters',
  },
  {
    ...positive('query.long', 'Long queries remain bounded and deterministic', 'document'),
    group: 'query_shape',
    queryShape: 'long',
  },
  {
    ...positive('ranking.title_weight', 'A title match ranks ahead of a body-only match', 'agent'),
    expectation: { includes: ['title_match', 'body_match'], minResultCount: 2 },
    group: 'ranking',
  },
  {
    ...positive(
      'ranking.rare_term',
      'Rare terms preserve their current result ordering',
      'document',
    ),
    group: 'ranking',
  },
  {
    ...positive(
      'ranking.frequent_term',
      'High-frequency terms preserve their current cutoff',
      'message',
    ),
    group: 'ranking',
  },
  {
    actor: 'owner',
    description: 'A query with no match returns an empty result set',
    entity: 'all',
    expectation: { maxResultCount: 0 },
    group: 'result_state',
    id: 'result.zero',
    requestKey: 'result.zero',
  },
  {
    ...positive('callsite.home', 'Home agent and chat-group search', 'all'),
    group: 'callsite',
  },
  {
    ...positive('callsite.legacy_session', 'Legacy session keyword search', 'session'),
    group: 'callsite',
  },
  {
    ...positive('callsite.legacy_topic', 'Legacy topic keyword search', 'topic'),
    group: 'callsite',
  },
  {
    ...positive('callsite.legacy_message', 'Legacy message keyword search', 'message'),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_activity_direct',
      'Activity list keyword search',
      'memory_activity',
    ),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_experience_direct',
      'Experience list keyword search',
      'memory_experience',
    ),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_identity_direct',
      'Identity list keyword search',
      'memory_identity',
    ),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_activity_list',
      'Layered activity keyword search',
      'memory_activity',
    ),
    group: 'callsite',
  },
  {
    ...positive('callsite.memory_context_list', 'Layered context keyword search', 'memory_context'),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_experience_list',
      'Layered experience keyword search',
      'memory_experience',
    ),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_identity_list',
      'Layered identity keyword search',
      'memory_identity',
    ),
    group: 'callsite',
  },
  {
    ...positive(
      'callsite.memory_preference_list',
      'Layered preference keyword search',
      'memory_preference',
    ),
    group: 'callsite',
  },
  {
    ...positive('callsite.memory_hybrid', 'Hybrid memory lexical leg', 'memory'),
    group: 'callsite',
  },
  positive('entity.agent', 'Agent search result and hydration', 'agent'),
  positive('entity.chat_group', 'Chat group search result and hydration', 'chat_group'),
  positive('entity.topic', 'Topic search result and hydration', 'topic'),
  positive('entity.message', 'Message search result and hydration', 'message'),
  positive('entity.file', 'File search result and hydration', 'file'),
  positive('entity.folder', 'Folder search result and hydration', 'folder'),
  positive('entity.page', 'Page search result and hydration', 'page'),
  positive('entity.knowledge_base', 'Knowledge base search result and hydration', 'knowledge_base'),
  positive('entity.document_inline', 'Direct knowledge-base document search', 'document'),
  positive('entity.document_file_backed', 'File-backed knowledge-base document search', 'document'),
  {
    actor: 'owner',
    description: 'A document reachable through two knowledge-base paths is returned once',
    entity: 'document',
    expectation: { includes: ['deduplicated_document'], maxResultCount: 1, minResultCount: 1 },
    group: 'entity',
    id: 'entity.document_deduplicated',
    requestKey: 'entity.document_deduplicated',
  },
  positive('entity.memory', 'User memory search result and hydration', 'memory'),
  {
    actor: 'owner',
    description: 'Tool-role messages remain excluded from user-facing search',
    entity: 'message',
    expectation: { excludes: ['tool_message'] },
    group: 'permission',
    id: 'permission.tool_message_excluded',
    requestKey: 'permission.tool_message_excluded',
  },
  {
    actor: 'workspace_member',
    description: 'A workspace member can find an explicitly shared knowledge base',
    entity: 'knowledge_base',
    expectation: { includes: ['shared_knowledge_base'], minResultCount: 1 },
    group: 'permission',
    id: 'permission.workspace_allowed',
    requestKey: 'permission.workspace_allowed',
  },
  {
    actor: 'workspace_member',
    description: 'A workspace member can discover a public agent',
    entity: 'agent',
    expectation: { includes: ['public_agent'], minResultCount: 1 },
    group: 'permission',
    id: 'permission.public_agent',
    queryGroup: 'agent_visibility',
    requestKey: 'permission.public_agent',
  },
  {
    actor: 'workspace_member',
    description: 'A workspace member cannot discover another member private agent',
    entity: 'agent',
    expectation: { excludes: ['private_agent'] },
    group: 'permission',
    id: 'permission.private_agent',
    queryGroup: 'agent_visibility',
    requestKey: 'permission.private_agent',
  },
  {
    actor: 'workspace_member',
    description: 'A private agent topic inherits the parent visibility restriction',
    entity: 'topic',
    expectation: { excludes: ['private_agent_topic'] },
    group: 'permission',
    id: 'permission.private_agent_topic',
    queryGroup: 'private_agent_descendants',
    requestKey: 'permission.private_agent_topic',
  },
  {
    actor: 'workspace_member',
    description: 'A private agent message inherits the parent visibility restriction',
    entity: 'message',
    expectation: { excludes: ['private_agent_message'] },
    group: 'permission',
    id: 'permission.private_agent_message',
    queryGroup: 'private_agent_descendants',
    requestKey: 'permission.private_agent_message',
  },
  {
    actor: 'workspace_member',
    description: 'Legacy topic search preserves private agent inheritance',
    entity: 'topic',
    expectation: { excludes: ['private_agent_topic'] },
    group: 'permission',
    id: 'permission.legacy_private_agent_topic',
    queryGroup: 'private_agent_descendants',
    requestKey: 'permission.legacy_private_agent_topic',
  },
  {
    actor: 'workspace_member',
    description: 'Legacy message search preserves private agent inheritance',
    entity: 'message',
    expectation: { excludes: ['private_agent_message'] },
    group: 'permission',
    id: 'permission.legacy_private_agent_message',
    queryGroup: 'private_agent_descendants',
    requestKey: 'permission.legacy_private_agent_message',
  },
  {
    actor: 'workspace_member',
    description: 'A public knowledge base remains discoverable to an allowed caller',
    entity: 'knowledge_base',
    expectation: { includes: ['public_knowledge_base'], minResultCount: 1 },
    group: 'permission',
    id: 'permission.public_knowledge_base',
    queryGroup: 'knowledge_base_visibility',
    requestKey: 'permission.public_knowledge_base',
  },
  {
    actor: 'workspace_member',
    description: 'A private knowledge base is not discoverable to another user',
    entity: 'knowledge_base',
    expectation: { excludes: ['private_knowledge_base'] },
    group: 'permission',
    id: 'permission.private_knowledge_base',
    queryGroup: 'knowledge_base_visibility',
    requestKey: 'permission.private_knowledge_base',
  },
  {
    actor: 'workspace_member',
    description: 'An allowed agent-scoped query can find its own topic',
    entity: 'topic',
    expectation: { includes: ['agent_topic'], minResultCount: 1 },
    group: 'permission',
    id: 'permission.agent_scope_allowed',
    queryGroup: 'agent_scope',
    requestKey: 'permission.agent_scope_allowed',
  },
  {
    actor: 'workspace_member',
    description: 'An agent-scoped query cannot find another agent topic',
    entity: 'topic',
    expectation: { excludes: ['other_agent_topic'] },
    group: 'permission',
    id: 'permission.agent_scope_denied',
    queryGroup: 'agent_scope',
    requestKey: 'permission.agent_scope_denied',
  },
  {
    actor: 'workspace_member',
    description: 'A no-access knowledge base is not discoverable',
    entity: 'knowledge_base',
    expectation: { excludes: ['restricted_knowledge_base'] },
    group: 'permission',
    id: 'permission.workspace_denied',
    requestKey: 'permission.workspace_denied',
  },
  {
    actor: 'workspace_member',
    description: 'Files linked only to a restricted knowledge base are not discoverable',
    entity: 'file',
    expectation: { excludes: ['restricted_file'] },
    group: 'permission',
    id: 'permission.restricted_file',
    requestKey: 'permission.restricted_file',
  },
  {
    actor: 'workspace_member',
    description: 'Folders linked only to a restricted knowledge base are not discoverable',
    entity: 'folder',
    expectation: { excludes: ['restricted_folder'] },
    group: 'permission',
    id: 'permission.restricted_folder',
    requestKey: 'permission.restricted_folder',
  },
  {
    actor: 'workspace_member',
    description: 'Pages linked only to a restricted knowledge base are not discoverable',
    entity: 'page',
    expectation: { excludes: ['restricted_page'] },
    group: 'permission',
    id: 'permission.restricted_page',
    requestKey: 'permission.restricted_page',
  },
  {
    actor: 'other_user',
    description: 'Another user cannot find personal search data',
    entity: 'all',
    expectation: { excludes: ['owner_private_result'] },
    group: 'permission',
    id: 'permission.personal_isolation',
    requestKey: 'permission.personal_isolation',
  },
  {
    actor: 'former_member',
    description: 'Revoked workspace access immediately removes search visibility',
    entity: 'all',
    expectation: { excludes: ['revoked_result'] },
    group: 'permission',
    id: 'permission.revoked_access',
    requestKey: 'permission.revoked_access',
  },
  {
    actor: 'owner',
    description: 'Deleted records do not remain in search results',
    entity: 'all',
    expectation: { excludes: ['deleted_result'] },
    group: 'permission',
    id: 'permission.deleted_object',
    requestKey: 'permission.deleted_object',
  },
  {
    actor: 'owner',
    description: 'Unknown IDs cannot broaden the caller search scope',
    entity: 'all',
    expectation: { excludes: ['unrelated_result'] },
    group: 'permission',
    id: 'permission.nonexistent_scope',
    requestKey: 'permission.nonexistent_scope',
  },
];

export const SEARCH_BENCHMARK_FIXTURE_VERSION = 'pg-search-v1';
