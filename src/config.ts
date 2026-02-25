/**
 * openclaw-tinmem - Configuration schema and validation
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Embedding Provider Schemas ──────────────────────────────────────────────

const OpenAIEmbeddingSchema = z.object({
  provider: z.literal('openai'),
  apiKey: z.string().min(1),
  model: z.string().default('text-embedding-3-small'),
  baseUrl: z.string().optional(),
  dimensions: z.number().int().positive().default(1536),
});

const JinaEmbeddingSchema = z.object({
  provider: z.literal('jina'),
  apiKey: z.string().min(1),
  model: z.string().default('jina-embeddings-v3'),
  baseUrl: z.string().optional().default('https://api.jina.ai/v1'),
  dimensions: z.number().int().positive().default(1024),
});

const GeminiEmbeddingSchema = z.object({
  provider: z.literal('gemini'),
  apiKey: z.string().min(1),
  model: z.string().default('text-embedding-004'),
  baseUrl: z.string().optional().default('https://generativelanguage.googleapis.com/v1beta'),
  dimensions: z.number().int().positive().default(768),
});

const OllamaEmbeddingSchema = z.object({
  provider: z.literal('ollama'),
  apiKey: z.string().optional().default('ollama'),
  model: z.string().default('nomic-embed-text'),
  baseUrl: z.string().optional().default('http://localhost:11434/api'),
  dimensions: z.number().int().positive().default(768),
});

const EmbeddingConfigSchema = z.discriminatedUnion('provider', [
  OpenAIEmbeddingSchema,
  JinaEmbeddingSchema,
  GeminiEmbeddingSchema,
  OllamaEmbeddingSchema,
]);

// ─── LLM Schema ──────────────────────────────────────────────────────────────

const LLMConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o-mini'),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive().default(2048),
  temperature: z.number().min(0).max(2).default(0.1),
});

// ─── Reranker Schemas ────────────────────────────────────────────────────────

const JinaRerankerSchema = z.object({
  provider: z.literal('jina'),
  apiKey: z.string().min(1),
  model: z.string().default('jina-reranker-v2-base-multilingual'),
  baseUrl: z.string().optional().default('https://api.jina.ai/v1'),
});

const SiliconFlowRerankerSchema = z.object({
  provider: z.literal('siliconflow'),
  apiKey: z.string().min(1),
  model: z.string().default('BAAI/bge-reranker-v2-m3'),
  baseUrl: z.string().optional().default('https://api.siliconflow.cn/v1'),
});

const PineconeRerankerSchema = z.object({
  provider: z.literal('pinecone'),
  apiKey: z.string().min(1),
  model: z.string().default('bge-reranker-v2-m3'),
  baseUrl: z.string().optional(),
});

const RerankerConfigSchema = z.discriminatedUnion('provider', [
  JinaRerankerSchema,
  SiliconFlowRerankerSchema,
  PineconeRerankerSchema,
]).optional();

// ─── Main Config Schema ──────────────────────────────────────────────────────

export const TinmemConfigSchema = z.object({
  /** Path to LanceDB database directory */
  dbPath: z.string().default(`${homedir()}/.openclaw/tinmem/lancedb`),

  /** Default memory scope when none specified */
  defaultScope: z.string().default('global'),

  /** Embedding service configuration */
  embedding: EmbeddingConfigSchema,

  /** LLM service for extraction and deduplication */
  llm: LLMConfigSchema,

  /** Deduplication configuration */
  deduplication: z.object({
    /** Strategy: llm (accurate), vector (fast), both (configurable) */
    strategy: z.enum(['llm', 'vector', 'both']).default('llm'),
    /** Cosine similarity threshold to trigger dedup check (0.0-1.0) */
    similarityThreshold: z.number().min(0).max(1).default(0.85),
    /** For 'both' strategy: use LLM when vector score > this value */
    llmThreshold: z.number().min(0).max(1).default(0.90),
  }).default({}),

  /** Retrieval configuration */
  retrieval: z.object({
    /** Default number of memories to retrieve */
    limit: z.number().int().positive().default(10),
    /** Minimum combined score to include in results */
    minScore: z.number().min(0).max(1).default(0.3),
    /** Enable BM25 full-text search alongside vector search */
    hybrid: z.boolean().default(true),
    /** Cross-encoder reranker (optional, improves precision) */
    reranker: RerankerConfigSchema,
    /** Number of candidates to fetch before reranking */
    candidateMultiplier: z.number().int().positive().default(3),
  }).default({}),

  /** Multi-stage scoring weights */
  scoring: z.object({
    /** Weight for vector similarity score */
    vectorWeight: z.number().min(0).max(1).default(0.4),
    /** Weight for BM25 full-text score */
    bm25Weight: z.number().min(0).max(1).default(0.3),
    /** Weight for reranker score (used when reranker is configured) */
    rerankerWeight: z.number().min(0).max(1).default(0.3),
    /** Boost memories created/accessed within this many days */
    recencyBoostDays: z.number().int().positive().default(7),
    /** Maximum recency boost factor */
    recencyBoostFactor: z.number().min(0).max(1).default(0.15),
    /** Importance multiplier (0=no boost, 1=double score for max importance) */
    importanceWeight: z.number().min(0).max(1).default(0.2),
    /** After this many days, apply time penalty */
    timePenaltyDays: z.number().int().positive().default(90),
    /** Maximum time penalty reduction */
    timePenaltyFactor: z.number().min(0).max(1).default(0.2),
  }).default({}),

  /** Memory capture configuration */
  capture: z.object({
    /** Auto-capture memories after each conversation turn */
    auto: z.boolean().default(true),
    /** Generate session summary when starting a new session */
    sessionSummary: z.boolean().default(true),
    /** Filter out low-quality/noise content before storing */
    noiseFilter: z.boolean().default(true),
    /** Minimum content length to consider for storage */
    minContentLength: z.number().int().positive().default(20),
    /** Skip capture for these types of messages (greetings, etc.) */
    skipPatterns: z.array(z.string()).default([
      '^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great)[\\.!?]?$',
    ]),
  }).default({}),

  /** Auto-recall: inject memories into agent context */
  autoRecall: z.boolean().default(true),

  /** Maximum memories to inject into agent context */
  recallLimit: z.number().int().positive().default(8),

  /** Minimum score for auto-recalled memories */
  recallMinScore: z.number().min(0).max(1).default(0.4),

  /** Enable debug logging */
  debug: z.boolean().default(false),
});

export type TinmemConfig = z.infer<typeof TinmemConfigSchema>;

// ─── Config Loading ───────────────────────────────────────────────────────────

const CONFIG_PATHS = [
  join(process.cwd(), 'tinmem.config.json'),
  join(homedir(), '.openclaw', 'tinmem.json'),
  join(homedir(), '.openclaw', 'tinmem.config.json'),
];

/**
 * Load and validate configuration from file or environment variables
 */
export function loadConfig(configPath?: string): TinmemConfig {
  let rawConfig: Record<string, unknown> = {};

  // Try to load from file
  const searchPaths = configPath ? [configPath] : CONFIG_PATHS;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      rawConfig = JSON.parse(content) as Record<string, unknown>;
      break;
    }
  }

  // Override with environment variables
  const envOverrides = buildEnvOverrides();
  const merged = deepMerge(rawConfig, envOverrides);

  // Parse and validate
  const result = TinmemConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Invalid tinmem configuration:\n${result.error.errors
        .map(e => `  ${e.path.join('.')}: ${e.message}`)
        .join('\n')}`
    );
  }

  return result.data;
}

function buildEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  // Embedding
  const embProvider = process.env.TINMEM_EMBEDDING_PROVIDER;
  if (embProvider) {
    overrides.embedding = {
      provider: embProvider,
      apiKey: process.env.TINMEM_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || process.env.JINA_API_KEY,
      model: process.env.TINMEM_EMBEDDING_MODEL,
      baseUrl: process.env.TINMEM_EMBEDDING_BASE_URL,
    };
  } else if (process.env.OPENAI_API_KEY && !overrides.embedding) {
    overrides.embedding = { provider: 'openai', apiKey: process.env.OPENAI_API_KEY };
  }

  // LLM
  if (process.env.TINMEM_LLM_API_KEY || process.env.OPENAI_API_KEY) {
    overrides.llm = {
      apiKey: process.env.TINMEM_LLM_API_KEY || process.env.OPENAI_API_KEY,
      model: process.env.TINMEM_LLM_MODEL,
      baseUrl: process.env.TINMEM_LLM_BASE_URL,
    };
  }

  if (process.env.TINMEM_DB_PATH) overrides.dbPath = process.env.TINMEM_DB_PATH;
  if (process.env.TINMEM_DEFAULT_SCOPE) overrides.defaultScope = process.env.TINMEM_DEFAULT_SCOPE;
  if (process.env.TINMEM_DEBUG === 'true') overrides.debug = true;
  if (process.env.TINMEM_AUTO_RECALL === 'false') overrides.autoRecall = false;
  if (process.env.TINMEM_AUTO_CAPTURE === 'false') {
    overrides.capture = { auto: false };
  }

  return overrides;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object') {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Generate a sample config file
 */
export function generateSampleConfig(): string {
  return JSON.stringify({
    dbPath: `${homedir()}/.openclaw/tinmem/lancedb`,
    defaultScope: 'global',
    embedding: {
      provider: 'openai',
      apiKey: 'YOUR_OPENAI_API_KEY',
      model: 'text-embedding-3-small',
    },
    llm: {
      apiKey: 'YOUR_OPENAI_API_KEY',
      model: 'gpt-4o-mini',
    },
    deduplication: {
      strategy: 'llm',
      similarityThreshold: 0.85,
    },
    retrieval: {
      limit: 10,
      minScore: 0.3,
      hybrid: true,
      reranker: {
        provider: 'jina',
        apiKey: 'YOUR_JINA_API_KEY',
        model: 'jina-reranker-v2-base-multilingual',
      },
    },
    scoring: {
      vectorWeight: 0.4,
      bm25Weight: 0.3,
      rerankerWeight: 0.3,
      recencyBoostDays: 7,
      recencyBoostFactor: 0.15,
      importanceWeight: 0.2,
      timePenaltyDays: 90,
      timePenaltyFactor: 0.2,
    },
    capture: {
      auto: true,
      sessionSummary: true,
      noiseFilter: true,
    },
    autoRecall: true,
    recallLimit: 8,
    recallMinScore: 0.4,
    debug: false,
  }, null, 2);
}
