# openclaw-tinmem

**[English](README.md)** | **[中文](README.zh-CN.md)**

> A production-grade persistent memory system for [OpenClaw](https://github.com/openclaw/openclaw) AI assistants — combining structured categorization, hybrid retrieval, and intelligent deduplication.

**openclaw-tinmem** merges the best ideas from two proven memory systems:
- [epro-memory](https://github.com/toby-bridges/epro-memory) — 6-category classification + L0/L1/L2 tiered abstraction + LLM-powered deduplication
- [memory-lancedb-pro](https://github.com/win4r/memory-lancedb-pro) — hybrid retrieval (Vector + BM25) + cross-encoder reranking + multi-scope isolation

---

## Features

| Feature | Description |
|---------|-------------|
| **6-Category Classification** | `profile` / `preferences` / `entities` / `events` / `cases` / `patterns` |
| **L0 / L1 / L2 Abstraction** | Headline (one sentence) / Structured Summary / Full Narrative |
| **LLM Deduplication** | CREATE / MERGE / SKIP decisions prevent redundant memories |
| **Hybrid Retrieval** | Vector search + BM25 full-text search for maximum recall |
| **Cross-encoder Reranking** | Jina / SiliconFlow / Pinecone rerankers for precision |
| **Multi-stage Scoring** | Similarity + recency boost + importance weight + time decay |
| **Multi-scope Isolation** | `global` / `agent:<id>` / `project:<id>` / `user:<id>` / `custom:<name>` |
| **Multi-provider Embeddings** | OpenAI / Jina / Google Gemini / Ollama (local) |
| **Auto-capture & Auto-recall** | Extracts memories after conversation turns, injects before responses |
| **Full CLI** | `list`, `search`, `stats`, `delete`, `export`, `import`, `reembed` |
| **Agent Tools** | `memory_recall`, `memory_store`, `memory_forget`, `memory_update` |
| **SQL Injection Protection** | Input validation + escaping on all database queries |
| **Atomic Updates** | Promise-based write lock + rollback on failure |
| **Context Injection Safety** | XML tag neutralization prevents prompt boundary attacks |

---

## Architecture

```
                     ┌──────────────────────────────────┐
                     │         OpenClaw Hooks            │
                     │  before_agent_start  │  agent_end │
                     └──────────┬───────────┴────────────┘
                                │
                     ┌──────────▼──────────────────────┐
                     │       MemoryManager              │
                     │  processTurn / recall / store     │
                     └──┬────────┬──────────┬──────────┘
                        │        │          │
                   Extractor  Deduplicator  Retriever
                    (LLM)    (LLM+Vector) (Hybrid+Reranker)
                                │          │
                        ┌───────▼──────────▼───────┐
                        │   TinmemDB (LanceDB)     │
                        │  Vector + FTS indexes     │
                        └──────────────────────────┘
```

### Memory Storage Pipeline

```
User Conversation
    │
    ▼
[Hook: agent_end] ─── Triggered after conversation turn
    │
    ▼
[LLM Extraction] ──── Analyze content, classify category, assign importance
    │
    ▼
[Deduplication] ───── Vector pre-filter + LLM decision (CREATE / MERGE / SKIP)
    │
    ▼
[L0/L1/L2] ───────── Generate 3-tier abstraction
    │
    ▼
[Embedding] ───────── Generate vector via embedding model
    │
    ▼
[Write to LanceDB] ── Atomic write with write-lock protection
```

### Memory Retrieval Pipeline

```
User Query
    │
    ▼
[Adaptive Filter] ──── Skip noise (greetings, acknowledgments)
    │
    ├──→ [Vector Search] ── LanceDB ANN (cosine distance)
    │
    ├──→ [BM25 Search] ──── LanceDB FTS (keyword matching)
    │
    ▼
[Merge & Deduplicate]
    │
    ▼
[Reranker] ──────────── Cross-encoder (Jina/SiliconFlow/Pinecone) [optional]
    │
    ▼
[Multi-stage Scoring] ─ vector × w1 + BM25 × w2 + reranker × w3
                         + recency boost + importance weight - time decay
    │
    ▼
[Filter & Top-K] ────── min_score threshold → final results
```

---

## Quick Start

### 1. Install

```bash
npm install openclaw-tinmem
```

### 2. Initialize Configuration

```bash
npx tinmem init
# Creates tinmem.config.json in the current directory
```

Edit `tinmem.config.json` with your API keys:

```json
{
  "embedding": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "text-embedding-3-small"
  },
  "llm": {
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

### 3. Programmatic Usage

```typescript
import { createTinmem } from 'openclaw-tinmem';

const tinmem = await createTinmem('tinmem.config.json');

// Store a memory
await tinmem.store(
  'The user prefers TypeScript and uses React for frontend',
  'preferences',
  { importance: 0.8, tags: ['typescript', 'react'] }
);

// Recall relevant memories
const result = await tinmem.recall('frontend framework preferences');
for (const memory of result.memories) {
  console.log(`[${memory.category}] ${memory.headline} (score: ${memory.score.toFixed(2)})`);
}
```

---

## OpenClaw Integration

Add the plugin to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "tinmem": {
      "enabled": true,
      "configPath": "~/.openclaw/tinmem.json"
    }
  },
  "hooks": {
    "before_agent_start": "tinmem:before_agent_start",
    "agent_end": "tinmem:agent_end",
    "command:new": "tinmem:command_new"
  }
}
```

Create `~/.openclaw/tinmem.json`:

```json
{
  "dbPath": "~/.openclaw/tinmem/lancedb",
  "defaultScope": "global",
  "embedding": {
    "provider": "openai",
    "apiKey": "${OPENAI_API_KEY}",
    "model": "text-embedding-3-small"
  },
  "llm": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o-mini"
  },
  "retrieval": {
    "hybrid": true,
    "reranker": {
      "provider": "jina",
      "apiKey": "${JINA_API_KEY}"
    }
  },
  "autoRecall": true,
  "recallLimit": 8
}
```

Install the skill:

```bash
cp -r skills/tinmem ~/.openclaw/workspace/skills/
```

---

## Memory Categories

| Category | Merge Strategy | What Gets Stored |
|----------|---------------|------------------|
| `profile` | Always merge | Identity, role, expertise, background |
| `preferences` | Topic-based merge | Language, workflow habits, tool preferences |
| `entities` | Merge supported | Projects, teammates, tools, products |
| `events` | Append-only | Decisions, releases, milestones |
| `cases` | Append-only | Problem-solution pairs, debugging sessions |
| `patterns` | Merge supported | Recurring workflows, best practices |

---

## Abstraction Levels

| Level | Content | Token Usage |
|-------|---------|------------|
| `L0` | One-sentence headline (15 words max) | Minimal |
| `L1` | 2-4 sentence structured summary | Moderate |
| `L2` | Full narrative with all context | Maximum |

---

## Multi-scope Isolation

```
global              → Shared across all agents
agent:helper        → Only the 'helper' agent sees these
project:myapp       → Project-specific knowledge
user:alice          → User-specific memories
custom:research     → Custom named namespace
```

---

## CLI Reference

```bash
tinmem init                                    # Generate config file
tinmem list --scope global --limit 20          # List memories
tinmem search "react optimization" --level L1  # Search memories
tinmem stats                                   # Show statistics
tinmem delete <memory-id>                      # Delete a memory
tinmem export -o backup.json                   # Export all memories
tinmem import backup.json                      # Import memories
tinmem reembed --yes                           # Re-embed after model change
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINMEM_EMBEDDING_PROVIDER` | `openai` \| `jina` \| `gemini` \| `ollama` |
| `TINMEM_EMBEDDING_API_KEY` | Embedding API key |
| `TINMEM_EMBEDDING_MODEL` | Embedding model name |
| `TINMEM_LLM_API_KEY` | LLM API key (falls back to `OPENAI_API_KEY`) |
| `TINMEM_LLM_MODEL` | LLM model name |
| `TINMEM_LLM_BASE_URL` | Custom LLM base URL (for OpenAI-compatible APIs) |
| `TINMEM_DB_PATH` | LanceDB database path |
| `TINMEM_DEFAULT_SCOPE` | Default memory scope |
| `TINMEM_DEBUG` | Set `true` for debug logging |
| `TINMEM_AUTO_RECALL` | Set `false` to disable auto-recall |
| `TINMEM_AUTO_CAPTURE` | Set `false` to disable auto-capture |
| `OPENAI_API_KEY` | Fallback for both embedding and LLM |

---

## Security

- **SQL Injection Protection**: All database queries use input validation (`assertUuid`, `assertScope`, `assertCategory`) + SQL literal escaping
- **Atomic Updates**: Promise-based write lock serializes all writes; delete-then-add operations include rollback on failure
- **Context Injection Safety**: `sanitizeForContext()` neutralizes XML tags in stored memories, preventing prompt boundary escape attacks

---

## Credits

This project builds upon ideas from:
- [epro-memory](https://github.com/toby-bridges/epro-memory) by Toby Bridges — structured categorization, L0/L1/L2 tiers, LLM deduplication
- [memory-lancedb-pro](https://github.com/win4r/memory-lancedb-pro) by Win4r — hybrid retrieval, cross-encoder reranking, multi-scope isolation

## License

Apache 2.0 — see [LICENSE](LICENSE)
