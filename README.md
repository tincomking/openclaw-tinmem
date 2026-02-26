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

## Memory Categories (深度解析)

| Category | Merge Strategy | Examples |
|----------|---------------|----------|
| `profile` | Always merge | Name, role, expertise, background |
| `preferences` | Topic-based merge | Language preferences, workflow habits |
| `entities` | Merge supported | Projects, teammates, tools in use |
| `events` | Append-only | Decisions, releases, milestones |
| `cases` | Append-only | Problem-solution pairs, debugging sessions |
| `patterns` | Merge supported | Recurring workflows, best practices |

### 🧑 profile — 身份档案

**什么时候会归类到这里？**

当对话涉及到用户的**身份、角色、技能背景**等相对稳定的个人信息时，这些信息会被归类为 `profile`。

**例子：**

用户说：「我是Leo，在一家AI公司做后端开发，主要用Go和Python。」

这条信息经过LLM分析后，会被归类为 `profile`，因为它描述的是用户的基本身份，不会经常变化。

**存储示例：**
```
Category: profile
Headline: Leo — AI公司后端开发者
L1 Summary: 姓名Leo，后端开发工程师，3年LLM应用经验
L2 Full: 用户Leo，在AI公司担任后端开发，擅长Go和Python，有3年LLM应用经验，目前在开发OpenViking项目...
Scope: user:leo
```

### ⚙️ preferences — 偏好设置

**什么时候会归类到这里？**

当对话中提及用户的**工作习惯、沟通偏好、技术偏好**等可能随场景变化的偏好时。

**例子：**

用户说：「跟我交流时用中文，Python代码不要写类型注解，保持简洁。」

或者：「我习惯每天早上9点查看日程，晚上不要打扰我。」

**存储示例：**
```
Category: preferences
Headline: 中文交流 + Python简洁风格
L1 Summary: 用户偏好中文交流，Python代码不写类型注解保持简洁，后端技术栈Go和Python
L2 Full: 与用户Leo沟通时使用中文，每次回复显示上下文用量百分比，Python代码省略类型注解...
Tags: [chinese, python, backend, 简洁]
```

### 🏢 entities — 实体对象

**什么时候会归类到这里？**

当对话中涉及**项目、工具、团队成员、产品**等相对稳定但可能有变化的实体时。

**例子：**

用户说：「我们正在开发OpenViking，这是一个AI Agent的长期记忆管理系统。」

或者：「前端用React，后端是Go，用PostgreSQL做数据库。」

**存储示例：**
```
Category: entities
Headline: OpenViking — AI Agent记忆管理系统
L1 Summary: OpenViking是AI Agent长期记忆管理系统，支持多级记忆抽象和混合检索
L2 Full: OpenViking项目由Leo主导，是AI Agent的长期记忆管理系统，采用LanceDB作为存储...
Tags: [open-viking, project, memory-system]
Scope: project:openviking
```

### 📅 events — 事件记录

**什么时候会归类到这里？**

当发生**决策、发布、里程碑、重大变更**等需要记录时间线的事件时。

**例子：**

用户说：「我们决定下周一发布v2.0版本。」

或者：「今天和技术团队开了评审会，决定采用新架构。」

**存储示例：**
```
Category: events
Headline: v2.0版本发布日期确定
L1 Summary: 2026-02-26，团队决定下周一发布v2.0版本，包含新的记忆模块
L2 Full: 在2026-02-26的技术评审会上，团队确认v2.0发布计划...
Tags: [release, v2.0, milestone]
Importance: 0.9
```

### 🔧 cases — 案例经验

**什么时候会归类到这里？**

当解决了一个**具体问题、bug、需求**，形成了可供复用的经验时。

**例子：**

用户说：「终于找到那个内存泄漏的原因了，是WebSocket没正确关闭导致的。」

或者：「上次配置OpenAI API超时的问题，通过设置retry解决了。」

**存储示例：**
```
Category: cases
Headline: WebSocket内存泄漏解决方案
L1 Summary: WebSocket连接未正确关闭导致内存泄漏，解决方案是在onClose中调用connection.close()
L2 Full: 用户报告Node.js服务内存持续增长，排查发现WebSocket客户端在组件卸载时未正确关闭...
Tags: [websocket, memory-leak, bug-fix]
Related: [entities:open-viking]
```

### 🔁 patterns — 模式规律

**什么时候会归类到这里？**

当发现**重复出现的工作流、最佳实践、习惯模式**时。

**例子：**

用户说：「我每周五会做代码审查，周一早上处理上周的反馈。」

或者：「每次部署前先跑单元测试，再跑集成测试，这是我们的标准流程。」

**存储示例：**
```
Category: patterns
Headline: 周五代码审查 — 周一处理反馈
L1 Summary: 用户形成固定工作流程：周五Code Review，周一处理反馈，周二开始新任务
L2 Full: 通过多天对话分析，发现用户的工作节奏模式：周一处理积压，周二至周四专注开发...
Tags: [workflow, code-review, weekly-rhythm]
Confidence: 0.85
```

---

## 数据是如何记忆的 — 深入理解存储流程

想象一下：你和AI助手进行了一场关于项目的讨论。当对话结束时，这些信息是如何进入长期记忆的呢？

### 完整的记忆存储流程

```
用户对话
    │
    ▼
[Hook: agent_end] ──── 对话结束触发自动捕获
    │
    ▼
[LLM 分析] ─────────── 分析对话内容，提取关键信息
    │                   - 判断应该归类到哪个类别 (profile/preferences/entities/events/cases/patterns)
    │                   - 判断重要性 (importance: 0.0-1.0)
    │                   - 提取标签 (tags)
    │
    ▼
[去重检查] ────────── LLM判断 CREATE / MERGE / SKIP
    │                   - CREATE: 新信息，创建新记忆
    │                   - MERGE: 相似信息，合并到已有记忆
    │                   - SKIP: 重复/无用信息，跳过
    │
    ▼
[L0/L1/L2 抽象] ───── 生成三级记忆摘要
    │                   - L0: ≤15字标题
    │                   - L1: 2-4句结构化摘要
    │                   - L2: 完整叙事
    │
    ▼
[向量化] ──────────── 使用Embedding模型生成向量
    │                   例如: text-embedding-3-small
    │                   text → [0.123, -0.456, 0.789, ...]
    │
    ▼
[写入 LanceDB] ─────── 存储到本地数据库
                        - Table: memories
                        - Fields: id, category, headline, l0, l1, l2, vector, 
                        -          scope, tags, importance, created_at, updated_at
```

### 实际例子：一条记忆是如何进入LanceDB的

**场景：** 用户说「我是Leo，在一家AI公司做后端开发，主要用Go和Python。」

**第一步：LLM分析**
```json
{
  "category": "profile",
  "importance": 0.9,
  "tags": ["backend", "go", "python", "ai-company"],
  "scope": "user:leo"
}
```

**第二步：去重检查**
- 查询是否有相似记忆 → 没有 → **CREATE**

**第三步：生成三级抽象**
```
L0 (标题): Leo — AI公司后端开发者

L1 (摘要): 姓名Leo，后端开发工程师，3年LLM应用经验，擅长Go和Python，在AI公司工作。

L2 (完整): 用户Leo自我介绍：我是Leo，在一家AI公司做后端开发，主要用Go和Python。
          这是用户的基本身份信息，记录于2026-02-26...
```

**第四步：向量化**
```
原始文本: "Leo — AI公司后端开发者，擅长Go和Python"
向量: [0.021, -0.135, 0.892, 0.045, -0.278, ...]  // 1536维
```

**第五步：写入LanceDB**
```json
{
  "id": "mem_abc123",
  "category": "profile",
  "headline": "Leo — AI公司后端开发者",
  "l0": "Leo — AI公司后端开发者",
  "l1": "姓名Leo，后端开发工程师，3年LLM应用经验，擅长Go和Python",
  "l2": "用户Leo自我介绍：我是Leo，在一家AI公司做后端开发...",
  "vector": [0.021, -0.135, ...],
  "scope": "user:leo",
  "tags": ["backend", "go", "python", "ai-company"],
  "importance": 0.9,
  "created_at": "2026-02-26T23:55:00Z",
  "updated_at": "2026-02-26T23:55:00Z"
}
```

### LanceDB 中的数据结构

tinmem使用LanceDB作为存储引擎，数据保存在 `~/.openclaw/tinmem/lancedb/` 目录下：

```
lancedb/
├── _latest_version
├── memories/
│   ├── _latest_version
│   ├── manifest.toml
│   └── 00000000.parquet  ← 记忆数据存储在这里
```

**Parquet 文件中的列：**
| 列名 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识符 |
| category | string | 分类 (profile/preferences/entities/events/cases/patterns) |
| headline | string | 标题 |
| l0 | string | L0抽象 |
| l1 | string | L1抽象 |
| l2 | string | L2抽象 |
| vector | float[] | 向量 (1536维) |
| scope | string | 作用域 |
| tags | string[] | 标签 |
| importance | float | 重要性 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

---

## 数据是如何被唤醒的 — 深入理解检索流程

当用户再次与AI助手对话时，之前存储的记忆是如何被唤醒的呢？

### 完整的记忆唤醒流程

```
用户提问
    │
    ▼
[Hook: before_agent_start] ──── Agent响应前触发
    │
    ▼
[自适应过滤] ─────────────── 跳过无意义查询
    │                        - "你好"、"在吗" → 直接跳过
    │                        - 有效查询 → 继续
    │
    ▼
[混合检索] ──────────────── 并行执行两种检索
    │
    ├─→ [向量检索] ───────── LanceDB ANN索引
    │    │                    使用余弦相似度/L2距离
    │    │                    例如: "Leo用什么语言"
    │    │                    → 找到向量相似的记忆
    │    │
    │    └─→ 结果A
    │
    └─→ [BM25全文检索] ──── 关键词精确匹配
         │                    利用倒排索引
         │                    例如: "Python Go后端"
         │                    → 找到包含关键词的记忆
         │
         └─→ 结果B
    │
    ▼
[结果合并] ─────────────── 去除重复，合并得分
    │                        如果A和B是同一条记忆，取最高分
    │
    ▼
[Reranker 重排] ───────── Cross-encoder精排 (可选)
                           Jina/SiliconFlow/Pinecone
                           更精确地排序结果
    │
    ▼
[多阶段评分] ───────────── 综合计算最终得分
                           = 向量相似度×0.4 
                           + BM25得分×0.3 
                           + Reranker得分×0.3
                           + 时间衰减加成
                           + 重要性权重
    │
    ▼
[过滤与排序] ───────────── 低于阈值跳过，选取Top-K
    │
    ▼
[注入上下文] ───────────── 将记忆注入Agent上下文
    │
    ▼
Agent 响应
```

### 实际例子：一条记忆是如何被唤醒的

**场景：** 用户问「我之前跟你说过我最擅长什么技术？」

**第一步：自适应过滤**
- 查询「我之前跟你说过我最擅长什么技术？」→ 有效查询 → 继续

**第二步：混合检索**

*向量检索:*
```
查询: "我最擅长什么技术"
向量: [0.019, -0.142, 0.887, ...]
→ 找到最相似的记忆:
  - "Leo — AI公司后端开发者" (相似度: 0.92)
  - "中文交流 + Python简洁风格" (相似度: 0.65)
```

*BM25全文检索:*
```
查询: "擅长 技术 Go Python"
→ 找到包含关键词的记忆:
  - "Leo — AI公司后端开发者" (BM25: 15.3)
  - "Python代码简洁风格" (BM25: 8.7)
```

**第三步：结果合并**
- "Leo — AI公司后端开发者" 同时被两种方式找到 → 合并
- "中文交流 + Python简洁风格" 只被向量找到 → 保留

**第四步：Reranker (可选)**
- 如果配置了Jina Reranker，会更精确地排序

**第五步：多阶段评分**
```
最终得分 = 0.92×0.4 + 15.3×0.3 + 0.85×0.3 + recency + importance
        = 0.368 + 4.59 + 0.255 + 0.1 + 0.9
        = 6.223 (最高)
```

**第六步：过滤与排序**
- 假设 recallLimit = 8, min_score = 0.3
- 选取得分最高的记忆

**第七步：注入上下文**
```json
{
  "recalled_memories": [
    {
      "category": "profile",
      "headline": "Leo — AI公司后端开发者",
      "l1": "姓名Leo，后端开发工程师，3年LLM应用经验，擅长Go和Python",
      "score": 6.223
    },
    {
      "category": "preferences", 
      "headline": "中文交流 + Python简洁风格",
      "l1": "用户偏好中文交流，Python代码不写类型注解保持简洁",
      "score": 3.45
    }
  ]
}
```

**Agent 收到上下文后：**
> 根据之前的记录，你最擅长的是后端开发，主要使用 Go 和 Python 语言，有3年的LLM应用经验。

---

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
