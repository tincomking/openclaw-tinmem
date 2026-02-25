/**
 * openclaw-tinmem - Multi-provider reranker
 * Supports: Jina, SiliconFlow, Pinecone
 */

import type { TinmemConfig } from './config.js';

export interface RerankItem {
  text: string;
  index: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

export interface RerankerService {
  rerank(query: string, documents: string[]): Promise<RerankResult[]>;
  readonly provider: string;
}

// ─── Jina Reranker ───────────────────────────────────────────────────────────

class JinaReranker implements RerankerService {
  readonly provider = 'jina';

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = 'https://api.jina.ai/v1',
  ) {}

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jina reranker error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map(r => ({
      index: r.index,
      score: r.relevance_score,
    }));
  }
}

// ─── SiliconFlow Reranker ─────────────────────────────────────────────────────

class SiliconFlowReranker implements RerankerService {
  readonly provider = 'siliconflow';

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = 'https://api.siliconflow.cn/v1',
  ) {}

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        return_documents: false,
        top_n: documents.length,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SiliconFlow reranker error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map(r => ({
      index: r.index,
      score: r.relevance_score,
    }));
  }
}

// ─── Pinecone Reranker ────────────────────────────────────────────────────────

class PineconeReranker implements RerankerService {
  readonly provider = 'pinecone';

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = 'https://api.pinecone.io',
  ) {}

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: documents.map(text => ({ text })),
        return_documents: false,
        top_n: documents.length,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pinecone reranker error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      results: Array<{ index: number; score: number }>;
    };

    return data.results.map(r => ({
      index: r.index,
      score: r.score,
    }));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createReranker(config: TinmemConfig): RerankerService | null {
  const rerankerConfig = config.retrieval.reranker;
  if (!rerankerConfig) return null;

  switch (rerankerConfig.provider) {
    case 'jina':
      return new JinaReranker(
        rerankerConfig.apiKey,
        rerankerConfig.model ?? 'jina-reranker-v2-base-multilingual',
        rerankerConfig.baseUrl,
      );
    case 'siliconflow':
      return new SiliconFlowReranker(
        rerankerConfig.apiKey,
        rerankerConfig.model ?? 'BAAI/bge-reranker-v2-m3',
        rerankerConfig.baseUrl,
      );
    case 'pinecone':
      return new PineconeReranker(
        rerankerConfig.apiKey,
        rerankerConfig.model ?? 'bge-reranker-v2-m3',
        rerankerConfig.baseUrl,
      );
    default:
      return null;
  }
}
