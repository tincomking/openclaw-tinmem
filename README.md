# openclaw-tinmem

> 🧠 A powerful persistent memory system for [OpenClaw](https://github.com/openclaw/openclaw) AI assistant

**openclaw-tinmem** combines the best of two proven memory systems:
- **epro-memory** — structured 6-category classification & LLM-based intelligent deduplication
- **memory-lancedb-pro** — hybrid retrieval engine (vector + BM25 + reranking) & multi-scope isolation

---

## Features

| Feature | Description |
|---------|-------------|
| **6-Category Classification** | `profile`, `preferences`, `entities`, `events`, `cases`, `patterns` |
| **L0/L1/L2 Abstraction** | Headline / Structured Summary / Full Narrative |
| **LLM Deduplication** | CREATE / MERGE / SKIP decisions prevent redundancy |
| **Hybrid Retrieval** | Vector search + BM25 full-text for maximum recall |
| **Cross-encoder Reranking** | Jina / SiliconFlow / Pinecone rerankers for precision |
| **Multi-stage Scoring** | Similarity + recency boost + importance weight + time decay |
| **Multi-scope Isolation** | `global` / `agent:<id>` / `project:<id>` / `user:<id>` / `custom:<name>` |
| **Multi-provider Embeddings** | OpenAI / Jina / Google Gemini / Ollama (local) |
| **Auto-capture** | Extracts memories after every conversation turn |
| **Auto-recall** | Injects relevant memories before agent responses |
| **Full CLI** | `list`, `search`, `stats`, `delete`, `export`, `import`, `reembed` |
| **Agent Tools** | `memory_recall`, `memory_store`, `memory_forget`, `memory_update` |

---

## Quick Start

### 1. Install

```bash
npm install openclaw-tinmem
# or
pnpm add openclaw-tinmem
```

### 2. Generate Configuration

```bash
npx tinmem init
# Creates tinmem.config.json in current directory
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

### 3. Use Programmatically

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

### Configuration

Add the tinmem plugin to `~/.openclaw/openclaw.json`:

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

### Skill Installation

Copy the skill to your OpenClaw workspace:

```bash
cp -r skills/tinmem ~/.openclaw/workspace/skills/
```

This adds `memory_recall`, `memory_store`, `memory_forget`, and `memory_update` as agent tools.

### Environment Variables

All configuration fields can be overridden via environment:

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
| `OPENAI_API_KEY` | Used for both embedding and LLM if no specific key set |

---

## Memory Categories

| Category | Merge Strategy | Examples |
|----------|---------------|---------|
| `profile` | Always merge | Name, role, expertise, background |
| `preferences` | Topic-based merge | Language preferences, workflow habits |
| `entities` | Merge supported | Projects, teammates, tools in use |
| `events` | Append-only | Decisions, releases, milestones |
| `cases` | Append-only | Problem-solution pairs, debugging sessions |
| `patterns` | Merge supported | Recurring workflows, best practices |

## Abstraction Levels

| Level | Content | Token Usage |
|-------|---------|------------|
| `L0` | One-sentence headline (≤15 words) | Minimal |
| `L1` | 2-4 sentence structured summary | Moderate |
| `L2` | Full narrative with all context | Maximum |

---

## CLI Usage

```bash
# Initialize configuration
tinmem init

# List memories
tinmem list --scope global --limit 20

# Search memories
tinmem search "react performance optimization" --level L1

# Show statistics
tinmem stats

# Delete a memory
tinmem delete <memory-id>

# Export all memories
tinmem export -o backup.json

# Import memories
tinmem import backup.json

# Re-embed after changing embedding model
tinmem reembed --yes
```

---

## Retrieval Pipeline

```
User Query
    │
    ▼
[Adaptive Filter] ─── Skip noise queries (greetings, etc.)
    │
    ▼
[Vector Search] ──────── LanceDB ANN (L2/cosine distance)
    │
    ▼
[BM25 Full-text] ─────── LanceDB FTS index (keyword recall)
    │
    ▼
[Merge Results] ──────── Deduplicate & combine scores
    │
    ▼
[Reranker] ───────────── Jina/SiliconFlow/Pinecone (optional)
    │
    ▼
[Multi-stage Scoring] ── vector×0.4 + BM25×0.3 + reranker×0.3
                          + recency boost + importance weight
                          - time decay penalty
    │
    ▼
[Filter & Rank] ─────── min_score threshold + top-K selection
    │
    ▼
Retrieved Memories
```

---

## Multi-scope Isolation

```
Scope Examples:
  global              → All agents share these memories
  agent:helper        → Only the 'helper' agent sees these
  project:myapp       → Project-specific knowledge
  user:alice          → User-specific memories
  custom:research     → Custom named namespace
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 — see [LICENSE](LICENSE)
