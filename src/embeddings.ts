/**
 * openclaw-tinmem - Multi-provider embedding service
 * Supports: OpenAI, Jina, Google Gemini, Ollama
 */

import type { TinmemConfig } from './config.js';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly provider: string;
}

// ─── OpenAI Embedding ────────────────────────────────────────────────────────

class OpenAIEmbedding implements EmbeddingService {
  readonly provider = 'openai';

  constructor(
    private apiKey: string,
    private model: string,
    readonly dimensions: number,
    private baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}

// ─── Jina Embedding ──────────────────────────────────────────────────────────

class JinaEmbedding implements EmbeddingService {
  readonly provider = 'jina';

  constructor(
    private apiKey: string,
    private model: string,
    readonly dimensions: number,
    private baseUrl: string = 'https://api.jina.ai/v1',
  ) {}

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts.map(text => ({ text })),
        dimensions: this.dimensions,
        task: 'retrieval.passage',
        late_chunking: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jina embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  /** Embed a query (different task type for better retrieval) */
  async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: [{ text }],
        dimensions: this.dimensions,
        task: 'retrieval.query',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jina embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]!.embedding;
  }
}

// ─── Gemini Embedding ────────────────────────────────────────────────────────

class GeminiEmbedding implements EmbeddingService {
  readonly provider = 'gemini';

  constructor(
    private apiKey: string,
    private model: string,
    readonly dimensions: number,
    private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.dimensions,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      embedding: { values: number[] };
    };

    return data.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Gemini has a batch embed endpoint
    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:batchEmbedContents?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map(text => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions,
          })),
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini batch embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      embeddings: Array<{ values: number[] }>;
    };

    return data.embeddings.map(e => e.values);
  }
}

// ─── Ollama Embedding ────────────────────────────────────────────────────────

class OllamaEmbedding implements EmbeddingService {
  readonly provider = 'ollama';

  constructor(
    private model: string,
    readonly dimensions: number,
    private baseUrl: string = 'http://localhost:11434/api',
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
    };

    return data.embeddings[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results = await Promise.all(texts.map(t => this.embed(t)));
    return results;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createEmbeddingService(config: TinmemConfig): EmbeddingService {
  const cfg = config.embedding;

  switch (cfg.provider) {
    case 'openai':
      return new OpenAIEmbedding(
        cfg.apiKey,
        cfg.model,
        cfg.dimensions,
        cfg.baseUrl,
      );
    case 'jina':
      return new JinaEmbedding(
        cfg.apiKey,
        cfg.model,
        cfg.dimensions,
        cfg.baseUrl,
      );
    case 'gemini':
      return new GeminiEmbedding(
        cfg.apiKey,
        cfg.model,
        cfg.dimensions,
        cfg.baseUrl,
      );
    case 'ollama':
      return new OllamaEmbedding(
        cfg.model,
        cfg.dimensions,
        cfg.baseUrl,
      );
    default:
      throw new Error(`Unknown embedding provider: ${(cfg as { provider: string }).provider}`);
  }
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map(x => x / norm);
}
