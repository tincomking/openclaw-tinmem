/**
 * Tests for memory deduplicator
 */

import { describe, it, expect, jest } from '@jest/globals';
import { MemoryDeduplicator } from '../src/memory/deduplicator.js';
import type { TinmemConfig } from '../src/config.js';
import type { Memory } from '../src/types.js';
import type { TinmemDB } from '../src/memory/db.js';
import type { EmbeddingService } from '../src/embeddings.js';
import type { LLMService } from '../src/llm.js';

function makeConfig(strategy: 'llm' | 'vector' | 'both' = 'llm'): TinmemConfig {
  return {
    dbPath: '/tmp/test-tinmem',
    defaultScope: 'global',
    embedding: { provider: 'openai', apiKey: 'test', model: 'text-embedding-3-small', dimensions: 1536 },
    llm: { apiKey: 'test', model: 'gpt-4o-mini', maxTokens: 2048, temperature: 0.1 },
    deduplication: { strategy, similarityThreshold: 0.85, llmThreshold: 0.90 },
    retrieval: { limit: 10, minScore: 0.3, hybrid: true, candidateMultiplier: 3 },
    scoring: {
      vectorWeight: 0.4, bm25Weight: 0.3, rerankerWeight: 0.3,
      recencyBoostDays: 7, recencyBoostFactor: 0.15,
      importanceWeight: 0.2, timePenaltyDays: 90, timePenaltyFactor: 0.2,
    },
    capture: {
      auto: true, sessionSummary: true, noiseFilter: true,
      minContentLength: 20,
      skipPatterns: [],
    },
    autoRecall: true,
    recallLimit: 8,
    recallMinScore: 0.4,
    debug: false,
  } as TinmemConfig;
}

function makeMemory(overrides: Partial<Memory & { _distance: number }>): Memory & { _distance: number } {
  return {
    id: 'existing-id',
    headline: 'Existing memory headline',
    summary: 'Existing memory summary',
    content: 'Existing memory content',
    category: 'preferences',
    scope: 'global',
    importance: 0.7,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
    accessCount: 2,
    lastAccessedAt: Date.now() - 86400000,
    tags: ['existing'],
    metadata: {},
    _distance: 0.1,
    ...overrides,
  };
}

// Helper to create typed mocks
function makeMockDb(returnValue: Array<Memory & { _distance: number }> = []): Pick<TinmemDB, 'vectorSearch'> {
  return {
    vectorSearch: jest.fn<TinmemDB['vectorSearch']>().mockResolvedValue(returnValue),
  };
}

function makeMockEmbedding(): Pick<EmbeddingService, 'embed' | 'embedBatch' | 'dimensions' | 'provider'> {
  return {
    embed: jest.fn<EmbeddingService['embed']>().mockResolvedValue([]),
    embedBatch: jest.fn<EmbeddingService['embedBatch']>().mockResolvedValue([]),
    dimensions: 1536,
    provider: 'openai',
  };
}

function makeMockLlm(response = '{}'): Pick<LLMService, 'complete'> {
  return {
    complete: jest.fn<LLMService['complete']>().mockResolvedValue(response),
  };
}

describe('MemoryDeduplicator', () => {
  const vector = Array.from({ length: 10 }, (_, i) => i * 0.1);

  describe('with append-only categories', () => {
    it('should always CREATE for events', async () => {
      const mockDb = makeMockDb();
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm();

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig(),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'Product launched successfully',
          summary: 'Summary',
          content: 'Content',
          category: 'events',
          importance: 0.8,
          tags: [],
        },
        vector,
        'global',
      );

      expect(result.decision).toBe('CREATE');
      expect(result.reason).toContain('Append-only');
      expect(mockDb.vectorSearch).not.toHaveBeenCalled();
    });

    it('should always CREATE for cases', async () => {
      const mockDb = makeMockDb();
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm();

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig(),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'Fixed memory leak in React component',
          summary: 'Summary',
          content: 'Content',
          category: 'cases',
          importance: 0.9,
          tags: [],
        },
        vector,
        'global',
      );

      expect(result.decision).toBe('CREATE');
      expect(mockDb.vectorSearch).not.toHaveBeenCalled();
    });
  });

  describe('with no similar memories', () => {
    it('should CREATE when no candidates found', async () => {
      const mockDb = makeMockDb([]); // returns empty
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm();

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig(),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'User prefers React over Vue',
          summary: 'Summary',
          content: 'Content',
          category: 'preferences',
          importance: 0.7,
          tags: [],
        },
        vector,
        'global',
      );

      expect(result.decision).toBe('CREATE');
      expect(result.reason).toContain('No similar memories');
    });
  });

  describe('with vector strategy', () => {
    it('should auto-MERGE when similarity is above threshold', async () => {
      const similar = [makeMemory({ _distance: 0.1 })]; // 0.9 similarity
      const mockDb = makeMockDb(similar);
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm();

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig('vector'),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'User prefers dark mode',
          summary: 'Summary',
          content: 'Content',
          category: 'preferences',
          importance: 0.7,
          tags: ['dark-mode'],
        },
        vector,
        'global',
      );

      expect(result.decision).toBe('MERGE');
      expect(result.targetId).toBe('existing-id');
      expect(mockLlm.complete).not.toHaveBeenCalled();
    });
  });

  describe('with LLM strategy', () => {
    it('should call LLM for CREATE decision', async () => {
      const similar = [makeMemory({ _distance: 0.1 })];
      const mockDb = makeMockDb(similar);
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm(JSON.stringify({ decision: 'CREATE', reason: 'Different topic' }));

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig('llm'),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'User prefers dark mode',
          summary: 'Summary',
          content: 'Content',
          category: 'preferences',
          importance: 0.7,
          tags: [],
        },
        vector,
        'global',
      );

      expect(mockLlm.complete).toHaveBeenCalled();
      expect(result.decision).toBe('CREATE');
    });

    it('should call LLM for MERGE decision with merged content', async () => {
      const similar = [makeMemory({ _distance: 0.1 })];
      const mockDb = makeMockDb(similar);
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = makeMockLlm(JSON.stringify({
        decision: 'MERGE',
        targetId: 'existing-id',
        mergedHeadline: 'Merged headline',
        mergedSummary: 'Merged summary',
        mergedContent: 'Merged full content',
        mergedTags: ['merged', 'tag'],
        reason: 'Same topic, merging',
      }));

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig('llm'),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'User prefers dark mode',
          summary: 'Summary',
          content: 'Content',
          category: 'preferences',
          importance: 0.7,
          tags: [],
        },
        vector,
        'global',
      );

      expect(result.decision).toBe('MERGE');
      expect(result.targetId).toBe('existing-id');
      expect(result.mergedHeadline).toBe('Merged headline');
      expect(result.mergedTags).toContain('merged');
    });

    it('should handle LLM errors by defaulting to CREATE', async () => {
      const similar = [makeMemory({ _distance: 0.1 })];
      const mockDb = makeMockDb(similar);
      const mockEmbedding = makeMockEmbedding();
      const mockLlm = {
        complete: jest.fn<LLMService['complete']>().mockRejectedValue(new Error('LLM Error')),
      };

      const dedup = new MemoryDeduplicator(
        mockDb as unknown as TinmemDB,
        mockEmbedding as unknown as EmbeddingService,
        mockLlm as unknown as LLMService,
        makeConfig('llm'),
      );

      const result = await dedup.deduplicate(
        {
          headline: 'User prefers dark mode',
          summary: 'Summary',
          content: 'Content',
          category: 'preferences',
          importance: 0.7,
          tags: [],
        },
        vector,
        'global',
      );

      // On error, should default to CREATE to avoid data loss
      expect(result.decision).toBe('CREATE');
    });
  });
});
