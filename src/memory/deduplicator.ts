/**
 * openclaw-tinmem - Memory deduplication
 * Two-stage: vector similarity pre-filter + LLM decision (CREATE/MERGE/SKIP)
 */

import type { LLMService } from '../llm.js';
import { safeJsonParse } from '../llm.js';
import type { Memory, ExtractedMemory, DedupResult } from '../types.js';
import { DEDUP_SYSTEM_PROMPT, buildDedupPrompt } from '../prompts.js';
import type { TinmemDB } from './db.js';
import type { EmbeddingService } from '../embeddings.js';
import type { TinmemConfig } from '../config.js';

// Append-only categories always CREATE
const APPEND_ONLY_CATEGORIES = new Set(['events', 'cases']);

export class MemoryDeduplicator {
  constructor(
    private db: TinmemDB,
    _embedding: EmbeddingService,
    private llm: LLMService,
    private config: TinmemConfig,
  ) {}

  /**
   * Run deduplication for a new memory candidate.
   * Returns a DedupResult indicating what action to take.
   */
  async deduplicate(
    candidate: ExtractedMemory,
    candidateVector: number[],
    scope: string,
  ): Promise<DedupResult> {
    // Append-only categories always CREATE
    if (APPEND_ONLY_CATEGORIES.has(candidate.category)) {
      return { decision: 'CREATE', reason: 'Append-only category' };
    }

    const strategy = this.config.deduplication.strategy;
    const threshold = this.config.deduplication.similarityThreshold;

    // Stage 1: Vector similarity search for candidates
    const vectorCandidates = await this.db.vectorSearch(candidateVector, {
      limit: 5,
      scope: scope as Memory['scope'],
      categories: [candidate.category],
      minScore: threshold - 0.1, // slightly lower to not miss boundary cases
    });

    if (vectorCandidates.length === 0) {
      return { decision: 'CREATE', reason: 'No similar memories found' };
    }

    // Check for high-confidence duplicates
    const highConfidenceMatches = vectorCandidates.filter(vc => {
      const vectorScore = 1 - vc._distance;
      return vectorScore >= threshold;
    });

    if (highConfidenceMatches.length === 0) {
      return { decision: 'CREATE', reason: 'Similarity below threshold' };
    }

    if (strategy === 'vector') {
      // Vector-only: auto-merge with best match
      const best = highConfidenceMatches[0]!;
      return {
        decision: 'MERGE',
        targetId: best.id,
        mergedHeadline: candidate.headline, // keep newer headline
        mergedSummary: `${best.summary}\n\nUpdate: ${candidate.summary}`,
        mergedContent: `${best.content}\n\n---\n\n${candidate.content}`,
        mergedTags: [...new Set([...best.tags, ...candidate.tags])],
        reason: `Vector similarity ${(1 - best._distance).toFixed(2)} >= threshold`,
      };
    }

    // Strategy: 'llm' or 'both'
    // For 'both', only use LLM when score is in ambiguous range
    if (strategy === 'both') {
      const llmThreshold = this.config.deduplication.llmThreshold;
      const bestScore = 1 - highConfidenceMatches[0]!._distance;
      if (bestScore >= llmThreshold) {
        // Very high confidence - auto-skip without LLM call
        return {
          decision: 'SKIP',
          reason: `Very high vector similarity ${bestScore.toFixed(2)}, skipping without LLM`,
        };
      }
    }

    // Stage 2: LLM decision
    return this.llmDecide(candidate, highConfidenceMatches);
  }

  private async llmDecide(
    candidate: ExtractedMemory,
    similar: Array<Memory & { _distance: number }>,
  ): Promise<DedupResult> {
    const prompt = buildDedupPrompt(
      {
        headline: candidate.headline,
        summary: candidate.summary,
        content: candidate.content,
        category: candidate.category,
      },
      similar.map(m => ({
        id: m.id,
        headline: m.headline,
        summary: m.summary,
        content: m.content,
        category: m.category,
        tags: m.tags,
      })),
    );

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: DEDUP_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        true,
      );

      const result = safeJsonParse<{
        decision?: string;
        targetId?: string;
        mergedHeadline?: string;
        mergedSummary?: string;
        mergedContent?: string;
        mergedTags?: string[];
        reason?: string;
      }>(response, {});

      const decision = result.decision as DedupResult['decision'];
      if (!['CREATE', 'MERGE', 'SKIP'].includes(decision)) {
        return { decision: 'CREATE', reason: 'LLM returned invalid decision' };
      }

      return {
        decision,
        targetId: result.targetId,
        mergedHeadline: result.mergedHeadline,
        mergedSummary: result.mergedSummary,
        mergedContent: result.mergedContent,
        mergedTags: result.mergedTags,
        reason: result.reason,
      };
    } catch (err) {
      // On error, default to CREATE to avoid data loss
      return {
        decision: 'CREATE',
        reason: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
