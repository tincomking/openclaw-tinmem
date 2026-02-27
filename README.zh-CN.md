# openclaw-tinmem

**[English](README.md)** | **[中文](README.zh-CN.md)**

> 面向 [OpenClaw](https://github.com/openclaw/openclaw) AI 助手的生产级持久化记忆系统 —— 结合结构化分类、混合检索与智能去重。

**openclaw-tinmem** 融合了两个经过验证的记忆系统的精华：
- [epro-memory](https://github.com/toby-bridges/epro-memory) — 6 类分类 + L0/L1/L2 分层抽象 + LLM 驱动去重
- [memory-lancedb-pro](https://github.com/win4r/memory-lancedb-pro) — 混合检索（向量 + BM25）+ 交叉编码器重排序 + 多作用域隔离

---

## 功能特性

| 功能 | 描述 |
|------|------|
| **6 类分类** | `profile` / `preferences` / `entities` / `events` / `cases` / `patterns` |
| **L0 / L1 / L2 抽象** | 标题（一句话）/ 结构化摘要 / 完整叙述 |
| **LLM 去重** | CREATE / MERGE / SKIP 决策，防止冗余记忆 |
| **混合检索** | 向量搜索 + BM25 全文搜索，最大化召回率 |
| **交叉编码器重排序** | Jina / SiliconFlow / Pinecone 重排序器，提升精确度 |
| **多阶段评分** | 相似度 + 时效加成 + 重要性权重 + 时间衰减 |
| **多作用域隔离** | `global` / `agent:<id>` / `project:<id>` / `user:<id>` / `custom:<name>` |
| **多供应商嵌入** | OpenAI / Jina / Google Gemini / Ollama（本地） |
| **自动捕获与自动召回** | 对话后自动提取记忆，响应前自动注入上下文 |
| **完整 CLI** | `list`、`search`、`stats`、`delete`、`export`、`import`、`reembed` |
| **Agent 工具** | `memory_recall`、`memory_store`、`memory_forget`、`memory_update` |
| **SQL 注入防护** | 所有数据库查询均采用输入验证 + 转义双重防护 |
| **原子更新** | 基于 Promise 的写锁 + 失败自动回滚 |
| **上下文注入安全** | XML 标签中和，防止提示词边界逃逸攻击 |

---

## 架构

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
                    (LLM)    (LLM+向量)   (混合+重排序)
                                │          │
                        ┌───────▼──────────▼───────┐
                        │   TinmemDB (LanceDB)     │
                        │  向量 + 全文搜索索引       │
                        └──────────────────────────┘
```

### 记忆存储管线

```
用户对话
    │
    ▼
[Hook: agent_end] ─── 对话轮次结束后触发
    │
    ▼
[LLM 提取] ────────── 分析内容、分类、赋予重要性
    │
    ▼
[去重] ────────────── 向量预过滤 + LLM 决策（CREATE / MERGE / SKIP）
    │
    ▼
[L0/L1/L2] ────────── 生成三层抽象
    │
    ▼
[嵌入] ────────────── 通过嵌入模型生成向量
    │
    ▼
[写入 LanceDB] ────── 原子写入，写锁保护
```

### 记忆检索管线

```
用户查询
    │
    ▼
[自适应过滤] ──────── 跳过噪声（问候语、确认语）
    │
    ├──→ [向量搜索] ── LanceDB ANN（余弦距离）
    │
    ├──→ [BM25 搜索] ── LanceDB FTS（关键词匹配）
    │
    ▼
[合并去重]
    │
    ▼
[重排序] ────────────── 交叉编码器（Jina/SiliconFlow/Pinecone）[可选]
    │
    ▼
[多阶段评分] ────────── vector × w1 + BM25 × w2 + reranker × w3
                         + 时效加成 + 重要性权重 - 时间衰减
    │
    ▼
[过滤 & Top-K] ──────── min_score 阈值 → 最终结果
```

---

## 快速开始

### 1. 安装

```bash
npm install openclaw-tinmem
```

### 2. 初始化配置

```bash
npx tinmem init
# 在当前目录创建 tinmem.config.json
```

编辑 `tinmem.config.json`，填入你的 API 密钥：

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

### 3. 编程使用

```typescript
import { createTinmem } from 'openclaw-tinmem';

const tinmem = await createTinmem('tinmem.config.json');

// 存储记忆
await tinmem.store(
  '用户偏好 TypeScript，前端使用 React',
  'preferences',
  { importance: 0.8, tags: ['typescript', 'react'] }
);

// 召回相关记忆
const result = await tinmem.recall('前端框架偏好');
for (const memory of result.memories) {
  console.log(`[${memory.category}] ${memory.headline} (分数: ${memory.score.toFixed(2)})`);
}
```

---

## OpenClaw 集成

将插件添加到 `~/.openclaw/openclaw.json`：

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

创建 `~/.openclaw/tinmem.json`：

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

安装 Skill：

```bash
cp -r skills/tinmem ~/.openclaw/workspace/skills/
```

---

## 记忆分类

| 分类 | 合并策略 | 存储内容 |
|------|----------|----------|
| `profile` | 始终合并 | 身份、角色、专业领域、背景 |
| `preferences` | 按主题合并 | 语言、工作流习惯、工具偏好 |
| `entities` | 支持合并 | 项目、团队成员、工具、产品 |
| `events` | 仅追加 | 决策、发布、里程碑 |
| `cases` | 仅追加 | 问题-解决方案对、调试过程 |
| `patterns` | 支持合并 | 常见工作流、最佳实践 |

---

## 抽象层级

| 层级 | 内容 | Token 消耗 |
|------|------|-----------|
| `L0` | 一句话标题（最多 15 词） | 极少 |
| `L1` | 2-4 句结构化摘要 | 适中 |
| `L2` | 包含所有上下文的完整叙述 | 最多 |

---

## 多作用域隔离

```
global              → 所有 Agent 共享
agent:helper        → 仅 'helper' Agent 可见
project:myapp       → 项目专属知识
user:alice          → 用户专属记忆
custom:research     → 自定义命名空间
```

---

## CLI 参考

```bash
tinmem init                                    # 生成配置文件
tinmem list --scope global --limit 20          # 列出记忆
tinmem search "react optimization" --level L1  # 搜索记忆
tinmem stats                                   # 显示统计信息
tinmem delete <memory-id>                      # 删除记忆
tinmem export -o backup.json                   # 导出所有记忆
tinmem import backup.json                      # 导入记忆
tinmem reembed --yes                           # 切换嵌入模型后重新嵌入
```

---

## 环境变量

| 变量 | 描述 |
|------|------|
| `TINMEM_EMBEDDING_PROVIDER` | `openai` \| `jina` \| `gemini` \| `ollama` |
| `TINMEM_EMBEDDING_API_KEY` | 嵌入 API 密钥 |
| `TINMEM_EMBEDDING_MODEL` | 嵌入模型名称 |
| `TINMEM_LLM_API_KEY` | LLM API 密钥（回退到 `OPENAI_API_KEY`） |
| `TINMEM_LLM_MODEL` | LLM 模型名称 |
| `TINMEM_LLM_BASE_URL` | 自定义 LLM 基础 URL（兼容 OpenAI 的 API） |
| `TINMEM_DB_PATH` | LanceDB 数据库路径 |
| `TINMEM_DEFAULT_SCOPE` | 默认记忆作用域 |
| `TINMEM_DEBUG` | 设为 `true` 开启调试日志 |
| `TINMEM_AUTO_RECALL` | 设为 `false` 禁用自动召回 |
| `TINMEM_AUTO_CAPTURE` | 设为 `false` 禁用自动捕获 |
| `OPENAI_API_KEY` | 嵌入和 LLM 的回退密钥 |

---

## 安全

- **SQL 注入防护**：所有数据库查询均使用输入验证（`assertUuid`、`assertScope`、`assertCategory`）+ SQL 字面量转义
- **原子更新**：基于 Promise 的写锁串行化所有写操作；delete-then-add 操作包含失败回滚
- **上下文注入安全**：`sanitizeForContext()` 中和存储记忆中的 XML 标签，防止提示词边界逃逸攻击

---

## 致谢

本项目基于以下项目的思路构建：
- [epro-memory](https://github.com/toby-bridges/epro-memory) by Toby Bridges — 结构化分类、L0/L1/L2 分层、LLM 去重
- [memory-lancedb-pro](https://github.com/win4r/memory-lancedb-pro) by Win4r — 混合检索、交叉编码器重排序、多作用域隔离

## 许可证

Apache 2.0 — 详见 [LICENSE](LICENSE)
