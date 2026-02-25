/**
 * openclaw-tinmem - Main entry point
 *
 * A powerful memory system for OpenClaw that combines:
 * - epro-memory's 6-category structured classification & LLM deduplication
 * - memory-lancedb-pro's hybrid retrieval engine & multi-scope isolation
 *
 * @example
 * ```typescript
 * import { createTinmem } from 'openclaw-tinmem';
 *
 * const tinmem = await createTinmem({
 *   embedding: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
 *   llm: { apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * // Store memories
 * await tinmem.store('User prefers TypeScript over JavaScript', 'preferences');
 *
 * // Recall memories
 * const result = await tinmem.recall('programming preferences');
 * console.log(result.memories);
 * ```
 */

export { MemoryManager, getMemoryManager, resetMemoryManager } from './memory/manager.js';
export { TinmemDB, getDB } from './memory/db.js';
export { MemoryExtractor } from './memory/extractor.js';
export { MemoryDeduplicator } from './memory/deduplicator.js';
export { MemoryRetriever } from './memory/retriever.js';
export { MemoryScorer } from './memory/scorer.js';
export { createEmbeddingService, cosineSimilarity, normalizeVector } from './embeddings.js';
export { createLLMService } from './llm.js';
export { createReranker } from './reranker.js';
export { loadConfig, generateSampleConfig } from './config.js';
export type { TinmemConfig } from './config.js';
export { TOOL_DEFINITIONS, MemoryTools } from './tools/index.js';
export { handleBeforeAgentStart, openclaw_before_agent_start } from './hooks/before-agent-start.js';
export { handleAgentEnd, openclaw_agent_end } from './hooks/agent-end.js';
export { handleCommandNew, openclaw_command_new } from './hooks/command-new.js';
export * from './types.js';

// ─── Convenience Factory ──────────────────────────────────────────────────────

import { loadConfig } from './config.js';
import { getMemoryManager } from './memory/manager.js';
import type { TinmemConfig } from './config.js';

/**
 * Create a fully initialized TinmemManager instance.
 */
export async function createTinmem(
  configOrPath?: Partial<TinmemConfig> | string,
): Promise<import('./memory/manager.js').MemoryManager> {
  let config: TinmemConfig;

  if (typeof configOrPath === 'string') {
    config = loadConfig(configOrPath);
  } else if (configOrPath && typeof configOrPath === 'object') {
    // Merge partial config with defaults via env + defaults
    const base = loadConfig();
    config = { ...base, ...configOrPath } as TinmemConfig;
  } else {
    config = loadConfig();
  }

  return getMemoryManager(config);
}
