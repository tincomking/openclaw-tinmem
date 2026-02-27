/**
 * openclaw-tinmem - SQL safety utilities
 * Input validation and escaping for LanceDB WHERE clauses
 *
 * Defense-in-depth: validate first (reject bad input), then escape (prevent injection).
 * References:
 *   - epro-memory db.ts assertUuid/assertCategory pattern
 *   - memory-lancedb-pro store.ts escapeSqlLiteral pattern
 */


// ─── Validators ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CATEGORIES = new Set<string>([
  'profile', 'preferences', 'entities', 'events', 'cases', 'patterns',
]);

const SCOPE_RE = /^(global|agent:[a-zA-Z0-9_.\-]+|project:[a-zA-Z0-9_.\-]+|user:[a-zA-Z0-9_.\-]+|custom:[a-zA-Z0-9_.\-]+)$/;

/**
 * Validate that a value is a well-formed UUID v4.
 * Rejects anything that could break a WHERE `id = '...'` clause.
 */
export function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
}

/**
 * Validate that a category is one of the six allowed values.
 * Whitelist approach — only exact matches pass.
 */
export function assertCategory(value: string): void {
  if (!VALID_CATEGORIES.has(value)) {
    throw new Error(`Invalid memory category: ${value}. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }
}

/**
 * Validate that a scope matches allowed formats:
 *   global | agent:<id> | project:<id> | user:<id> | custom:<name>
 * where <id>/<name> consists of alphanumerics, underscores, dots, and hyphens.
 */
export function assertScope(value: string): void {
  if (!SCOPE_RE.test(value)) {
    throw new Error(`Invalid memory scope: ${value}. Must match format "global|agent:<id>|project:<id>|user:<id>|custom:<name>"`);
  }
}

// ─── Escaping ────────────────────────────────────────────────────────────────

/**
 * Escape a string for use in SQL string literals.
 * Doubles single quotes to prevent SQL injection in LanceDB (DuckDB dialect).
 */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
