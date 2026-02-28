/**
 * openclaw-tinmem - LanceDB database layer
 * Handles storage, retrieval, and full-text search
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

import type { Memory, MemoryRecord, MemoryScope, MemoryCategory, MemoryStats } from '../types.js';
import { assertUuid, assertScope, assertCategory, escapeSqlLiteral } from './sql-safety.js';

const TABLE_NAME = 'memories';
const INIT_SENTINEL_ID = '__tinmem_init__';

// ─── Dummy Row ───────────────────────────────────────────────────────────────
// Used to create the table with the correct schema via db.createTable([row]).
// This avoids createEmptyTable(schema) which has a LanceDB 0.14 bug with
// FixedSizeList when apache-arrow schema objects are passed directly.

function buildDummyRow(dimensions: number): Record<string, unknown> {
  return {
    id: INIT_SENTINEL_ID,
    headline: '',
    summary: '',
    content: '',
    category: 'profile',
    scope: 'global',
    importance: 0.0,
    createdAt: 0.0,
    updatedAt: 0.0,
    accessCount: 0.0,
    lastAccessedAt: 0.0,
    tags: '[]',
    metadata: '{}',
    vector: Array.from({ length: dimensions }, () => 0),
  };
}

// ─── TinmemDB ────────────────────────────────────────────────────────────────

export class TinmemDB {
  private db!: lancedb.Connection;
  private table!: lancedb.Table;
  private initialized = false;
  private ftsReady = false;
  private writeLock: Promise<void> = Promise.resolve();

  /**
   * Serialize all write operations to prevent read-modify-write race conditions.
   * Uses a Promise chain: each write waits for the previous one to complete.
   * Reference: epro-memory db.ts withWriteLock pattern.
   */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let resolve!: () => void;
    this.writeLock = new Promise<void>((r) => { resolve = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }

  constructor(
    private dbPath: string,
    private dimensions: number,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;

    mkdirSync(this.dbPath, { recursive: true });
    this.db = await lancedb.connect(this.dbPath);

    const tables = await this.db.tableNames();
    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
      // For existing table: FTS indexes should already be present
      this.ftsReady = true;
    } else {
      // Use dummy-row technique to avoid LanceDB 0.14 bug with createEmptyTable+FixedSizeList.
      // LanceDB's sanitize.js checks `listSize in typeLike` and throws when passed external
      // Arrow schema objects in some environments. Inserting a dummy row lets LanceDB infer
      // the schema from JS data instead, then we delete the sentinel row.
      this.table = await this.db.createTable(
        TABLE_NAME,
        [buildDummyRow(this.dimensions)],
        { mode: 'create' }
      );
      await this.table.delete(`id = '${INIT_SENTINEL_ID}'`);
      // FTS indexes must be created AFTER data is inserted (not on empty table)
      // See ensureFtsIndexes() called from insert()/bulkInsert()
      this.ftsReady = false;
    }

    this.initialized = true;
  }

  /**
   * Create or update FTS indexes. Must be called after data is present in the table.
   * FTS indexes created on empty tables return incorrect (all-matching) results.
   */
  private async ensureFtsIndexes(): Promise<void> {
    if (this.ftsReady) return;
    for (const col of ['content', 'summary', 'headline', 'tags']) {
      try {
        await this.table.createIndex(col, { config: lancedb.Index.fts() });
      } catch {
        // Index already exists or table is empty – both are OK
      }
    }
    this.ftsReady = true;
  }

  private ensureInit(): void {
    if (!this.initialized) throw new Error('TinmemDB not initialized. Call init() first.');
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async insert(memory: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'>): Promise<Memory> {
    this.ensureInit();

    const now = Date.now();
    const record: MemoryRecord = {
      ...memory,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    };

    return this.withWriteLock(async () => {
      await this.table.add([this.toRow(record)]);
      await this.ensureFtsIndexes();
      return this.fromRow(this.toRow(record));
    });
  }

  async update(id: string, updates: Partial<Pick<Memory, 'headline' | 'summary' | 'content' | 'importance' | 'tags' | 'metadata'>> & { vector?: number[] }): Promise<Memory | null> {
    this.ensureInit();
    assertUuid(id);

    return this.withWriteLock(async () => {
      const existing = await this.getById(id);
      if (!existing) return null;

      const updated: MemoryRecord = {
        ...existing,
        ...updates,
        vector: updates.vector ?? (existing as MemoryRecord).vector ?? [],
        updatedAt: Date.now(),
      };

      // Save original for rollback in case add() fails
      const rollbackRow = this.toRow(existing as MemoryRecord);

      await this.table.delete(`id = '${escapeSqlLiteral(id)}'`);
      try {
        await this.table.add([this.toRow(updated)]);
      } catch (err) {
        // Rollback: restore original record
        await this.table.add([rollbackRow]);
        throw err;
      }

      return this.fromRow(this.toRow(updated));
    });
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInit();
    assertUuid(id);

    return this.withWriteLock(async () => {
      const existing = await this.getById(id);
      if (!existing) return false;
      await this.table.delete(`id = '${escapeSqlLiteral(id)}'`);
      return true;
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    this.ensureInit();
    if (ids.length === 0) return 0;
    for (const id of ids) assertUuid(id);

    return this.withWriteLock(async () => {
      const idList = ids.map(id => `'${escapeSqlLiteral(id)}'`).join(', ');
      await this.table.delete(`id IN (${idList})`);
      return ids.length;
    });
  }

  async deleteByScope(scope: MemoryScope): Promise<number> {
    this.ensureInit();
    assertScope(scope);

    return this.withWriteLock(async () => {
      const before = await this.countByScope(scope);
      await this.table.delete(`scope = '${escapeSqlLiteral(scope)}'`);
      return before;
    });
  }

  async getById(id: string): Promise<Memory | null> {
    this.ensureInit();
    assertUuid(id);
    const results = await this.table
      .query()
      .where(`id = '${escapeSqlLiteral(id)}'`)
      .limit(1)
      .toArray();

    return results?.length > 0 ? this.fromRow(results[0]) : null;
  }

  async incrementAccessCount(id: string): Promise<void> {
    this.ensureInit();
    assertUuid(id);

    await this.withWriteLock(async () => {
      const existing = await this.getById(id);
      if (!existing) return;

      const rollbackRow = this.toRow(existing as MemoryRecord);

      await this.table.delete(`id = '${escapeSqlLiteral(id)}'`);
      const updated = {
        ...existing,
        vector: (existing as MemoryRecord).vector ?? [],
        accessCount: existing.accessCount + 1,
        lastAccessedAt: Date.now(),
      };
      try {
        await this.table.add([this.toRow(updated)]);
      } catch (err) {
        await this.table.add([rollbackRow]);
        throw err;
      }
    });
  }

  // ─── Vector Search ───────────────────────────────────────────────────────

  async vectorSearch(
    queryVector: number[],
    options: {
      limit: number;
      scope?: MemoryScope | MemoryScope[];
      categories?: MemoryCategory[];
      minScore?: number;
    }
  ): Promise<Array<Memory & { _distance: number }>> {
    this.ensureInit();

    let query = this.table
      .vectorSearch(queryVector)
      .column('vector')
      .limit(options.limit * 3) // over-fetch for filtering
      .distanceType('cosine');

    const filters: string[] = [];

    if (options.scope) {
      const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
      for (const s of scopes) assertScope(s);
      const scopeFilter = scopes.map(s => `scope = '${escapeSqlLiteral(s)}'`).join(' OR ');
      filters.push(`(${scopeFilter})`);
    }

    if (options.categories && options.categories.length > 0) {
      for (const c of options.categories) assertCategory(c);
      const catFilter = options.categories.map(c => `category = '${escapeSqlLiteral(c)}'`).join(' OR ');
      filters.push(`(${catFilter})`);
    }

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const results = await query.toArray();
    if (!results) return [];

    return results
      .map(row => ({
        ...this.fromRow(row),
        _distance: (row._distance as number) ?? 1,
      }))
      .filter(r => {
        const score = 1 - r._distance;
        return !options.minScore || score >= options.minScore;
      })
      .slice(0, options.limit);
  }

  // ─── Full-Text Search ────────────────────────────────────────────────────

  async fullTextSearch(
    query: string,
    options: {
      limit: number;
      scope?: MemoryScope | MemoryScope[];
      categories?: MemoryCategory[];
    }
  ): Promise<Array<Memory & { _score: number }>> {
    this.ensureInit();

    try {
      const filters: string[] = [];

      if (options.scope) {
        const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
        for (const s of scopes) assertScope(s);
        const scopeFilter = scopes.map(s => `scope = '${escapeSqlLiteral(s)}'`).join(' OR ');
        filters.push(`(${scopeFilter})`);
      }

      if (options.categories && options.categories.length > 0) {
        for (const c of options.categories) assertCategory(c);
        const catFilter = options.categories.map(c => `category = '${escapeSqlLiteral(c)}'`).join(' OR ');
        filters.push(`(${catFilter})`);
      }

      let ftsQuery = this.table
        .query()
        .fullTextSearch(query, { columns: ['content', 'summary', 'headline', 'tags'] })
        .limit(options.limit);

      if (filters.length > 0) {
        ftsQuery = ftsQuery.where(filters.join(' AND '));
      }

      const results = await ftsQuery.toArray();
      if (!results) return [];
      return results.map(row => ({
        ...this.fromRow(row),
        _score: (row._relevance_score as number) ?? 0,
      }));
    } catch {
      // FTS not available, return empty
      return [];
    }
  }

  // ─── List & Filter ───────────────────────────────────────────────────────

  async list(options: {
    scope?: MemoryScope | MemoryScope[];
    categories?: MemoryCategory[];
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'importance' | 'accessCount';
    orderDir?: 'asc' | 'desc';
  } = {}): Promise<Memory[]> {
    this.ensureInit();

    const filters: string[] = [];

    if (options.scope) {
      const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
      for (const s of scopes) assertScope(s);
      const scopeFilter = scopes.map(s => `scope = '${escapeSqlLiteral(s)}'`).join(' OR ');
      filters.push(`(${scopeFilter})`);
    }

    if (options.categories && options.categories.length > 0) {
      for (const c of options.categories) assertCategory(c);
      const catFilter = options.categories.map(c => `category = '${escapeSqlLiteral(c)}'`).join(' OR ');
      filters.push(`(${catFilter})`);
    }

    let query = this.table.query();

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const limit = options.limit ?? 100;
    query = query.limit(limit + (options.offset ?? 0));

    const results = await query.toArray();
    if (!results) return [];

    let memories = results.map(row => this.fromRow(row));

    // Sort
    const orderBy = options.orderBy ?? 'createdAt';
    const orderDir = options.orderDir ?? 'desc';
    memories.sort((a, b) => {
      const av = a[orderBy] as number;
      const bv = b[orderBy] as number;
      return orderDir === 'asc' ? av - bv : bv - av;
    });

    // Paginate
    if (options.offset) {
      memories = memories.slice(options.offset);
    }

    return memories.slice(0, limit);
  }

  async countByScope(scope: MemoryScope): Promise<number> {
    this.ensureInit();
    assertScope(scope);
    const results = await this.table.query().where(`scope = '${escapeSqlLiteral(scope)}'`).toArray();
    return results?.length ?? 0;
  }

  // ─── Statistics ──────────────────────────────────────────────────────────

  async getStats(): Promise<MemoryStats> {
    this.ensureInit();

    // Only select lightweight columns — avoid loading vector data into memory
    const rows = await this.table.query()
      .select(['category', 'scope', 'importance', 'createdAt'])
      .toArray() ?? [];

    const byCategory = {
      profile: 0, preferences: 0, entities: 0,
      events: 0, cases: 0, patterns: 0,
    } as Record<MemoryCategory, number>;

    const byScope: Record<string, number> = {};
    let totalImportance = 0;
    let oldest = Infinity;
    let newest = 0;

    for (const row of rows) {
      const cat = row.category as MemoryCategory;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const scope = row.scope as string;
      byScope[scope] = (byScope[scope] ?? 0) + 1;
      totalImportance += row.importance as number;
      const t = row.createdAt as number;
      if (t < oldest) oldest = t;
      if (t > newest) newest = t;
    }

    return {
      total: rows.length,
      byCategory,
      byScope,
      oldestMemory: rows.length > 0 ? oldest : undefined,
      newestMemory: rows.length > 0 ? newest : undefined,
      avgImportance: rows.length > 0 ? totalImportance / rows.length : 0,
    };
  }

  // ─── Bulk Operations ─────────────────────────────────────────────────────

  async bulkInsert(records: MemoryRecord[]): Promise<void> {
    this.ensureInit();
    if (records.length === 0) return;

    await this.withWriteLock(async () => {
      await this.table.add(records.map(r => this.toRow(r)));
      await this.ensureFtsIndexes();
    });
  }

  async getAllForExport(scope?: MemoryScope): Promise<Memory[]> {
    this.ensureInit();
    const options = scope ? { scope } : {};
    return this.list({ ...options, limit: 100000 });
  }

  // ─── Serialization ───────────────────────────────────────────────────────

  private toRow(m: MemoryRecord): Record<string, unknown> {
    return {
      id: m.id,
      headline: m.headline,
      summary: m.summary,
      content: m.content,
      category: m.category,
      scope: m.scope,
      importance: m.importance,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      accessCount: m.accessCount,
      lastAccessedAt: m.lastAccessedAt,
      tags: JSON.stringify(m.tags),
      metadata: JSON.stringify(m.metadata),
      vector: m.vector,
    };
  }

  private fromRow(row: Record<string, unknown>): Memory {
    let tags: string[] = [];
    let metadata: Record<string, unknown> = {};

    try { tags = JSON.parse(row.tags as string) as string[]; } catch { tags = []; }
    try { metadata = JSON.parse(row.metadata as string) as Record<string, unknown>; } catch { metadata = {}; }

    return {
      id: row.id as string,
      headline: row.headline as string,
      summary: row.summary as string,
      content: row.content as string,
      category: row.category as MemoryCategory,
      scope: row.scope as MemoryScope,
      importance: row.importance as number,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      accessCount: row.accessCount as number,
      lastAccessedAt: row.lastAccessedAt as number,
      tags,
      metadata,
    };
  }

  async close(): Promise<void> {
    // LanceDB connections don't need explicit close in JS
    this.initialized = false;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

const instances = new Map<string, TinmemDB>();

export async function getDB(dbPath: string, dimensions: number): Promise<TinmemDB> {
  const key = `${dbPath}:${dimensions}`;
  if (!instances.has(key)) {
    const db = new TinmemDB(dbPath, dimensions);
    await db.init();
    instances.set(key, db);
  }
  return instances.get(key)!;
}
