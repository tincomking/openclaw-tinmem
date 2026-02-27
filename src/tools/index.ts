/**
 * openclaw-tinmem - Agent tool definitions
 * Tools that the AI agent can use to manage memories
 */

import type { TinmemConfig } from '../config.js';
import type {
  Memory, MemoryScope,
  MemoryRecallInput, MemoryStoreInput, MemoryForgetInput, MemoryUpdateInput,
  RetrievalResult,
} from '../types.js';
import { getMemoryManager } from '../memory/manager.js';

// ─── Tool Definitions (OpenClaw compatible format) ────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'memory_recall',
    description: 'Search and retrieve relevant memories from the memory system based on a query. Returns structured memories from past conversations and experiences.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant memories',
        },
        scope: {
          type: 'string',
          description: 'Memory scope to search (e.g., "global", "agent:myagent", "project:myproject"). Can be comma-separated for multiple scopes.',
        },
        categories: {
          type: 'array',
          items: { type: 'string', enum: ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns'] },
          description: 'Filter by memory categories',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 10)',
        },
        level: {
          type: 'string',
          enum: ['L0', 'L1', 'L2'],
          description: 'Detail level: L0=headline only, L1=summary (default), L2=full content',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_store',
    description: 'Store a new memory. The content will be extracted, categorized, and deduplicated automatically.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to store as a memory',
        },
        category: {
          type: 'string',
          enum: ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns'],
          description: 'Memory category',
        },
        scope: {
          type: 'string',
          description: 'Memory scope (default: global)',
        },
        importance: {
          type: 'number',
          description: 'Importance score 0.0-1.0 (default: 0.5)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for this memory',
        },
      },
      required: ['content', 'category'],
    },
  },
  {
    name: 'memory_forget',
    description: 'Remove a memory by ID or search query.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Specific memory ID to delete',
        },
        query: {
          type: 'string',
          description: 'Search query to find and delete matching memories',
        },
        scope: {
          type: 'string',
          description: 'Limit deletion to this scope',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit deletion to these categories',
        },
      },
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Memory ID to update',
        },
        content: {
          type: 'string',
          description: 'New content (will trigger re-embedding)',
        },
        summary: {
          type: 'string',
          description: 'New summary',
        },
        headline: {
          type: 'string',
          description: 'New headline',
        },
        importance: {
          type: 'number',
          description: 'New importance score',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags (replaces existing)',
        },
      },
      required: ['id'],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export class MemoryTools {
  constructor(private config: TinmemConfig) {}

  async memory_recall(input: MemoryRecallInput): Promise<{
    memories: Array<Partial<Memory> & { score: number }>;
    totalFound: number;
    timingMs: number;
  }> {
    const manager = await getMemoryManager(this.config);

    const scopes = input.scope
      ? (input.scope as string).split(',').map(s => s.trim() as MemoryScope)
      : undefined;

    const result: RetrievalResult = await manager.recall(input.query, {
      scope: scopes,
      categories: input.categories,
      limit: input.limit,
    });

    const level = input.level ?? 'L1';

    return {
      memories: result.memories.map(m => ({
        id: m.id,
        headline: m.headline,
        ...(level === 'L1' && { summary: m.summary }),
        ...(level === 'L2' && { summary: m.summary, content: m.content }),
        category: m.category,
        scope: m.scope,
        importance: m.importance,
        tags: m.tags,
        score: m.score,
        createdAt: m.createdAt,
      })),
      totalFound: result.totalFound,
      timingMs: result.timingMs,
    };
  }

  async memory_store(input: MemoryStoreInput): Promise<{
    stored: number;
    memoryIds: string[];
  }> {
    const manager = await getMemoryManager(this.config);

    const memories = await manager.store(input.content, input.category, {
      scope: input.scope as MemoryScope | undefined,
      importance: input.importance,
      tags: input.tags,
    });

    return {
      stored: memories.length,
      memoryIds: memories.map(m => m.id),
    };
  }

  async memory_forget(input: MemoryForgetInput): Promise<{
    deleted: number;
    message: string;
  }> {
    const manager = await getMemoryManager(this.config);

    if (input.id) {
      const success = await manager.forget(input.id);
      return {
        deleted: success ? 1 : 0,
        message: success ? `Deleted memory ${input.id}` : `Memory ${input.id} not found`,
      };
    }

    if (input.query) {
      const result = await manager.recall(input.query, {
        scope: input.scope as MemoryScope | undefined,
        categories: input.categories,
        limit: 10,
        minScore: 0.5,
      });

      if (result.memories.length === 0) {
        return { deleted: 0, message: 'No matching memories found' };
      }

      const ids = result.memories.map(m => m.id);
      const count = await manager.forgetMany(ids);
      return {
        deleted: count,
        message: `Deleted ${count} memories matching "${input.query}"`,
      };
    }

    return { deleted: 0, message: 'Please provide either id or query' };
  }

  async memory_update(input: MemoryUpdateInput): Promise<{
    updated: boolean;
    memory?: Partial<Memory>;
    message: string;
  }> {
    const manager = await getMemoryManager(this.config);

    const updated = await manager.update(input.id, {
      content: input.content,
      summary: input.summary,
      headline: input.headline,
      importance: input.importance,
      tags: input.tags,
    });

    if (!updated) {
      return { updated: false, message: `Memory ${input.id} not found` };
    }

    return {
      updated: true,
      memory: {
        id: updated.id,
        headline: updated.headline,
        category: updated.category,
        importance: updated.importance,
        tags: updated.tags,
      },
      message: `Memory ${input.id} updated successfully`,
    };
  }

  /**
   * Dispatch tool call by name
   */
  async dispatch(toolName: string, input: unknown): Promise<unknown> {
    switch (toolName) {
      case 'memory_recall': return this.memory_recall(input as MemoryRecallInput);
      case 'memory_store': return this.memory_store(input as MemoryStoreInput);
      case 'memory_forget': return this.memory_forget(input as MemoryForgetInput);
      case 'memory_update': return this.memory_update(input as MemoryUpdateInput);
      default: throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
