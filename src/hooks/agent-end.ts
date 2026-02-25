/**
 * openclaw-tinmem - agent_end hook
 * Extracts and stores memories after each conversation turn
 */

import type { TinmemConfig } from '../config.js';
import type { AgentEndPayload, Memory, MemoryScope } from '../types.js';
import { getMemoryManager } from '../memory/manager.js';

export interface AgentEndResult {
  /** Memories stored in this turn */
  stored: Memory[];
  /** Number of memories stored */
  storedCount: number;
}

export async function handleAgentEnd(
  payload: AgentEndPayload,
  config: TinmemConfig,
): Promise<AgentEndResult> {
  if (!config.capture.auto) {
    return { stored: [], storedCount: 0 };
  }

  try {
    const manager = await getMemoryManager(config);

    // Use agent-specific scope if available, fallback to global
    const scope: MemoryScope = payload.agentId
      ? `agent:${payload.agentId}`
      : (config.defaultScope as MemoryScope);

    // Build existing context summary for deduplication awareness
    let existingContext: string | undefined;
    if (payload.conversationHistory && payload.conversationHistory.length > 2) {
      existingContext = payload.conversationHistory
        .slice(-6)
        .map(t => `${t.role}: ${t.content.slice(0, 200)}`)
        .join('\n');
    }

    const stored = await manager.processTurn(
      payload.userMessage,
      payload.assistantResponse,
      scope,
      existingContext,
    );

    if (config.debug && stored.length > 0) {
      console.log(`[tinmem] Stored ${stored.length} memories for session ${payload.sessionId}`);
      for (const m of stored) {
        console.log(`  [${m.category}] ${m.headline}`);
      }
    }

    return {
      stored,
      storedCount: stored.length,
    };
  } catch (err) {
    console.error('[tinmem] agent_end error:', err);
    return { stored: [], storedCount: 0 };
  }
}

/**
 * OpenClaw hook handler
 */
export async function openclaw_agent_end(
  payload: AgentEndPayload & { config: TinmemConfig },
): Promise<void> {
  const { config, ...hookPayload } = payload;
  await handleAgentEnd(hookPayload, config);
}
