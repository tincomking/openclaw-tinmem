/**
 * openclaw-tinmem - before_agent_start hook
 * Injects relevant memories into agent context before processing user message
 */

import type { TinmemConfig } from '../config.js';
import type { BeforeAgentStartPayload } from '../types.js';
import { getMemoryManager } from '../memory/manager.js';
import { buildContextInjection } from '../prompts.js';

export interface BeforeAgentStartResult {
  /** Memory context to inject into the system prompt */
  contextInjection: string;
  /** Number of memories retrieved */
  memoriesFound: number;
  /** IDs of retrieved memories */
  memoryIds: string[];
}

export async function handleBeforeAgentStart(
  payload: BeforeAgentStartPayload,
  config: TinmemConfig,
): Promise<BeforeAgentStartResult> {
  if (!config.autoRecall) {
    return { contextInjection: '', memoriesFound: 0, memoryIds: [] };
  }

  try {
    const manager = await getMemoryManager(config);

    // Determine scope: prefer agent-specific scope, fallback to global
    const scopes = payload.agentId
      ? [`agent:${payload.agentId}` as const, 'global' as const]
      : ['global' as const];

    const result = await manager.recall(payload.userMessage, {
      scope: scopes,
      limit: config.recallLimit,
      minScore: config.recallMinScore,
    });

    if (result.memories.length === 0) {
      return { contextInjection: '', memoriesFound: 0, memoryIds: [] };
    }

    // Reuse recall results directly instead of calling buildContext which
    // would perform the entire retrieval pipeline a second time.
    const contextInjection = buildContextInjection(result.memories, 'L1');

    if (config.debug) {
      console.log(`[tinmem] Injecting ${result.memories.length} memories for session ${payload.sessionId}`);
    }

    return {
      contextInjection,
      memoriesFound: result.memories.length,
      memoryIds: result.memories.map(m => m.id),
    };
  } catch (err) {
    console.error('[tinmem] before_agent_start error:', err);
    return { contextInjection: '', memoriesFound: 0, memoryIds: [] };
  }
}

/**
 * OpenClaw hook handler
 * Can be registered as a hook in openclaw.json
 */
export async function openclaw_before_agent_start(
  payload: BeforeAgentStartPayload & { config: TinmemConfig },
): Promise<{ systemPromptAddition?: string }> {
  const { config, ...hookPayload } = payload;
  const result = await handleBeforeAgentStart(hookPayload, config);

  return {
    systemPromptAddition: result.contextInjection || undefined,
  };
}
