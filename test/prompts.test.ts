/**
 * Tests for prompt templates and noise filtering
 */

import { describe, it, expect } from '@jest/globals';
import { isNoise, buildContextInjection, buildExtractionPrompt, buildDedupPrompt } from '../src/prompts.js';
import type { Memory } from '../src/types.js';

describe('isNoise()', () => {
  it('should identify greeting messages as noise', () => {
    expect(isNoise('hi')).toBe(true);
    expect(isNoise('hello')).toBe(true);
    expect(isNoise('hey')).toBe(true);
    expect(isNoise('Hello!')).toBe(true);
  });

  it('should identify acknowledgment messages as noise', () => {
    expect(isNoise('thanks')).toBe(true);
    expect(isNoise('thank you')).toBe(true);
    expect(isNoise('ok')).toBe(true);
    expect(isNoise('yes')).toBe(true);
    expect(isNoise('no')).toBe(true);
  });

  it('should identify very short text as noise', () => {
    expect(isNoise('ok')).toBe(true);
    expect(isNoise('yes.')).toBe(true);
  });

  it('should not flag meaningful messages as noise', () => {
    expect(isNoise('I prefer TypeScript over JavaScript for large projects')).toBe(false);
    expect(isNoise('Can you help me debug this React component?')).toBe(false);
    expect(isNoise('The project deadline is next Friday and we need to finish authentication')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isNoise('')).toBe(true);
    expect(isNoise('   ')).toBe(true);
  });
});

describe('buildContextInjection()', () => {
  const makeMemory = (overrides: Partial<Memory>): Memory => ({
    id: 'test',
    headline: 'Test headline',
    summary: 'Test summary',
    content: 'Test full content with more detail',
    category: 'profile',
    scope: 'global',
    importance: 0.7,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 1,
    lastAccessedAt: Date.now(),
    tags: ['test'],
    metadata: {},
    ...overrides,
  });

  it('should return empty string for empty memories array', () => {
    const result = buildContextInjection([]);
    expect(result).toBe('');
  });

  it('should wrap output in agent-experience tags', () => {
    const memories = [makeMemory({})];
    const result = buildContextInjection(memories, 'L1');
    expect(result).toContain('<agent-experience>');
    expect(result).toContain('</agent-experience>');
  });

  it('should show headline for L0 level', () => {
    const memories = [makeMemory({ headline: 'User is a senior developer' })];
    const result = buildContextInjection(memories, 'L0');
    expect(result).toContain('User is a senior developer');
    expect(result).not.toContain('Test summary');
    expect(result).not.toContain('Test full content');
  });

  it('should show summary for L1 level', () => {
    const memories = [makeMemory({ summary: 'Detailed summary text here' })];
    const result = buildContextInjection(memories, 'L1');
    expect(result).toContain('Detailed summary text here');
    expect(result).not.toContain('Test full content');
  });

  it('should show content for L2 level', () => {
    const memories = [makeMemory({ content: 'Full narrative content here' })];
    const result = buildContextInjection(memories, 'L2');
    expect(result).toContain('Full narrative content here');
  });

  it('should group memories by category', () => {
    const memories = [
      makeMemory({ category: 'profile', headline: 'Profile memory' }),
      makeMemory({ category: 'events', headline: 'Event memory' }),
      makeMemory({ category: 'cases', headline: 'Case memory' }),
    ];
    const result = buildContextInjection(memories, 'L0');
    expect(result).toContain('User Profile');
    expect(result).toContain('Past Events');
    expect(result).toContain('Previous Cases');
  });
});

describe('buildExtractionPrompt()', () => {
  it('should include user message and assistant response', () => {
    const prompt = buildExtractionPrompt('What is TypeScript?', 'TypeScript is a typed superset of JavaScript.');
    expect(prompt).toContain('What is TypeScript?');
    expect(prompt).toContain('TypeScript is a typed superset of JavaScript.');
  });

  it('should include existing context when provided', () => {
    const prompt = buildExtractionPrompt(
      'user message',
      'assistant response',
      'Existing context here'
    );
    expect(prompt).toContain('Existing context here');
    expect(prompt).toContain('Existing Memory Context');
  });
});

describe('buildDedupPrompt()', () => {
  it('should include new memory details', () => {
    const newMemory = {
      headline: 'User prefers dark mode',
      summary: 'The user has expressed a preference for dark mode in IDEs',
      content: 'Full content here',
      category: 'preferences' as const,
    };

    const candidates = [{
      id: 'existing-id',
      headline: 'User uses dark themes',
      summary: 'User uses dark themes in their editor',
      content: 'Some content',
      category: 'preferences' as const,
      tags: ['theme', 'editor'],
    }];

    const prompt = buildDedupPrompt(newMemory, candidates);
    expect(prompt).toContain('User prefers dark mode');
    expect(prompt).toContain('User uses dark themes');
    expect(prompt).toContain('existing-id');
  });

  it('should handle multiple candidates', () => {
    const newMemory = {
      headline: 'New memory',
      summary: 'New summary',
      content: 'New content',
      category: 'entities' as const,
    };

    const candidates = [
      { id: 'id-1', headline: 'Candidate 1', summary: 'Summary 1', content: 'Content 1', category: 'entities' as const, tags: [] },
      { id: 'id-2', headline: 'Candidate 2', summary: 'Summary 2', content: 'Content 2', category: 'entities' as const, tags: ['tag1'] },
    ];

    const prompt = buildDedupPrompt(newMemory, candidates);
    expect(prompt).toContain('id-1');
    expect(prompt).toContain('id-2');
    expect(prompt).toContain('Candidate 1');
    expect(prompt).toContain('Candidate 2');
  });
});
