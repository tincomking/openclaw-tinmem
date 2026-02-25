/**
 * openclaw-tinmem - Core type definitions
 * Combines epro-memory's categorization with memory-lancedb-pro's retrieval
 */

// ─── Memory Categories ──────────────────────────────────────────────────────

/**
 * Six-category memory classification (from epro-memory):
 * - profile: User identity/attributes (always merge)
 * - preferences: User habits/tendencies (topic-based merge)
 * - entities: Projects/people/organizations (merge-supported)
 * - events: Decisions/milestones (append-only)
 * - cases: Problem-solution pairs (append-only)
 * - patterns: Reusable methodologies (merge-supported)
 */
export type MemoryCategory =
  | 'profile'
  | 'preferences'
  | 'entities'
  | 'events'
  | 'cases'
  | 'patterns';

// ─── Abstraction Levels ──────────────────────────────────────────────────────

/**
 * Three-tier abstraction (from epro-memory):
 * - L0: One-sentence headline summary
 * - L1: Structured summary with key fields
 * - L2: Complete narrative / full content
 */
export type AbstractionLevel = 'L0' | 'L1' | 'L2';

// ─── Memory Scope ────────────────────────────────────────────────────────────

/**
 * Multi-scope isolation (from memory-lancedb-pro):
 * - global: Shared across all agents
 * - agent:<id>: Private to a specific agent
 * - project:<id>: Project-level memories
 * - user:<id>: User-level memories
 * - custom:<name>: Custom named namespaces
 */
export type MemoryScope =
  | 'global'
  | `agent:${string}`
  | `project:${string}`
  | `user:${string}`
  | `custom:${string}`;

// ─── Core Memory Record ──────────────────────────────────────────────────────

export interface Memory {
  /** Unique identifier (UUID v4) */
  id: string;

  /** L0: One-sentence headline */
  headline: string;

  /** L1: Structured summary */
  summary: string;

  /** L2: Full narrative content */
  content: string;

  /** Memory category */
  category: MemoryCategory;

  /** Memory scope for isolation */
  scope: MemoryScope;

  /** Importance score 0.0-1.0 (set by LLM during extraction) */
  importance: number;

  /** Creation timestamp (unix ms) */
  createdAt: number;

  /** Last update timestamp (unix ms) */
  updatedAt: number;

  /** Number of times this memory was accessed */
  accessCount: number;

  /** Last access timestamp (unix ms) */
  lastAccessedAt: number;

  /** Searchable tags */
  tags: string[];

  /** Arbitrary metadata */
  metadata: Record<string, unknown>;

  /** Embedding vector (not returned in queries by default) */
  vector?: number[];
}

// ─── Memory for DB storage (with required vector) ───────────────────────────

export interface MemoryRecord extends Memory {
  vector: number[];
}

// ─── Deduplication ──────────────────────────────────────────────────────────

export type DedupDecision = 'CREATE' | 'MERGE' | 'SKIP';

export interface DedupResult {
  decision: DedupDecision;
  targetId?: string;       // For MERGE: which existing memory to merge into
  mergedContent?: string;  // For MERGE: the merged L2 content
  mergedSummary?: string;  // For MERGE: the merged L1 summary
  mergedHeadline?: string; // For MERGE: the merged L0 headline
  mergedTags?: string[];   // For MERGE: combined tags
  reason?: string;         // Explanation for the decision
}

// ─── Extraction Results ──────────────────────────────────────────────────────

export interface ExtractedMemory {
  headline: string;
  summary: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

// ─── Retrieval ───────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  scope?: MemoryScope | MemoryScope[];
  categories?: MemoryCategory[];
  limit?: number;
  minScore?: number;
  level?: AbstractionLevel;
}

export interface ScoredMemory extends Memory {
  score: number;
  vectorScore: number;
  bm25Score: number;
  rerankScore?: number;
  recencyBoost: number;
  importanceBoost: number;
}

export interface RetrievalResult {
  memories: ScoredMemory[];
  query: string;
  totalFound: number;
  timingMs: number;
}

// ─── Context Injection ───────────────────────────────────────────────────────

export interface InjectedContext {
  text: string;
  memoryIds: string[];
  categories: MemoryCategory[];
}

// ─── Hook Payloads (OpenClaw compatible) ────────────────────────────────────

export interface BeforeAgentStartPayload {
  sessionId: string;
  agentId?: string;
  userMessage: string;
  conversationHistory?: ConversationTurn[];
}

export interface AgentEndPayload {
  sessionId: string;
  agentId?: string;
  userMessage: string;
  assistantResponse: string;
  conversationHistory?: ConversationTurn[];
  toolCalls?: unknown[];
}

export interface CommandNewPayload {
  sessionId: string;
  previousSessionId?: string;
  conversationSummary?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

// ─── CLI Types ────────────────────────────────────────────────────────────────

export interface MemoryStats {
  total: number;
  byCategory: Record<MemoryCategory, number>;
  byScope: Record<string, number>;
  oldestMemory?: number;
  newestMemory?: number;
  avgImportance: number;
  dbSizeBytes?: number;
}

export interface ExportData {
  version: string;
  exportedAt: number;
  memories: Memory[];
  stats: MemoryStats;
}

// ─── Tool Definitions (OpenClaw agent tools) ─────────────────────────────────

export interface MemoryRecallInput {
  query: string;
  scope?: MemoryScope | MemoryScope[];
  categories?: MemoryCategory[];
  limit?: number;
  level?: AbstractionLevel;
}

export interface MemoryStoreInput {
  content: string;
  category: MemoryCategory;
  scope?: MemoryScope;
  importance?: number;
  tags?: string[];
}

export interface MemoryForgetInput {
  id?: string;
  query?: string;
  scope?: MemoryScope;
  categories?: MemoryCategory[];
}

export interface MemoryUpdateInput {
  id: string;
  content?: string;
  summary?: string;
  headline?: string;
  importance?: number;
  tags?: string[];
}
