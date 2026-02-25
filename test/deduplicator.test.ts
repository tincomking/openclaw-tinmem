/**
 * Tests for memory deduplicator
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MemoryDeduplicator } from '../src/memory/deduplicator.js';
import type { TinmemConfig } from '../src/config.js';
import type { Memory } from '../src/types.js';

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
    _distance: 0.1, // high similarity (distance = 1 - similarity)
    ...overrides,
  };
}

describe('MemoryDeduplicator', () => {
  const vector = Array.from({ length: 10 }, (_, i) => i * 0.1);

  describe('with append-only categories', () => {
    it('should always CREATE for events', async () => {
      const mockDb = { vectorSearch: jest.fn() } as never;
      const mockEmbedding = { embed: jest.fn(), embedBatch: jest.fn(), dimensions: 1536, provider: 'openai' } as never;
      const mockLlm = { complete: jest.fn() } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig());

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
      const mockDb = { vectorSearch: jest.fn() } as never;
      const mockEmbedding = {} as never;
      const mockLlm = { complete: jest.fn() } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig());

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
    });
  });

  describe('with no similar memories', () => {
    it('should CREATE when no candidates found', async () => {
      const mockDb = {
        vectorSearch: jest.fn<() => Promise<Array<Memory & { _distance: number }>>>().mockResolvedValue([]),
      } as never;
      const mockEmbedding = {} as never;
      const mockLlm = { complete: jest.fn() } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig());

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
      const mockDb = {
        vectorSearch: jest.fn<() => Promise<typeof similar>>().mockResolvedValue(similar),
      } as never;
      const mockEmbedding = {} as never;
      const mockLlm = { complete: jest.fn() } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig('vector'));

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
      const mockDb = {
        vectorSearch: jest.fn<() => Promise<typeof similar>>().mockResolvedValue(similar),
      } as never;
      const mockEmbedding = {} as never;
      const mockLlm = {
        complete: jest.fn<() => Promise<string>>().mockResolvedValue(
          JSON.stringify({ decision: 'CREATE', reason: 'Different topic' })
        ),
      } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig('llm'));

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
      const mockDb = {
        vectorSearch: jest.fn<() => Promise<typeof similar>>().mockResolvedValue(similar),
      } as never;
      const mockEmbedding = {} as never;
      const mockLlm = {
        complete: jest.fn<() => Promise<string>>().mockResolvedValue(
          JSON.stringify({
            decision: 'MERGE',
            targetId: 'existing-id',
            mergedHeadline: 'Merged headline',
            mergedSummary: 'Merged summary',
            mergedContent: 'Merged full content',
            mergedTags: ['merged', 'tag'],
            reason: 'Same topic, merging',
          })
        ),
      } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig('llm'));

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
      const mockDb = {
        vectorSearch: jest.fn<() => Promise<typeof similar>>().mockResolvedValue(similar),
      } as never;
      const mockEmbedding = {} as never;
      const mockLlm = {
        complete: jest.fn<() => Promise<string>>().mockRejectedValue(new Error('LLM Error')),
      } as never;

      const dedup = new MemoryDeduplicator(mockDb, mockEmbedding, mockLlm, makeConfig('llm'));

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
