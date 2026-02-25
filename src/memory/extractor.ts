/**
 * openclaw-tinmem - Memory extraction
 * Uses LLM to extract structured memories from conversations
 */

import type { LLMService } from '../llm.js';
import { safeJsonParse } from '../llm.js';
import type { ExtractedMemory } from '../types.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildSessionSummaryPrompt,
  isNoise,
  NOISE_PATTERNS,
} from '../prompts.js';
import type { TinmemConfig } from '../config.js';

export class MemoryExtractor {
  constructor(
    private llm: LLMService,
    private config: TinmemConfig,
  ) {}

  /**
   * Extract memories from a single conversation turn
   */
  async extractFromTurn(
    userMessage: string,
    assistantResponse: string,
    existingContext?: string,
  ): Promise<ExtractedMemory[]> {
    // Apply noise filter
    if (this.config.capture.noiseFilter) {
      if (this.shouldSkip(userMessage, assistantResponse)) {
        if (this.config.debug) {
          console.log('[tinmem] Skipping noise message');
        }
        return [];
      }
    }

    const prompt = buildExtractionPrompt(userMessage, assistantResponse, existingContext);

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        true, // JSON mode
      );

      const extracted = safeJsonParse<ExtractedMemory[]>(response, []);
      return this.validateExtracted(extracted);
    } catch (err) {
      if (this.config.debug) {
        console.error('[tinmem] Extraction error:', err);
      }
      return [];
    }
  }

  /**
   * Extract memories from a full session conversation history
   */
  async extractFromSession(
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<ExtractedMemory[]> {
    if (conversationHistory.length === 0) return [];

    const meaningfulTurns = conversationHistory.filter(
      t => t.content.length >= this.config.capture.minContentLength
    );

    if (meaningfulTurns.length === 0) return [];

    const prompt = buildSessionSummaryPrompt(conversationHistory);

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        true,
      );

      const extracted = safeJsonParse<ExtractedMemory[]>(response, []);
      return this.validateExtracted(extracted);
    } catch (err) {
      if (this.config.debug) {
        console.error('[tinmem] Session extraction error:', err);
      }
      return [];
    }
  }

  /**
   * Manually store a memory from explicit text
   */
  async extractFromText(text: string): Promise<ExtractedMemory[]> {
    const prompt = `Extract memories from the following text. Return a JSON array of memory objects.

## Text
${text}`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        true,
      );

      const extracted = safeJsonParse<ExtractedMemory[]>(response, []);
      return this.validateExtracted(extracted);
    } catch (err) {
      if (this.config.debug) {
        console.error('[tinmem] Text extraction error:', err);
      }
      return [];
    }
  }

  private shouldSkip(userMessage: string, assistantResponse: string): boolean {
    // Check user message
    if (isNoise(userMessage)) return true;

    // Check custom skip patterns
    const customPatterns = this.config.capture.skipPatterns;
    for (const pattern of customPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(userMessage.trim())) return true;
      } catch {
        // Invalid regex pattern, skip
      }
    }

    // Check if both are very short
    const combined = userMessage.length + assistantResponse.length;
    if (combined < this.config.capture.minContentLength * 2) return true;

    return false;
  }

  private validateExtracted(raw: unknown[]): ExtractedMemory[] {
    const VALID_CATEGORIES = new Set([
      'profile', 'preferences', 'entities', 'events', 'cases', 'patterns',
    ]);

    const results: ExtractedMemory[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;

      if (
        typeof m.headline !== 'string' ||
        typeof m.summary !== 'string' ||
        typeof m.content !== 'string' ||
        typeof m.category !== 'string' ||
        !VALID_CATEGORIES.has(m.category)
      ) {
        continue;
      }

      results.push({
        headline: m.headline.trim(),
        summary: m.summary.trim(),
        content: m.content.trim(),
        category: m.category as ExtractedMemory['category'],
        importance: typeof m.importance === 'number'
          ? Math.max(0, Math.min(1, m.importance))
          : 0.5,
        tags: Array.isArray(m.tags)
          ? (m.tags as unknown[]).filter(t => typeof t === 'string') as string[]
          : [],
        metadata: typeof m.metadata === 'object' && m.metadata !== null
          ? m.metadata as Record<string, unknown>
          : {},
      });
    }

    return results;
  }
}
