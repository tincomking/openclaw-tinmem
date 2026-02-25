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
    const { table } = await import('table');
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
    const { table } = await import('table');
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
    const catData = [
      [chalk.bold('Category'), chalk.bold('Count')],
      ...Object.entries(stats.byCategory).map(([cat, count]) => [
        chalk.cyan(cat),
        String(count),
      ]),
    ];
    const { table } = await import('table');
    console.log(table(catData));

    if (Object.keys(stats.byScope).length > 0) {
      console.log(chalk.bold('By Scope:'));
      const scopeData = [
        [chalk.bold('Scope'), chalk.bold('Count')],
        ...Object.entries(stats.byScope).map(([scope, count]) => [
          chalk.gray(scope),
          String(count),
        ]),
      ];
      console.log(table(scopeData));
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

program
  .command('init')
  .description('Generate a sample configuration file')
  .option('-o, --output <path>', 'Output path', 'tinmem.config.json')
  .option('-f, --force', 'Overwrite if exists')
  .action(async (opts) => {
    const { writeFileSync, existsSync } = await import('fs');
    const { generateSampleConfig } = await import('../config.js');

    if (existsSync(opts.output) && !opts.force) {
      console.log(chalk.yellow(`Config file ${opts.output} already exists. Use --force to overwrite.`));
      return;
    }

    writeFileSync(opts.output, generateSampleConfig(), 'utf-8');
    console.log(chalk.green(`✓ Created ${opts.output}`));
    console.log(chalk.gray('Edit the file to add your API keys and preferences.'));
  });

program.parse();
