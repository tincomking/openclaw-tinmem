import { assertUuid, assertScope, assertCategory, escapeSqlLiteral } from '../src/memory/sql-safety.js';

describe('assertUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(() => assertUuid('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });

  it('accepts uppercase UUID', () => {
    expect(() => assertUuid('550E8400-E29B-41D4-A716-446655440000')).not.toThrow();
  });

  it('rejects SQL injection string', () => {
    expect(() => assertUuid("'; DROP TABLE memories; --")).toThrow('Invalid UUID');
  });

  it('rejects empty string', () => {
    expect(() => assertUuid('')).toThrow('Invalid UUID');
  });

  it('rejects partial UUID', () => {
    expect(() => assertUuid('550e8400-e29b')).toThrow('Invalid UUID');
  });

  it('rejects UUID without dashes', () => {
    expect(() => assertUuid('550e8400e29b41d4a716446655440000')).toThrow('Invalid UUID');
  });

  it('rejects UUID with extra characters', () => {
    expect(() => assertUuid('550e8400-e29b-41d4-a716-446655440000x')).toThrow('Invalid UUID');
  });
});

describe('assertCategory', () => {
  const validCategories = ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns'];

  for (const cat of validCategories) {
    it(`accepts valid category: ${cat}`, () => {
      expect(() => assertCategory(cat)).not.toThrow();
    });
  }

  it('rejects SQL injection string', () => {
    expect(() => assertCategory("profile' OR '1'='1")).toThrow('Invalid memory category');
  });

  it('rejects empty string', () => {
    expect(() => assertCategory('')).toThrow('Invalid memory category');
  });

  it('rejects arbitrary string', () => {
    expect(() => assertCategory('notacategory')).toThrow('Invalid memory category');
  });

  it('rejects uppercase variant', () => {
    expect(() => assertCategory('Profile')).toThrow('Invalid memory category');
  });

  it('rejects category with whitespace', () => {
    expect(() => assertCategory(' profile')).toThrow('Invalid memory category');
  });
});

describe('assertScope', () => {
  it('accepts "global"', () => {
    expect(() => assertScope('global')).not.toThrow();
  });

  it('accepts agent scope', () => {
    expect(() => assertScope('agent:main')).not.toThrow();
    expect(() => assertScope('agent:my-agent_v2')).not.toThrow();
    expect(() => assertScope('agent:agent.1')).not.toThrow();
  });

  it('accepts project scope', () => {
    expect(() => assertScope('project:my-project')).not.toThrow();
  });

  it('accepts user scope', () => {
    expect(() => assertScope('user:user-123')).not.toThrow();
  });

  it('accepts custom scope', () => {
    expect(() => assertScope('custom:my_namespace')).not.toThrow();
  });

  it('rejects SQL injection string', () => {
    expect(() => assertScope("global' OR '1'='1")).toThrow('Invalid memory scope');
  });

  it('rejects empty string', () => {
    expect(() => assertScope('')).toThrow('Invalid memory scope');
  });

  it('rejects scope with spaces', () => {
    expect(() => assertScope('agent:my agent')).toThrow('Invalid memory scope');
  });

  it('rejects unknown prefix', () => {
    expect(() => assertScope('unknown:something')).toThrow('Invalid memory scope');
  });

  it('rejects scope with single quotes', () => {
    expect(() => assertScope("agent:test'inject")).toThrow('Invalid memory scope');
  });
});

describe('escapeSqlLiteral', () => {
  it('returns unchanged string without quotes', () => {
    expect(escapeSqlLiteral('hello world')).toBe('hello world');
  });

  it('doubles single quotes', () => {
    expect(escapeSqlLiteral("it's")).toBe("it''s");
  });

  it('handles multiple single quotes', () => {
    expect(escapeSqlLiteral("a'b'c")).toBe("a''b''c");
  });

  it('handles empty string', () => {
    expect(escapeSqlLiteral('')).toBe('');
  });

  it('handles SQL injection attempt', () => {
    expect(escapeSqlLiteral("'; DROP TABLE --")).toBe("''; DROP TABLE --");
  });
});
