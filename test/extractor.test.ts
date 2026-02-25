/**
 * Tests for memory extractor
 */

import { describe, it, expect, jest } from '@jest/globals';
import { MemoryExtractor } from '../src/memory/extractor.js';
import type { LLMService } from '../src/llm.js';
import type { TinmemConfig } from '../src/config.js';

function makeConfig(overrides?: Partial<TinmemConfig>): TinmemConfig {
  return {
    dbPath: '/tmp/test-tinmem',
    defaultScope: 'global',
    embedding: { provider: 'openai', apiKey: 'test', model: 'text-embedding-3-small', dimensions: 1536 },
    llm: { apiKey: 'test', model: 'gpt-4o-mini', maxTokens: 2048, temperature: 0.1 },
    deduplication: { strategy: 'llm', similarityThreshold: 0.85, llmThreshold: 0.90 },
    retrieval: { limit: 10, minScore: 0.3, hybrid: true, candidateMultiplier: 3 },
    scoring: {
      vectorWeight: 0.4, bm25Weight: 0.3, rerankerWeight: 0.3,
      recencyBoostDays: 7, recencyBoostFactor: 0.15,
      importanceWeight: 0.2, timePenaltyDays: 90, timePenaltyFactor: 0.2,
    },
    capture: {
      auto: true, sessionSummary: true, noiseFilter: true,
      minContentLength: 20,
      skipPatterns: ['^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great)[\\.!?]?$'],
    },
    autoRecall: true,
    recallLimit: 8,
    recallMinScore: 0.4,
    debug: false,
    ...overrides,
  } as TinmemConfig;
}

function makeLLM(response: string): LLMService {
  return {
    complete: jest.fn<() => Promise<string>>().mockResolvedValue(response),
  };
}

describe('MemoryExtractor', () => {
  describe('extractFromTurn()', () => {
    it('should extract valid memories from conversation', async () => {
      const llmResponse = JSON.stringify([
        {
          headline: 'User is a senior TypeScript developer',
          summary: 'The user has identified themselves as a senior developer specializing in TypeScript.',
          content: 'The user mentioned they have 5 years of TypeScript experience.',
          category: 'profile',
          importance: 0.8,
          tags: ['typescript', 'developer'],
        },
      ]);

      const llm = makeLLM(llmResponse);
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn(
        'I am a senior TypeScript developer with 5 years of experience.',
        'Great! I can help you with advanced TypeScript patterns.',
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe('profile');
      expect(result[0]!.headline).toBe('User is a senior TypeScript developer');
      expect(result[0]!.importance).toBe(0.8);
      expect(result[0]!.tags).toContain('typescript');
    });

    it('should return empty array for noise messages', async () => {
      const llm = makeLLM('[]');
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn('hi', 'Hello! How can I help you?');
      expect(result).toHaveLength(0);
      // LLM should not be called for noise
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('should filter out invalid category memories', async () => {
      const llmResponse = JSON.stringify([
        {
          headline: 'Valid memory',
          summary: 'Valid summary',
          content: 'Valid content',
          category: 'profile',
          importance: 0.7,
          tags: [],
        },
        {
          headline: 'Invalid category',
          summary: 'Invalid summary',
          content: 'Invalid content',
          category: 'invalid_category',
          importance: 0.5,
          tags: [],
        },
      ]);

      const llm = makeLLM(llmResponse);
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn(
        'I prefer Python for data science but TypeScript for web.',
        'Both are excellent choices for their respective domains.',
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe('profile');
    });

    it('should clamp importance to [0, 1] range', async () => {
      const llmResponse = JSON.stringify([
        {
          headline: 'High importance memory',
          summary: 'Summary',
          content: 'Content',
          category: 'events',
          importance: 1.5, // out of range
          tags: [],
        },
      ]);

      const llm = makeLLM(llmResponse);
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn(
        'We just launched the product successfully!',
        'Congratulations on the successful launch!',
      );

      expect(result[0]!.importance).toBeLessThanOrEqual(1.0);
    });

    it('should handle LLM returning empty array', async () => {
      const llm = makeLLM('[]');
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn(
        'Can you explain what recursion is?',
        'Recursion is when a function calls itself.',
      );

      expect(result).toHaveLength(0);
    });

    it('should handle LLM errors gracefully', async () => {
      const llm: LLMService = {
        complete: jest.fn<() => Promise<string>>().mockRejectedValue(new Error('API Error')),
      };
      const extractor = new MemoryExtractor(llm, makeConfig({ debug: false }));

      const result = await extractor.extractFromTurn(
        'I work at Acme Corp',
        'That is a great company.',
      );

      expect(result).toHaveLength(0);
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      const llmResponse = '```json\n[{"headline":"Test","summary":"Summary","content":"Content","category":"events","importance":0.7,"tags":["test"]}]\n```';

      const llm = makeLLM(llmResponse);
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromTurn(
        'The sprint planning meeting went well.',
        'Glad the planning session was productive!',
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('extractFromSession()', () => {
    it('should extract memories from conversation history', async () => {
      const llmResponse = JSON.stringify([
        {
          headline: 'Session covered authentication implementation',
          summary: 'The session focused on implementing JWT authentication.',
          content: 'Full details about JWT auth implementation.',
          category: 'cases',
          importance: 0.9,
          tags: ['jwt', 'auth'],
        },
      ]);

      const llm = makeLLM(llmResponse);
      const extractor = new MemoryExtractor(llm, makeConfig());

      const history = [
        { role: 'user', content: 'Let us implement JWT authentication for our API.' },
        { role: 'assistant', content: 'Sure, let me help you with JWT implementation.' },
        { role: 'user', content: 'We finished implementing it successfully.' },
        { role: 'assistant', content: 'Great work on the JWT implementation!' },
      ];

      const result = await extractor.extractFromSession(history);

      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe('cases');
    });

    it('should return empty for empty conversation history', async () => {
      const llm = makeLLM('[]');
      const extractor = new MemoryExtractor(llm, makeConfig());

      const result = await extractor.extractFromSession([]);
      expect(result).toHaveLength(0);
      expect(llm.complete).not.toHaveBeenCalled();
    });
  });
});
