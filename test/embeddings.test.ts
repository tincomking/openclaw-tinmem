/**
 * Tests for embedding utilities
 */

import { describe, it, expect } from '@jest/globals';
import { cosineSimilarity, normalizeVector } from '../src/embeddings.js';

describe('cosineSimilarity()', () => {
  it('should return 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should handle unit vectors correctly', () => {
    const a = [1, 0];
    const b = [0.707, 0.707]; // 45-degree vector
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.707, 2);
  });

  it('should throw for mismatched dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector dimension mismatch');
  });

  it('should return 0 for zero vector', () => {
    const zero = [0, 0, 0];
    const other = [1, 2, 3];
    expect(cosineSimilarity(zero, other)).toBe(0);
  });
});

describe('normalizeVector()', () => {
  it('should return a unit vector', () => {
    const v = [3, 4];
    const normalized = normalizeVector(v);
    const norm = Math.sqrt(normalized.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('should preserve direction', () => {
    const v = [1, 1];
    const normalized = normalizeVector(v);
    expect(normalized[0]).toBeCloseTo(normalized[1]!, 5);
  });

  it('should handle zero vector without throwing', () => {
    const zero = [0, 0, 0];
    const result = normalizeVector(zero);
    expect(result).toEqual([0, 0, 0]);
  });

  it('should handle already normalized vector', () => {
    const unit = [1, 0, 0];
    const result = normalizeVector(unit);
    expect(result[0]).toBeCloseTo(1, 5);
    expect(result[1]).toBeCloseTo(0, 5);
    expect(result[2]).toBeCloseTo(0, 5);
  });
});
