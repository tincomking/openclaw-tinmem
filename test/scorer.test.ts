/**
 * Tests for multi-stage scoring pipeline
 */

import { describe, it, expect } from '@jest/globals';
import { MemoryScorer } from '../src/memory/scorer.js';
import type { Memory } from '../src/types.js';

const BASE_CONFIG = {
  scoring: {
    vectorWeight: 0.4,
    bm25Weight: 0.3,
    rerankerWeight: 0.3,
    recencyBoostDays: 7,
    recencyBoostFactor: 0.15,
    importanceWeight: 0.2,
    timePenaltyDays: 90,
    timePenaltyFactor: 0.2,
  },
  retrieval: {
    limit: 10,
    minScore: 0.3,
    hybrid: true,
    candidateMultiplier: 3,
  },
} as Parameters<typeof MemoryScorer>[0];

function makeMemory(overrides: Partial<Memory & { vectorScore: number; bm25Score: number }>): Memory & { vectorScore: number; bm25Score: number } {
  const now = Date.now();
  return {
    id: 'test-id',
    headline: 'Test headline',
    summary: 'Test summary',
    content: 'Test content',
    category: 'events',
    scope: 'global',
    importance: 0.5,
    createdAt: now - 10 * 86400000,
    updatedAt: now - 5 * 86400000,
    accessCount: 1,
    lastAccessedAt: now - 2 * 86400000,
    tags: [],
    metadata: {},
    vectorScore: 0.8,
    bm25Score: 0.6,
    ...overrides,
  };
}

describe('MemoryScorer', () => {
  const scorer = new MemoryScorer(BASE_CONFIG);

  describe('score()', () => {
    it('should combine vector and BM25 scores', () => {
      const memory = makeMemory({ vectorScore: 0.8, bm25Score: 0.6, importance: 0 });
      const scored = scorer.score([memory]);

      expect(scored[0]).toBeDefined();
      // base = 0.8*0.4 + 0.6*0.3 = 0.32 + 0.18 = 0.5 (normalized: v=0.4/0.7, b=0.3/0.7)
      expect(scored[0]!.score).toBeGreaterThan(0);
      expect(scored[0]!.score).toBeLessThanOrEqual(1);
    });

    it('should apply recency boost for recently accessed memories', () => {
      const recentMemory = makeMemory({
        lastAccessedAt: Date.now() - 1 * 86400000, // 1 day ago
        importance: 0,
      });
      const oldMemory = makeMemory({
        lastAccessedAt: Date.now() - 30 * 86400000, // 30 days ago
        importance: 0,
      });

      const [scoredRecent] = scorer.score([recentMemory]);
      const [scoredOld] = scorer.score([oldMemory]);

      expect(scoredRecent!.score).toBeGreaterThan(scoredOld!.score);
      expect(scoredRecent!.recencyBoost).toBeGreaterThan(0);
      expect(scoredOld!.recencyBoost).toBe(0);
    });

    it('should apply importance boost', () => {
      const highImportance = makeMemory({ importance: 0.9 });
      const lowImportance = makeMemory({ importance: 0.1 });

      const [scoredHigh] = scorer.score([highImportance]);
      const [scoredLow] = scorer.score([lowImportance]);

      expect(scoredHigh!.score).toBeGreaterThan(scoredLow!.score);
      expect(scoredHigh!.importanceBoost).toBeGreaterThan(scoredLow!.importanceBoost);
    });

    it('should apply time decay for very old memories', () => {
      const newMemory = makeMemory({
        createdAt: Date.now() - 10 * 86400000, // 10 days
        importance: 0,
      });
      const veryOldMemory = makeMemory({
        createdAt: Date.now() - 365 * 86400000, // 1 year
        importance: 0,
      });

      const [scoredNew] = scorer.score([newMemory]);
      const [scoredOld] = scorer.score([veryOldMemory]);

      expect(scoredNew!.score).toBeGreaterThan(scoredOld!.score);
    });

    it('should include reranker scores when provided', () => {
      const memory = makeMemory({ id: 'mem-1' });
      const rerankScores = new Map([['mem-1', 0.95]]);

      const scored = scorer.score([memory], rerankScores);
      expect(scored[0]!.rerankScore).toBe(0.95);
    });

    it('should sort memories by final score (descending)', () => {
      const memories = [
        makeMemory({ id: 'a', importance: 0.1, vectorScore: 0.5 }),
        makeMemory({ id: 'b', importance: 0.9, vectorScore: 0.9, lastAccessedAt: Date.now() }),
        makeMemory({ id: 'c', importance: 0.5, vectorScore: 0.7 }),
      ];

      const scored = scorer.score(memories);
      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1]!.score).toBeGreaterThanOrEqual(scored[i]!.score);
      }
    });

    it('should return scores in [0, 1] range', () => {
      const memory = makeMemory({
        importance: 1.0,
        lastAccessedAt: Date.now(),
        vectorScore: 1.0,
        bm25Score: 1.0,
      });

      const scored = scorer.score([memory]);
      expect(scored[0]!.score).toBeGreaterThanOrEqual(0);
      expect(scored[0]!.score).toBeLessThanOrEqual(1);
    });
  });

  describe('normalizeBM25Scores()', () => {
    it('should normalize scores to [0, 1]', () => {
      const scores = [
        { id: 'a', score: 10 },
        { id: 'b', score: 5 },
        { id: 'c', score: 0 },
      ];

      const normalized = scorer.normalizeBM25Scores(scores);
      expect(normalized.get('a')).toBe(1.0);
      expect(normalized.get('b')).toBe(0.5);
      expect(normalized.get('c')).toBe(0.0);
    });

    it('should handle empty array', () => {
      const normalized = scorer.normalizeBM25Scores([]);
      expect(normalized.size).toBe(0);
    });

    it('should handle all-zero scores', () => {
      const scores = [
        { id: 'a', score: 0 },
        { id: 'b', score: 0 },
      ];

      const normalized = scorer.normalizeBM25Scores(scores);
      expect(normalized.get('a')).toBe(0);
      expect(normalized.get('b')).toBe(0);
    });
  });

  describe('normalizeRerankerScores()', () => {
    it('should normalize scores to [0, 1] range', () => {
      const scores = [
        { index: 0, score: 0.9 },
        { index: 1, score: 0.3 },
        { index: 2, score: 0.6 },
      ];
      const ids = ['mem-a', 'mem-b', 'mem-c'];

      const normalized = scorer.normalizeRerankerScores(scores, ids);
      expect(normalized.get('mem-a')).toBe(1.0);
      expect(normalized.get('mem-b')).toBe(0.0);
      expect(normalized.get('mem-c')).toBeCloseTo(0.5, 5);
    });
  });
});
