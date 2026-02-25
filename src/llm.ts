/**
 * openclaw-tinmem - LLM API integration
 * OpenAI-compatible interface for extraction and deduplication
 */

import type { TinmemConfig } from './config.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMService {
  complete(messages: Message[], jsonMode?: boolean): Promise<string>;
}

class OpenAICompatibleLLM implements LLMService {
  private baseUrl: string;

  constructor(
    private apiKey: string,
    private model: string,
    baseUrl: string | undefined,
    private maxTokens: number,
    private temperature: number,
  ) {
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
  }

  async complete(messages: Message[], jsonMode = false): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
    };

    return data.choices[0]?.message.content ?? '';
  }
}

export function createLLMService(config: TinmemConfig): LLMService {
  return new OpenAICompatibleLLM(
    config.llm.apiKey,
    config.llm.model,
    config.llm.baseUrl,
    config.llm.maxTokens,
    config.llm.temperature,
  );
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    // Extract JSON from potential markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    const jsonStr = match ? match[1]! : text;
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}
