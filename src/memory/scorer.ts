/**
 * openclaw-tinmem - Multi-stage scoring pipeline
 * Combines: vector similarity + BM25 + reranker + recency boost + importance weight + time decay
 */

import type { Memory, ScoredMemory } from '../types.js';
import type { TinmemConfig } from '../config.js';

const MS_PER_DAY = 86400 * 1000;

export class MemoryScorer {
  private scoringCfg: TinmemConfig['scoring'];
  private retrievalCfg: TinmemConfig['retrieval'];

  constructor(private config: TinmemConfig) {
    this.scoringCfg = config.scoring;
    this.retrievalCfg = config.retrieval;
  }

  /**
   * Score and rank memories using multi-stage pipeline.
   *
   * @param memories - Memories with their raw retrieval scores
   * @param rerankScores - Optional scores from cross-encoder reranker
   */
  score(
    memories: Array<Memory & { vectorScore: number; bm25Score: number }>,
    rerankScores?: Map<string, number>,
  ): ScoredMemory[] {
    const now = Date.now();
    const cfg = this.scoringCfg;

    // Determine weights (normalize when reranker is absent)
    let vectorWeight = cfg.vectorWeight;
    let bm25Weight = cfg.bm25Weight;
    let rerankerWeight = cfg.rerankerWeight;

    if (!rerankScores || rerankScores.size === 0) {
      const total = vectorWeight + bm25Weight;
      vectorWeight = total > 0 ? vectorWeight / total : 0.5;
      bm25Weight = total > 0 ? bm25Weight / total : 0.5;
      rerankerWeight = 0;
    }

    return memories
      .map(m => {
        // 1. Combine retrieval scores
        let baseScore =
          m.vectorScore * vectorWeight +
          m.bm25Score * bm25Weight;

        if (rerankScores && rerankScores.has(m.id)) {
          baseScore += rerankScores.get(m.id)! * rerankerWeight;
        }

        // 2. Recency boost
        const recencyBoost = this.computeRecencyBoost(m.lastAccessedAt ?? m.updatedAt, now);

        // 3. Importance boost
        const importanceBoost = m.importance * cfg.importanceWeight;

        // 4. Time decay penalty
        const timePenalty = this.computeTimePenalty(m.createdAt, now);

        // 5. Final score
        const finalScore = Math.min(
          1.0,
          (baseScore + recencyBoost + importanceBoost) * (1 - timePenalty)
        );

        return {
          ...m,
          score: finalScore,
          vectorScore: m.vectorScore,
          bm25Score: m.bm25Score,
          rerankScore: rerankScores?.get(m.id),
          recencyBoost,
          importanceBoost,
        } as ScoredMemory;
      })
      .sort((a, b) => b.score - a.score);
  }

  private computeRecencyBoost(lastAccessedAt: number, now: number): number {
    const daysSinceAccess = (now - lastAccessedAt) / MS_PER_DAY;
    const boostDays = this.scoringCfg.recencyBoostDays;
    const maxBoost = this.scoringCfg.recencyBoostFactor;

    if (daysSinceAccess >= boostDays) return 0;

    // Linear decay from maxBoost at day 0 to 0 at boostDays
    return maxBoost * (1 - daysSinceAccess / boostDays);
  }

  private computeTimePenalty(createdAt: number, now: number): number {
    const daysSinceCreation = (now - createdAt) / MS_PER_DAY;
    const penaltyDays = this.scoringCfg.timePenaltyDays;
    const maxPenalty = this.scoringCfg.timePenaltyFactor;

    if (daysSinceCreation <= penaltyDays) return 0;

    // Exponential decay after penaltyDays
    const excess = daysSinceCreation - penaltyDays;
    return Math.min(maxPenalty, maxPenalty * (1 - Math.exp(-excess / 90)));
  }

  /**
   * Normalize BM25 scores to [0, 1] range
   */
  normalizeBM25Scores(scores: Array<{ id: string; score: number }>): Map<string, number> {
    if (scores.length === 0) return new Map();

    const maxScore = Math.max(...scores.map(s => s.score));
    if (maxScore === 0) return new Map(scores.map(s => [s.id, 0]));

    return new Map(scores.map(s => [s.id, s.score / maxScore]));
  }

  /**
   * Normalize reranker scores to [0, 1] range using sigmoid
   */
  normalizeRerankerScores(scores: Array<{ index: number; score: number }>, ids: string[]): Map<string, number> {
    const result = new Map<string, number>();
    if (scores.length === 0) return result;

    // Reranker scores are usually already in [0, 1] but may not be
    const maxScore = Math.max(...scores.map(s => s.score));
    const minScore = Math.min(...scores.map(s => s.score));
    const range = maxScore - minScore;

    for (const r of scores) {
      const id = ids[r.index];
      if (!id) continue;
      const normalized = range > 0 ? (r.score - minScore) / range : r.score;
      result.set(id, normalized);
    }

    return result;
  }
}
