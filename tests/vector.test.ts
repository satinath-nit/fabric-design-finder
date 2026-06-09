import { describe, expect, it } from "vitest";
import { cosineSimilarity, deterministicProjection, hammingDistance, normalizeVector } from "../src/main/services/vector";

describe("vector utilities", () => {
  it("normalizes vectors and compares cosine similarity", () => {
    const vector = normalizeVector([3, 4]);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("computes hamming distance over hex hashes", () => {
    expect(hammingDistance("ffff", "ffff")).toBe(0);
    expect(hammingDistance("0000", "ffff")).toBe(16);
  });

  it("creates stable fallback embeddings", () => {
    const one = deterministicProjection([0.1, 0.2, 0.3], 8);
    const two = deterministicProjection([0.1, 0.2, 0.3], 8);

    expect(one).toEqual(two);
    expect(one).toHaveLength(8);
  });
});
