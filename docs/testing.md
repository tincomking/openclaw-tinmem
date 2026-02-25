# Testing & Validation Guide

This guide covers how to test and validate openclaw-tinmem integration with OpenClaw.

---

## Unit Tests

Run the test suite:

```bash
npm test
# or with coverage
npm run test:coverage
```

Expected output:
```
PASS test/config.test.ts
PASS test/scorer.test.ts
PASS test/prompts.test.ts
PASS test/embeddings.test.ts
PASS test/extractor.test.ts
PASS test/deduplicator.test.ts

Test Suites: 6 passed, 6 total
Tests:       ~50 passed, ~50 total
```

---

## Integration Testing

### 1. Basic Connectivity Test

Create `test-integration.ts`:

```typescript
import { createTinmem } from 'openclaw-tinmem';

async function testBasic() {
  console.log('1. Initializing tinmem...');
  const mem = await createTinmem({
    embedding: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    llm: { apiKey: process.env.OPENAI_API_KEY! },
    dbPath: '/tmp/tinmem-test-db',
    debug: true,
  });
  console.log('✓ Initialized');

  // 2. Store a memory
  console.log('2. Storing memory...');
  const stored = await mem.store(
    'The user is a senior TypeScript developer who prefers functional programming.',
    'profile',
    { importance: 0.9, tags: ['typescript', 'functional'] }
  );
  console.log(`✓ Stored ${stored.length} memories`);

  // 3. Recall
  console.log('3. Recalling memories...');
  const result = await mem.recall('programming experience and preferences');
  console.log(`✓ Found ${result.memories.length} memories in ${result.timingMs}ms`);
  for (const m of result.memories) {
    console.log(`  [${m.category}] (score: ${m.score.toFixed(2)}) ${m.headline}`);
  }

  // 4. Stats
  const stats = await mem.getStats();
  console.log(`\n✓ Stats: ${stats.total} total memories`);

  console.log('\n✅ All basic tests passed!');
}

testBasic().catch(console.error);
```

Run:
```bash
npx ts-node --esm test-integration.ts
```

---

### 2. Memory Category Test

```typescript
import { createTinmem } from 'openclaw-tinmem';

async function testCategories() {
  const mem = await createTinmem({ ... });

  const testCases = [
    { content: 'User is named Alice and is a software engineer at TechCorp', category: 'profile' as const },
    { content: 'User prefers tabs over spaces for indentation', category: 'preferences' as const },
    { content: 'The main project is called ProjectX, using Next.js and PostgreSQL', category: 'entities' as const },
    { content: 'User decided to migrate from REST to GraphQL on March 1st', category: 'events' as const },
    { content: 'Fixed a N+1 query bug by implementing DataLoader pattern', category: 'cases' as const },
    { content: 'User always starts features by writing the API contract first', category: 'patterns' as const },
  ];

  console.log('Testing all 6 memory categories:\n');

  for (const tc of testCases) {
    const stored = await mem.store(tc.content, tc.category);
    const recalled = await mem.recall(tc.content.slice(0, 30));
    console.log(`✓ ${tc.category}: stored=${stored.length}, recalled=${recalled.memories.length}`);
  }

  const stats = await mem.getStats();
  console.log('\nCategory distribution:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
}
```

---

### 3. Deduplication Test

```typescript
async function testDeduplication() {
  const mem = await createTinmem({ ...config, debug: true });

  // Store initial memory
  await mem.store('User prefers dark mode in VS Code', 'preferences');

  // Try to store similar memory (should MERGE)
  await mem.store('The user likes dark themes in their code editor', 'preferences');

  // Try to store clearly different memory (should CREATE)
  await mem.store('User drinks coffee in the morning before coding', 'preferences');

  const stats = await mem.getStats();
  console.log(`Total memories after dedup test: ${stats.total}`);
  // Should be 2 (merged dark mode + new coffee preference), not 3

  const memories = await mem.list({ categories: ['preferences'] });
  for (const m of memories) {
    console.log(`  - ${m.headline}`);
  }
}
```

---

### 4. Hybrid Retrieval Test

```typescript
async function testRetrieval() {
  const mem = await createTinmem({ ...config });

  // Store memories
  await mem.store('User is building a React application for e-commerce', 'entities');
  await mem.store('User prefers Next.js over Create React App', 'preferences');
  await mem.store('Fixed a React hydration error in Next.js 13 app router', 'cases');
  await mem.store('User follows atomic design principles for React components', 'patterns');

  // Test semantic search
  const result1 = await mem.recall('React framework choices');
  console.log(`Semantic search: ${result1.memories.length} results`);

  // Test keyword search (BM25)
  const result2 = await mem.recall('Next.js app router hydration');
  console.log(`Keyword search: ${result2.memories.length} results`);
  console.log(`Retrieval time: ${result2.timingMs}ms`);

  // Verify scoring
  for (const m of result2.memories) {
    console.log(`  score=${m.score.toFixed(3)} vector=${m.vectorScore.toFixed(3)} bm25=${m.bm25Score.toFixed(3)}`);
  }
}
```

---

### 5. OpenClaw Hook Test

```typescript
import { handleBeforeAgentStart, handleAgentEnd, handleCommandNew } from 'openclaw-tinmem';

async function testHooks() {
  const config = loadConfig();

  // Simulate a conversation turn
  console.log('1. Testing agent_end hook (capture)...');
  const agentEndResult = await handleAgentEnd({
    sessionId: 'test-session-1',
    agentId: 'main-agent',
    userMessage: 'I am working on a new TypeScript monorepo with Turborepo',
    assistantResponse: 'Turborepo is great for TypeScript monorepos. Let me help you set it up.',
  }, config);
  console.log(`✓ Captured ${agentEndResult.storedCount} memories`);

  // Simulate next message
  console.log('2. Testing before_agent_start hook (recall)...');
  const beforeResult = await handleBeforeAgentStart({
    sessionId: 'test-session-1',
    agentId: 'main-agent',
    userMessage: 'What build tool should I use for this project?',
  }, config);
  console.log(`✓ Recalled ${beforeResult.memoriesFound} memories`);

  if (beforeResult.contextInjection) {
    console.log('Context injected:');
    console.log(beforeResult.contextInjection);
  }
}
```

---

### 6. CLI Validation

```bash
# 1. Initialize config
tinmem init --output /tmp/test-tinmem.json

# 2. Check stats (should be 0 initially)
tinmem stats --config /tmp/test-tinmem.json

# 3. Search (should return empty)
tinmem search "typescript" --config /tmp/test-tinmem.json

# 4. Export (empty)
tinmem export --output /tmp/test-export.json --config /tmp/test-tinmem.json

# 5. Import (test round-trip)
tinmem import /tmp/test-export.json --config /tmp/test-tinmem.json

# 6. List memories
tinmem list --config /tmp/test-tinmem.json --json
```

---

## Performance Benchmarks

Expected performance targets:

| Operation | Target | Acceptable |
|-----------|--------|-----------|
| Embedding generation | < 500ms | < 1s |
| Vector search (1K memories) | < 50ms | < 100ms |
| Hybrid search (1K memories) | < 100ms | < 200ms |
| Full pipeline with reranker | < 500ms | < 1s |
| Memory extraction (LLM) | < 2s | < 5s |
| Deduplication check | < 1s | < 3s |

---

## Verifying OpenClaw Integration

After installing, verify the memory system is active in OpenClaw:

1. **Start a conversation** and mention personal information:
   ```
   "I'm a TypeScript developer working on a React e-commerce app"
   ```

2. **Start a new message** and ask about something mentioned earlier:
   ```
   "What framework am I using for the frontend?"
   ```

3. **Check that the agent references** the stored memory correctly.

4. **Use the CLI to verify** memories were captured:
   ```bash
   tinmem list --scope global
   tinmem search "typescript developer"
   ```

5. **Check debug logs** in OpenClaw if memories aren't being recalled:
   ```bash
   TINMEM_DEBUG=true openclaw start
   ```

---

## Common Issues

### No memories being stored

1. Check `capture.auto` is `true` in config
2. Verify LLM API key is valid
3. Enable debug mode: `TINMEM_DEBUG=true`
4. Check if messages are too short (< `capture.minContentLength`)

### No memories being recalled

1. Check `autoRecall` is `true` in config
2. Verify embedding API key works
3. Lower `recallMinScore` threshold (try 0.2)
4. Check correct scope is configured

### Duplicate memories appearing

1. Switch to `"strategy": "llm"` for smarter deduplication
2. Lower `similarityThreshold` (try 0.75)
3. Check append-only categories: `events` and `cases` always create new entries

### Reranker not working

1. Verify reranker API key is set correctly
2. Check API rate limits / quota
3. Remove reranker config to use hybrid-only retrieval as fallback
