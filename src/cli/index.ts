#!/usr/bin/env node
/**
 * openclaw-tinmem CLI
 * Memory management command-line interface
 */

import { program } from 'commander';
import { loadConfig } from '../config.js';
import { getMemoryManager } from '../memory/manager.js';
import chalk from 'chalk';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Read version from package.json
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = require(join(__dirname, '../../package.json')) as { version: string };

program
  .name('tinmem')
  .description('openclaw-tinmem: AI memory management CLI')
  .version(pkg.version)
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --debug', 'Enable debug output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts() as { config?: string; debug?: boolean };
    if (opts.debug) {
      process.env.TINMEM_DEBUG = 'true';
    }
  });

// ─── list ────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List memories')
  .option('-s, --scope <scope>', 'Filter by scope (e.g., global, agent:myagent)')
  .option('-c, --category <categories...>', 'Filter by categories')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('-o, --order <field>', 'Order by: createdAt, importance, accessCount', 'createdAt')
  .option('--asc', 'Sort ascending')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { table } = await import('table');
    const config = loadConfig((program.opts() as { config?: string }).config);
    const manager = await getMemoryManager(config);

    const memories = await manager.list({
      scope: opts.scope,
      categories: opts.category,
      limit: parseInt(opts.limit as string, 10),
      orderBy: opts.order as 'createdAt' | 'importance' | 'accessCount',
      orderDir: opts.asc ? 'asc' : 'desc',
    });

    if (opts.json) {
      console.log(JSON.stringify(memories, null, 2));
      return;
    }

    if (memories.length === 0) {
      console.log(chalk.yellow('No memories found.'));
      return;
    }

    const data = [
      ['ID', 'Category', 'Scope', 'Importance', 'Headline', 'Created'].map(h => chalk.bold(h)),
      ...memories.map(m => [
        m.id.slice(0, 8),
        chalk.cyan(m.category),
        chalk.gray(m.scope),
        chalk.yellow(m.importance.toFixed(2)),
        m.headline.slice(0, 60),
        new Date(m.createdAt).toLocaleDateString(),
      ]),
    ];

    const output = table(data, {
      columns: {
        4: { width: 60, wrapWord: true },
      },
    });

    console.log(output);
    console.log(chalk.gray(`Total: ${memories.length} memories`));
  });

// ─── search ──────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Search memories using hybrid retrieval')
  .option('-s, --scope <scope>', 'Scope to search')
  .option('-c, --category <categories...>', 'Filter by categories')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('--min-score <score>', 'Minimum score threshold', '0.3')
  .option('--level <level>', 'Detail level: L0, L1, L2', 'L1')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    const ora = (await import('ora')).default;
    const config = loadConfig((program.opts() as { config?: string }).config);
    const manager = await getMemoryManager(config);

    const spinner = ora(`Searching for "${query}"...`).start();

    const result = await manager.recall(query, {
      scope: opts.scope,
      categories: opts.category,
      limit: parseInt(opts.limit as string, 10),
      minScore: parseFloat(opts.minScore as string),
    });

    spinner.stop();

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.memories.length === 0) {
      console.log(chalk.yellow(`No memories found for "${query}"`));
      return;
    }

    console.log(chalk.green(`Found ${result.memories.length} memories (${result.timingMs}ms)\n`));

    for (const m of result.memories) {
      const level = opts.level as 'L0' | 'L1' | 'L2';
      console.log(chalk.bold(`[${chalk.cyan(m.category)}] ${m.headline}`));
      console.log(chalk.gray(`  ID: ${m.id} | Score: ${m.score.toFixed(3)} | Scope: ${m.scope}`));
      if (level === 'L1' || level === 'L2') {
        console.log(chalk.white(`  ${m.summary}`));
      }
      if (level === 'L2') {
        console.log(chalk.gray(`  ${m.content}`));
      }
      console.log();
    }
  });

// ─── stats ───────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show memory statistics')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const config = loadConfig((program.opts() as { config?: string }).config);
    const manager = await getMemoryManager(config);

    const stats = await manager.getStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(chalk.bold('\n=== openclaw-tinmem Statistics ===\n'));
    console.log(`${chalk.bold('Total memories:')} ${chalk.cyan(stats.total)}`);
    console.log(`${chalk.bold('Avg importance:')} ${chalk.yellow(stats.avgImportance.toFixed(2))}`);

    if (stats.oldestMemory) {
      console.log(`${chalk.bold('Oldest memory:')} ${new Date(stats.oldestMemory).toLocaleDateString()}`);
    }
    if (stats.newestMemory) {
      console.log(`${chalk.bold('Newest memory:')} ${new Date(stats.newestMemory).toLocaleDateString()}`);
    }

    console.log(chalk.bold('\nBy Category:'));
    const { table: tableRenderer } = await import('table');
    const catData = [
      [chalk.bold('Category'), chalk.bold('Count')],
      ...Object.entries(stats.byCategory).map(([cat, count]) => [
        chalk.cyan(cat),
        String(count),
      ]),
    ];
    console.log(tableRenderer(catData));

    if (Object.keys(stats.byScope).length > 0) {
      console.log(chalk.bold('By Scope:'));
      const scopeData = [
        [chalk.bold('Scope'), chalk.bold('Count')],
        ...Object.entries(stats.byScope).map(([scope, count]) => [
          chalk.gray(scope),
          String(count),
        ]),
      ];
      console.log(tableRenderer(scopeData));
    }
  });

// ─── delete ──────────────────────────────────────────────────────────────────

program
  .command('delete <id>')
  .description('Delete a memory by ID')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (id: string, opts) => {
    const config = loadConfig((program.opts() as { config?: string }).config);

    if (!opts.yes) {
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => {
        rl.question(chalk.yellow(`Delete memory ${id}? (y/N): `), resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    const manager = await getMemoryManager(config);
    const success = await manager.forget(id);

    if (success) {
      console.log(chalk.green(`✓ Deleted memory ${id}`));
    } else {
      console.log(chalk.red(`✗ Memory ${id} not found`));
      process.exit(1);
    }
  });

// ─── export ──────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export memories to JSON file')
  .option('-o, --output <path>', 'Output file path', 'tinmem-export.json')
  .option('-s, --scope <scope>', 'Export only from this scope')
  .action(async (opts) => {
    const ora = (await import('ora')).default;
    const { writeFileSync } = await import('fs');
    const config = loadConfig((program.opts() as { config?: string }).config);
    const manager = await getMemoryManager(config);

    const spinner = ora('Exporting memories...').start();

    const data = await manager.export(opts.scope);
    writeFileSync(opts.output, JSON.stringify(data, null, 2), 'utf-8');

    spinner.succeed(`Exported ${data.memories.length} memories to ${opts.output}`);
  });

// ─── import ──────────────────────────────────────────────────────────────────

program
  .command('import <file>')
  .description('Import memories from JSON file')
  .option('-s, --scope <scope>', 'Override scope for imported memories')
  .action(async (file: string, opts) => {
    const ora = (await import('ora')).default;
    const { readFileSync } = await import('fs');
    const config = loadConfig((program.opts() as { config?: string }).config);
    const manager = await getMemoryManager(config);

    const spinner = ora(`Importing memories from ${file}...`).start();

    try {
      const rawData = readFileSync(file, 'utf-8');
      const data = JSON.parse(rawData) as import('../types.js').ExportData;

      const imported = await manager.import(data, opts.scope);
      spinner.succeed(`Imported ${imported}/${data.memories.length} memories`);
    } catch (err) {
      spinner.fail(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── reembed ─────────────────────────────────────────────────────────────────

program
  .command('reembed')
  .description('Re-embed all memories (use after changing embedding model)')
  .option('-s, --scope <scope>', 'Re-embed only this scope')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (opts) => {
    const ora = (await import('ora')).default;
    const config = loadConfig((program.opts() as { config?: string }).config);

    if (!opts.yes) {
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => {
        rl.question(
          chalk.yellow('This will re-embed all memories. This may take a while and consume API credits. Continue? (y/N): '),
          resolve,
        );
      });
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    const manager = await getMemoryManager(config);
    const spinner = ora('Re-embedding memories...').start();

    try {
      const count = await manager.reembed(opts.scope);
      spinner.succeed(`Re-embedded ${count} memories`);
    } catch (err) {
      spinner.fail(`Re-embedding failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── init ────────────────────────────────────────────────────────────────────

async function prompt(rl: import('readline').Interface, question: string): Promise<string> {
  return new Promise<string>(resolve => { rl.question(question, resolve); });
}

program
  .command('init')
  .description('Initialize configuration with interactive setup')
  .option('-o, --output <path>', 'Output path', 'tinmem.config.json')
  .option('-f, --force', 'Overwrite if exists')
  .option('--non-interactive', 'Generate sample config without prompts')
  .action(async (opts) => {
    const { writeFileSync, existsSync } = await import('fs');
    const { generateSampleConfig } = await import('../config.js');
    const { homedir } = await import('os');

    if (existsSync(opts.output) && !opts.force) {
      console.log(chalk.yellow(`Config file ${opts.output} already exists. Use --force to overwrite.`));
      return;
    }

    // Non-interactive mode: generate sample template
    if (opts.nonInteractive) {
      writeFileSync(opts.output, generateSampleConfig(), 'utf-8');
      console.log(chalk.green(`✓ Created ${opts.output}`));
      console.log(chalk.gray('Edit the file to add your API keys and preferences.'));
      return;
    }

    // Interactive setup
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log(chalk.bold('\n🧠 openclaw-tinmem Setup\n'));

    // 1. Embedding provider
    console.log(chalk.bold('Embedding Provider:'));
    console.log('  1) OpenAI    (text-embedding-3-small, recommended)');
    console.log('  2) Jina      (jina-embeddings-v3)');
    console.log('  3) Gemini    (text-embedding-004)');
    console.log('  4) Ollama    (nomic-embed-text, local, no API key needed)');
    const providerChoice = await prompt(rl, chalk.cyan('Choose [1-4, default 1]: '));

    const providerMap: Record<string, { provider: string; model: string; dimensions: number }> = {
      '1': { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
      '2': { provider: 'jina', model: 'jina-embeddings-v3', dimensions: 1024 },
      '3': { provider: 'gemini', model: 'text-embedding-004', dimensions: 768 },
      '4': { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
    };
    const selected = providerMap[providerChoice.trim()] ?? providerMap['1'];

    // 2. Embedding API key
    let embeddingApiKey = '';
    if (selected.provider !== 'ollama') {
      const envKey = selected.provider === 'openai' ? process.env.OPENAI_API_KEY
        : selected.provider === 'jina' ? process.env.JINA_API_KEY
        : process.env.GEMINI_API_KEY;

      if (envKey) {
        const useEnv = await prompt(rl, chalk.cyan(
          `Found ${selected.provider.toUpperCase()} API key in environment. Use it? [Y/n]: `
        ));
        if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
          embeddingApiKey = `\${${selected.provider === 'openai' ? 'OPENAI_API_KEY' : selected.provider === 'jina' ? 'JINA_API_KEY' : 'GEMINI_API_KEY'}}`;
        }
      }

      if (!embeddingApiKey) {
        embeddingApiKey = await prompt(rl, chalk.cyan(`${selected.provider.toUpperCase()} Embedding API Key: `));
        if (!embeddingApiKey.trim()) {
          console.log(chalk.red('API key is required. Using placeholder.'));
          embeddingApiKey = `YOUR_${selected.provider.toUpperCase()}_API_KEY`;
        }
      }
    }

    // 3. LLM API key
    console.log(chalk.bold('\nLLM (for memory extraction & deduplication):'));
    let llmApiKey = '';
    if (selected.provider === 'openai' && embeddingApiKey && !embeddingApiKey.startsWith('YOUR_')) {
      const reuse = await prompt(rl, chalk.cyan('Reuse OpenAI API key for LLM? [Y/n]: '));
      if (!reuse.trim() || reuse.trim().toLowerCase() === 'y') {
        llmApiKey = embeddingApiKey;
      }
    }
    if (!llmApiKey) {
      const envLlmKey = process.env.OPENAI_API_KEY;
      if (envLlmKey) {
        const useEnv = await prompt(rl, chalk.cyan('Found OPENAI_API_KEY in environment for LLM. Use it? [Y/n]: '));
        if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
          llmApiKey = '${OPENAI_API_KEY}';
        }
      }
    }
    if (!llmApiKey) {
      llmApiKey = await prompt(rl, chalk.cyan('LLM API Key (OpenAI-compatible): '));
      if (!llmApiKey.trim()) {
        llmApiKey = 'YOUR_OPENAI_API_KEY';
      }
    }

    const llmModel = await prompt(rl, chalk.cyan('LLM model [default: gpt-4o-mini]: '));

    // 4. Reranker
    console.log(chalk.bold('\nReranker (optional, improves retrieval precision):'));
    const enableReranker = await prompt(rl, chalk.cyan('Enable cross-encoder reranker? [y/N]: '));
    let rerankerConfig: Record<string, string> | null = null;

    if (enableReranker.trim().toLowerCase() === 'y') {
      console.log('  1) Jina    (jina-reranker-v2-base-multilingual)');
      console.log('  2) SiliconFlow (BAAI/bge-reranker-v2-m3)');
      console.log('  3) Pinecone    (bge-reranker-v2-m3)');
      const rerankerChoice = await prompt(rl, chalk.cyan('Choose [1-3, default 1]: '));

      const rerankerProviders: Record<string, string> = { '1': 'jina', '2': 'siliconflow', '3': 'pinecone' };
      const rerankerProvider = rerankerProviders[rerankerChoice.trim()] ?? 'jina';
      const rerankerApiKey = await prompt(rl, chalk.cyan(`${rerankerProvider} Reranker API Key: `));

      rerankerConfig = {
        provider: rerankerProvider,
        apiKey: rerankerApiKey.trim() || `YOUR_${rerankerProvider.toUpperCase()}_API_KEY`,
      };
    }

    rl.close();

    // Build config
    const config: Record<string, unknown> = {
      dbPath: `${homedir()}/.openclaw/tinmem/lancedb`,
      defaultScope: 'global',
      embedding: {
        provider: selected.provider,
        ...(selected.provider !== 'ollama' ? { apiKey: embeddingApiKey.trim() } : {}),
        model: selected.model,
      },
      llm: {
        apiKey: llmApiKey.trim(),
        model: llmModel.trim() || 'gpt-4o-mini',
      },
      deduplication: {
        strategy: 'llm',
        similarityThreshold: 0.85,
      },
      retrieval: {
        limit: 10,
        minScore: 0.3,
        hybrid: true,
        ...(rerankerConfig ? { reranker: rerankerConfig } : {}),
      },
      scoring: {
        vectorWeight: 0.4,
        bm25Weight: 0.3,
        rerankerWeight: 0.3,
      },
      autoRecall: true,
      recallLimit: 8,
      recallMinScore: 0.4,
      debug: false,
    };

    writeFileSync(opts.output, JSON.stringify(config, null, 2), 'utf-8');

    console.log(chalk.green(`\n✓ Created ${opts.output}`));

    // Show next steps
    console.log(chalk.bold('\nNext steps:'));
    if (embeddingApiKey.startsWith('YOUR_') || llmApiKey.startsWith('YOUR_')) {
      console.log(chalk.yellow('  1. Edit the config file to fill in your API keys'));
    }
    console.log(chalk.gray(`  ${embeddingApiKey.startsWith('YOUR_') ? '2' : '1'}. Test with: tinmem stats`));
    console.log(chalk.gray('  For OpenClaw integration, see: https://github.com/tincomking/openclaw-tinmem#openclaw-integration'));
  });

program.parse();
