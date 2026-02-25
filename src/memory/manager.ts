/**
 * openclaw-tinmem - Memory Manager
 * Central orchestrator: extraction → deduplication → storage → retrieval
 */

import type { TinmemConfig } from '../config.js';
import type {
  Memory, MemoryScope, MemoryCategory, MemoryStats,
  RetrievalOptions, RetrievalResult, ScoredMemory,
  ExtractedMemory, ExportData, ConversationTurn,
} from '../types.js';
import { getDB, TinmemDB } from './db.js';
import { createEmbeddingService } from '../embeddings.js';
import { createLLMService } from '../llm.js';
import { createReranker } from '../reranker.js';
import { MemoryExtractor } from './extractor.js';
import { MemoryDeduplicator } from './deduplicator.js';
import { MemoryRetriever } from './retriever.js';

export class MemoryManager {
  private db!: TinmemDB;
  private extractor!: MemoryExtractor;
  private deduplicator!: MemoryDeduplicator;
  private retriever!: MemoryRetriever;
  private ready = false;

  constructor(private config: TinmemConfig) {}

  async init(): Promise<void> {
    if (this.ready) return;

    const embedding = createEmbeddingService(this.config);
    const llm = createLLMService(this.config);
    const reranker = createReranker(this.config);

    this.db = await getDB(this.config.dbPath, this.config.embedding.dimensions);
    this.extractor = new MemoryExtractor(llm, this.config);
    this.deduplicator = new MemoryDeduplicator(this.db, embedding, llm, this.config);
    this.retriever = new MemoryRetriever(this.db, embedding, reranker, this.config);

    this.ready = true;
  }

  private ensureReady(): void {
    if (!this.ready) throw new Error('MemoryManager not initialized. Call init() first.');
  }

  // ─── Capture ──────────────────────────────────────────────────────────────

  /**
   * Process a conversation turn: extract memories and store
   */
  async processTurn(
    userMessage: string,
    assistantResponse: string,
    scope?: MemoryScope,
    existingContext?: string,
  ): Promise<Memory[]> {
    this.ensureReady();

    const extracted = await this.extractor.extractFromTurn(
      userMessage,
      assistantResponse,
      existingContext,
    );

    return this.storeExtracted(extracted, scope ?? (this.config.defaultScope as MemoryScope));
  }

  /**
   * Process full session history (for session summary)
   */
  async processSession(
    conversationHistory: ConversationTurn[],
    scope?: MemoryScope,
  ): Promise<Memory[]> {
    this.ensureReady();

    const extracted = await this.extractor.extractFromSession(conversationHistory);
    return this.storeExtracted(extracted, scope ?? (this.config.defaultScope as MemoryScope));
  }

  // ─── Store ───────────────────────────────────────────────────────────────

  /**
   * Store extracted memories with deduplication
   */
  private async storeExtracted(
    extracted: ExtractedMemory[],
    scope: MemoryScope,
  ): Promise<Memory[]> {
    const stored: Memory[] = [];

    const embedding = createEmbeddingService(this.config);

    for (const candidate of extracted) {
      try {
        const vector = await embedding.embed(
          `${candidate.headline}\n${candidate.summary}\n${candidate.content}`
        );

        const dedupResult = await this.deduplicator.deduplicate(candidate, vector, scope);

        if (this.config.debug) {
          console.log(`[tinmem] Dedup decision: ${dedupResult.decision} - ${dedupResult.reason}`);
        }

        if (dedupResult.decision === 'SKIP') continue;

        if (dedupResult.decision === 'MERGE' && dedupResult.targetId) {
          const mergedVector = dedupResult.mergedContent
            ? await embedding.embed(
                `${dedupResult.mergedHeadline ?? candidate.headline}\n${dedupResult.mergedSummary ?? candidate.summary}\n${dedupResult.mergedContent}`
              )
            : vector;

          const updated = await this.db.update(dedupResult.targetId, {
            headline: dedupResult.mergedHeadline ?? candidate.headline,
            summary: dedupResult.mergedSummary ?? candidate.summary,
            content: dedupResult.mergedContent ?? candidate.content,
            tags: dedupResult.mergedTags ?? candidate.tags,
            vector: mergedVector,
          });

          if (updated) stored.push(updated);
        } else {
          // CREATE
          const memory = await this.db.insert({
            headline: candidate.headline,
            summary: candidate.summary,
            content: candidate.content,
            category: candidate.category,
            scope,
            importance: candidate.importance,
            tags: candidate.tags,
            metadata: candidate.metadata ?? {},
            vector,
          });

          stored.push(memory);
        }
      } catch (err) {
        if (this.config.debug) {
          console.error('[tinmem] Error storing memory:', err);
        }
      }
    }

    return stored;
  }

  /**
   * Manually store a memory
   */
  async store(
    content: string,
    category: MemoryCategory,
    options: {
      scope?: MemoryScope;
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
      skipExtraction?: boolean;
    } = {},
  ): Promise<Memory[]> {
    this.ensureReady();

    const scope = options.scope ?? (this.config.defaultScope as MemoryScope);

    if (options.skipExtraction) {
      // Direct storage without LLM extraction
      const embedding = createEmbeddingService(this.config);
      const vector = await embedding.embed(content);

      const memory = await this.db.insert({
        headline: content.slice(0, 100),
        summary: content.slice(0, 300),
        content,
        category,
        scope,
        importance: options.importance ?? 0.5,
        tags: options.tags ?? [],
        metadata: options.metadata ?? {},
        vector,
      });

      return [memory];
    }

    const extracted = await this.extractor.extractFromText(content);
    if (extracted.length === 0) return [];

    // Override category from extracted
    const adjusted = extracted.map(e => ({ ...e, category }));
    return this.storeExtracted(adjusted, scope);
  }

  // ─── Retrieve ─────────────────────────────────────────────────────────────

  async recall(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    this.ensureReady();
    return this.retriever.retrieve(query, options);
  }

  async buildContext(query: string, options: RetrievalOptions & { level?: 'L0' | 'L1' | 'L2' } = {}): Promise<string> {
    this.ensureReady();
    return this.retriever.buildContext(query, options);
  }

  // ─── Manage ───────────────────────────────────────────────────────────────

  async forget(id: string): Promise<boolean> {
    this.ensureReady();
    return this.db.delete(id);
  }

  async forgetMany(ids: string[]): Promise<number> {
    this.ensureReady();
    return this.db.deleteMany(ids);
  }

  async forgetByScope(scope: MemoryScope): Promise<number> {
    this.ensureReady();
    return this.db.deleteByScope(scope);
  }

  async getById(id: string): Promise<Memory | null> {
    this.ensureReady();
    return this.db.getById(id);
  }

  async update(
    id: string,
    updates: Partial<Pick<Memory, 'headline' | 'summary' | 'content' | 'importance' | 'tags' | 'metadata'>>,
  ): Promise<Memory | null> {
    this.ensureReady();

    // Re-embed if content changed
    if (updates.content || updates.summary || updates.headline) {
      const existing = await this.db.getById(id);
      if (!existing) return null;

      const embedding = createEmbeddingService(this.config);
      const newHeadline = updates.headline ?? existing.headline;
      const newSummary = updates.summary ?? existing.summary;
      const newContent = updates.content ?? existing.content;

      const vector = await embedding.embed(`${newHeadline}\n${newSummary}\n${newContent}`);
      return this.db.update(id, { ...updates, vector });
    }

    return this.db.update(id, updates);
  }

  async list(options: {
    scope?: MemoryScope | MemoryScope[];
    categories?: MemoryCategory[];
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'importance' | 'accessCount';
    orderDir?: 'asc' | 'desc';
  } = {}): Promise<Memory[]> {
    this.ensureReady();
    return this.db.list(options);
  }

  async getStats(): Promise<MemoryStats> {
    this.ensureReady();
    return this.db.getStats();
  }

  // ─── Export / Import ──────────────────────────────────────────────────────

  async export(scope?: MemoryScope): Promise<ExportData> {
    this.ensureReady();

    const memories = await this.db.getAllForExport(scope);
    const stats = await this.db.getStats();

    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      memories,
      stats,
    };
  }

  async import(data: ExportData, scope?: MemoryScope): Promise<number> {
    this.ensureReady();

    const embedding = createEmbeddingService(this.config);
    const toImport = data.memories;

    if (toImport.length === 0) return 0;

    let imported = 0;
    for (const m of toImport) {
      try {
        const vector = await embedding.embed(`${m.headline}\n${m.summary}\n${m.content}`);
        await this.db.insert({
          ...m,
          scope: scope ?? m.scope,
          vector,
        });
        imported++;
      } catch (err) {
        if (this.config.debug) {
          console.error('[tinmem] Import error for memory:', m.id, err);
        }
      }
    }

    return imported;
  }

  /**
   * Re-embed all memories (useful when switching embedding models)
   */
  async reembed(scope?: MemoryScope): Promise<number> {
    this.ensureReady();

    const embedding = createEmbeddingService(this.config);
    const memories = await this.db.getAllForExport(scope);

    let count = 0;
    for (const m of memories) {
      try {
        const vector = await embedding.embed(`${m.headline}\n${m.summary}\n${m.content}`);
        await this.db.update(m.id, { vector } as Parameters<typeof this.db.update>[1]);
        count++;
      } catch {
        // Continue on error
      }
    }

    return count;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: MemoryManager | null = null;

export async function getMemoryManager(config: TinmemConfig): Promise<MemoryManager> {
  if (!instance) {
    instance = new MemoryManager(config);
    await instance.init();
  }
  return instance;
}

export function resetMemoryManager(): void {
  instance = null;
}
