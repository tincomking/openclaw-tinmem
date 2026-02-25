/**
 * openclaw-tinmem - command:new hook
 * Generates session summary memory when a new conversation session starts
 */

import type { TinmemConfig } from '../config.js';
import type { CommandNewPayload, Memory, MemoryScope, ConversationTurn } from '../types.js';
import { getMemoryManager } from '../memory/manager.js';

export interface CommandNewResult {
  summaryMemories: Memory[];
}

export async function handleCommandNew(
  payload: CommandNewPayload,
  conversationHistory: ConversationTurn[],
  config: TinmemConfig,
): Promise<CommandNewResult> {
  if (!config.capture.sessionSummary || conversationHistory.length === 0) {
    return { summaryMemories: [] };
  }

  try {
    const manager = await getMemoryManager(config);

    const scope: MemoryScope = config.defaultScope as MemoryScope;

    const summaryMemories = await manager.processSession(conversationHistory, scope);

    if (config.debug && summaryMemories.length > 0) {
      console.log(`[tinmem] Session summary: stored ${summaryMemories.length} memories from previous session ${payload.previousSessionId}`);
    }

    return { summaryMemories };
  } catch (err) {
    console.error('[tinmem] command:new error:', err);
    return { summaryMemories: [] };
  }
}

/**
 * OpenClaw hook handler
 */
export async function openclaw_command_new(
  payload: CommandNewPayload & {
    conversationHistory?: ConversationTurn[];
    config: TinmemConfig;
  },
): Promise<void> {
  const { config, conversationHistory = [], ...hookPayload } = payload;
  await handleCommandNew(hookPayload, conversationHistory, config);
}
