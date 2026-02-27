/**
 * openclaw-tinmem - Hybrid retrieval engine
 * Vector search + BM25 full-text search + cross-encoder reranking
 */

import type { Memory, RetrievalOptions, RetrievalResult } from '../types.js';
import type { TinmemDB } from './db.js';
import type { EmbeddingService } from '../embeddings.js';
import type { RerankerService } from '../reranker.js';
import { MemoryScorer } from './scorer.js';
import { buildContextInjection } from '../prompts.js';
import type { TinmemConfig } from '../config.js';
import type { AbstractionLevel } from '../types.js';

// Patterns that indicate no memory search is needed
const SKIP_PATTERNS = [
  /^(hi|hello|hey)\s*[!.,]?\s*$/i,
  /^(thanks?|thank you)\s*[!.,]?\s*$/i,
  /^(ok|okay|sure|yes|no)\s*[!.,]?\s*$/i,
  /^(bye|goodbye)\s*[!.,]?\s*$/i,
];

export class MemoryRetriever {
  private scorer: MemoryScorer;

  constructor(
    private db: TinmemDB,
    private embedding: EmbeddingService,
    private reranker: RerankerService | null,
    private config: TinmemConfig,
  ) {
    this.scorer = new MemoryScorer(config);
  }

  /**
   * Retrieve memories relevant to a query using hybrid search
   */
  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const startTime = Date.now();

    // Adaptive retrieval: skip irrelevant queries
    if (this.config.capture.noiseFilter && this.shouldSkipQuery(query)) {
      return { memories: [], query, totalFound: 0, timingMs: 0 };
    }

    const limit = options.limit ?? this.config.retrieval.limit;
    const minScore = options.minScore ?? this.config.retrieval.minScore;
    const candidateCount = limit * this.config.retrieval.candidateMultiplier;

    // Generate query embedding
    const queryVector = await this.embedding.embed(query);

    // Stage 1: Vector search
    const vectorResults = await this.db.vectorSearch(queryVector, {
      limit: candidateCount,
      scope: options.scope,
      categories: options.categories,
    });

    // Stage 2: BM25 full-text search (if hybrid enabled)
    let bm25Results: Array<Memory & { _score: number }> = [];
    if (this.config.retrieval.hybrid) {
      bm25Results = await this.db.fullTextSearch(query, {
        limit: candidateCount,
        scope: options.scope,
        categories: options.categories,
      });
    }

    // Merge results from both sources
    const merged = this.mergeResults(vectorResults, bm25Results);

    if (merged.length === 0) {
      return { memories: [], query, totalFound: 0, timingMs: Date.now() - startTime };
    }

    // Stage 3: Cross-encoder reranking (if configured)
    let rerankScores: Map<string, number> | undefined;
    if (this.reranker && merged.length > 0) {
      rerankScores = await this.applyReranking(query, merged);
    }

    // Stage 4: Multi-stage scoring
    const scored = this.scorer.score(merged, rerankScores);

    // Filter by minimum score and apply limit
    const filtered = scored
      .filter(m => m.score >= minScore)
      .slice(0, limit);

    // Update access counts asynchronously
    void this.updateAccessCounts(filtered.map(m => m.id));

    const timingMs = Date.now() - startTime;

    if (this.config.debug) {
      console.log(`[tinmem] Retrieved ${filtered.length}/${merged.length} memories in ${timingMs}ms`);
    }

    return {
      memories: filtered,
      query,
      totalFound: merged.length,
      timingMs,
    };
  }

  /**
   * Build context injection string for agent system prompt
   */
  async buildContext(
    query: string,
    options: RetrievalOptions & { level?: AbstractionLevel } = {},
  ): Promise<string> {
    const level = options.level ?? 'L1';
    const limit = options.limit ?? this.config.recallLimit;
    const minScore = options.minScore ?? this.config.recallMinScore;

    const result = await this.retrieve(query, { ...options, limit, minScore });

    if (result.memories.length === 0) return '';

    return buildContextInjection(result.memories, level);
  }

  private mergeResults(
    vectorResults: Array<Memory & { _distance: number }>,
    bm25Results: Array<Memory & { _score: number }>,
  ): Array<Memory & { vectorScore: number; bm25Score: number }> {
    const memoryMap = new Map<string, Memory & { vectorScore: number; bm25Score: number }>();

    // Add vector results
    for (const r of vectorResults) {
      const vectorScore = 1 - r._distance;
      memoryMap.set(r.id, {
        ...r,
        vectorScore,
        bm25Score: 0,
      });
    }

    // Normalize BM25 scores
    if (bm25Results.length > 0) {
      const maxBm25 = Math.max(...bm25Results.map(r => r._score));
      for (const r of bm25Results) {
        const normalized = maxBm25 > 0 ? r._score / maxBm25 : 0;
        if (memoryMap.has(r.id)) {
          memoryMap.get(r.id)!.bm25Score = normalized;
        } else {
          memoryMap.set(r.id, {
            ...r,
            vectorScore: 0,
            bm25Score: normalized,
          });
        }
      }
    }

    return Array.from(memoryMap.values());
  }

  private async applyReranking(
    query: string,
    memories: Array<Memory & { vectorScore: number; bm25Score: number }>,
  ): Promise<Map<string, number>> {
    if (!this.reranker) return new Map();

    try {
      const documents = memories.map(m => `${m.headline}\n${m.summary}`);
      const rerankResults = await this.reranker.rerank(query, documents);

      const ids = memories.map(m => m.id);
      return this.scorer.normalizeRerankerScores(rerankResults, ids);
    } catch (err) {
      if (this.config.debug) {
        console.error('[tinmem] Reranking error:', err);
      }
      return new Map();
    }
  }

  private shouldSkipQuery(query: string): boolean {
    return SKIP_PATTERNS.some(p => p.test(query.trim()));
  }

  private async updateAccessCounts(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.db.incrementAccessCount(id).catch(() => {});
    }
  }
}
