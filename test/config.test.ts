/**
 * Tests for configuration schema and validation
 */

import { describe, it, expect } from '@jest/globals';
import { TinmemConfigSchema, generateSampleConfig } from '../src/config.js';

describe('TinmemConfigSchema', () => {
  it('should accept minimal valid config with OpenAI embedding', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'openai', apiKey: 'test-key' },
      llm: { apiKey: 'test-key' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embedding.provider).toBe('openai');
      expect(result.data.embedding.model).toBe('text-embedding-3-small');
      expect(result.data.deduplication.strategy).toBe('llm');
      expect(result.data.retrieval.hybrid).toBe(true);
      expect(result.data.autoRecall).toBe(true);
    }
  });

  it('should accept Jina embedding provider', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'jina', apiKey: 'jina-key' },
      llm: { apiKey: 'llm-key' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embedding.provider).toBe('jina');
      expect(result.data.embedding.model).toBe('jina-embeddings-v3');
    }
  });

  it('should accept Gemini embedding provider', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'gemini', apiKey: 'gemini-key' },
      llm: { apiKey: 'llm-key' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embedding.provider).toBe('gemini');
    }
  });

  it('should accept Ollama embedding provider (no apiKey required)', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'ollama' },
      llm: { apiKey: 'llm-key' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embedding.provider).toBe('ollama');
      expect(result.data.embedding.model).toBe('nomic-embed-text');
    }
  });

  it('should reject unknown embedding provider', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'unknown', apiKey: 'key' },
      llm: { apiKey: 'key' },
    });

    expect(result.success).toBe(false);
  });

  it('should apply default values for all sections', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'openai', apiKey: 'key' },
      llm: { apiKey: 'key' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data;
      expect(data.defaultScope).toBe('global');
      expect(data.recallLimit).toBe(8);
      expect(data.recallMinScore).toBe(0.4);
      expect(data.deduplication.similarityThreshold).toBe(0.85);
      expect(data.retrieval.limit).toBe(10);
      expect(data.retrieval.minScore).toBe(0.3);
      expect(data.retrieval.hybrid).toBe(true);
      expect(data.scoring.vectorWeight).toBe(0.4);
      expect(data.scoring.bm25Weight).toBe(0.3);
      expect(data.scoring.rerankerWeight).toBe(0.3);
      expect(data.capture.auto).toBe(true);
      expect(data.capture.sessionSummary).toBe(true);
      expect(data.capture.noiseFilter).toBe(true);
    }
  });

  it('should accept Jina reranker configuration', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'openai', apiKey: 'key' },
      llm: { apiKey: 'key' },
      retrieval: {
        reranker: {
          provider: 'jina',
          apiKey: 'jina-key',
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.retrieval.reranker) {
      expect(result.data.retrieval.reranker.provider).toBe('jina');
      expect(result.data.retrieval.reranker.model).toBe('jina-reranker-v2-base-multilingual');
    }
  });

  it('should accept SiliconFlow reranker configuration', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'openai', apiKey: 'key' },
      llm: { apiKey: 'key' },
      retrieval: {
        reranker: {
          provider: 'siliconflow',
          apiKey: 'sf-key',
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('should reject invalid deduplication strategy', () => {
    const result = TinmemConfigSchema.safeParse({
      embedding: { provider: 'openai', apiKey: 'key' },
      llm: { apiKey: 'key' },
      deduplication: { strategy: 'invalid' },
    });

    expect(result.success).toBe(false);
  });

  it('should generate valid sample config JSON', () => {
    const sample = generateSampleConfig();
    expect(() => JSON.parse(sample)).not.toThrow();

    const parsed = JSON.parse(sample);
    expect(parsed).toHaveProperty('embedding');
    expect(parsed).toHaveProperty('llm');
    expect(parsed).toHaveProperty('deduplication');
    expect(parsed).toHaveProperty('retrieval');
    expect(parsed).toHaveProperty('scoring');
  });
});
