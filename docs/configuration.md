# Configuration Guide

## Configuration File Locations

openclaw-tinmem searches for configuration in this order:

1. Path specified via `--config` CLI flag or `loadConfig(path)` argument
2. `./tinmem.config.json` (current working directory)
3. `~/.openclaw/tinmem.json`
4. `~/.openclaw/tinmem.config.json`

## Full Configuration Reference

```json
{
  "dbPath": "~/.openclaw/tinmem/lancedb",
  "defaultScope": "global",

  "embedding": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "baseUrl": "https://api.openai.com/v1"
  },

  "llm": {
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "maxTokens": 2048,
    "temperature": 0.1
  },

  "deduplication": {
    "strategy": "llm",
    "similarityThreshold": 0.85,
    "llmThreshold": 0.90
  },

  "retrieval": {
    "limit": 10,
    "minScore": 0.3,
    "hybrid": true,
    "candidateMultiplier": 3,
    "reranker": {
      "provider": "jina",
      "apiKey": "jina_...",
      "model": "jina-reranker-v2-base-multilingual",
      "baseUrl": "https://api.jina.ai/v1"
    }
  },

  "scoring": {
    "vectorWeight": 0.4,
    "bm25Weight": 0.3,
    "rerankerWeight": 0.3,
    "recencyBoostDays": 7,
    "recencyBoostFactor": 0.15,
    "importanceWeight": 0.2,
    "timePenaltyDays": 90,
    "timePenaltyFactor": 0.2
  },

  "capture": {
    "auto": true,
    "sessionSummary": true,
    "noiseFilter": true,
    "minContentLength": 20,
    "skipPatterns": [
      "^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great)[\\.!?]?$"
    ]
  },

  "autoRecall": true,
  "recallLimit": 8,
  "recallMinScore": 0.4,
  "debug": false
}
```

---

## Embedding Providers

### OpenAI (Default)

```json
{
  "embedding": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Available models:
- `text-embedding-3-small` (1536 dims, recommended)
- `text-embedding-3-large` (3072 dims, higher quality)
- `text-embedding-ada-002` (1536 dims, legacy)

### Jina (Free Tier Available)

```json
{
  "embedding": {
    "provider": "jina",
    "apiKey": "jina_...",
    "model": "jina-embeddings-v3",
    "dimensions": 1024
  }
}
```

Get a free API key at [jina.ai](https://jina.ai). Supports task-aware embeddings for better retrieval.

### Google Gemini

```json
{
  "embedding": {
    "provider": "gemini",
    "apiKey": "AIza...",
    "model": "text-embedding-004",
    "dimensions": 768
  }
}
```

Available models:
- `text-embedding-004` (768 dims)
- `gemini-embedding-001` (3072 dims, highest quality)

### Ollama (Local, No API Cost)

```json
{
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434/api",
    "dimensions": 768
  }
}
```

Install Ollama from [ollama.ai](https://ollama.ai) and pull the model:
```bash
ollama pull nomic-embed-text
# or for higher quality:
ollama pull mxbai-embed-large
```

---

## Reranker Providers

### Jina Reranker (Recommended)

```json
{
  "retrieval": {
    "reranker": {
      "provider": "jina",
      "apiKey": "jina_...",
      "model": "jina-reranker-v2-base-multilingual"
    }
  }
}
```

Free tier: 1 million tokens/month. Excellent multilingual support.

### SiliconFlow (China-accessible)

```json
{
  "retrieval": {
    "reranker": {
      "provider": "siliconflow",
      "apiKey": "sf-...",
      "model": "BAAI/bge-reranker-v2-m3"
    }
  }
}
```

Low latency from China. Register at [siliconflow.cn](https://siliconflow.cn).

### Pinecone

```json
{
  "retrieval": {
    "reranker": {
      "provider": "pinecone",
      "apiKey": "pcsk_...",
      "model": "bge-reranker-v2-m3"
    }
  }
}
```

---

## Deduplication Strategies

| Strategy | When to Use | Cost |
|----------|-------------|------|
| `llm` | Production, high accuracy needed | 1 LLM call per potential duplicate |
| `vector` | High-volume, speed critical | No extra LLM calls |
| `both` | Balance: vector filters obvious dups, LLM handles ambiguous | Fewer LLM calls than `llm` |

### Threshold Tuning

```json
{
  "deduplication": {
    "strategy": "both",
    "similarityThreshold": 0.85,
    "llmThreshold": 0.92
  }
}
```

- `similarityThreshold`: Vector similarity above this → trigger dedup check
- `llmThreshold`: (For `both` strategy) Vector similarity above this → skip directly

---

## Scoring Weights

When reranker is configured:
```
final_score = vector×0.4 + BM25×0.3 + reranker×0.3
             + recency_boost + importance_boost
             - time_penalty
```

When no reranker (weights auto-normalized):
```
final_score = vector×0.57 + BM25×0.43
             + recency_boost + importance_boost
             - time_penalty
```

---

## Using Custom LLM Base URLs (OpenAI-compatible)

Connect to any OpenAI-compatible API:

```json
{
  "llm": {
    "apiKey": "your-key",
    "model": "qwen2.5-72b-instruct",
    "baseUrl": "https://api.siliconflow.cn/v1"
  }
}
```

Compatible with: SiliconFlow, Ollama (with OpenAI mode), Azure OpenAI, LocalAI, LM Studio, etc.

---

## Scope Configuration

```json
{
  "defaultScope": "agent:myagent"
}
```

Common patterns:
- `"global"` — Single-user setup, all memories shared
- `"agent:${AGENT_ID}"` — Per-agent isolation
- `"user:${USER_ID}"` — Multi-user setup
- `"project:${PROJECT}"` — Project-specific knowledge base
