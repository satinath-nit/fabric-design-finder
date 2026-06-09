export function normalizeVector(values: number[]): number[] {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return values.map(() => 0);
  return values.map((value) => value / norm);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function vectorToBuffer(values: ArrayLike<number>): Buffer {
  const typed = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    typed[index] = values[index] ?? 0;
  }
  return Buffer.from(typed.buffer);
}

export function bufferToVector(buffer: Buffer | Uint8Array | null | undefined): Float32Array {
  if (!buffer || buffer.byteLength === 0) return new Float32Array();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function hammingDistance(hexA: string, hexB: string): number {
  const length = Math.min(hexA.length, hexB.length);
  let distance = Math.abs(hexA.length - hexB.length) * 4;

  for (let index = 0; index < length; index += 1) {
    const a = Number.parseInt(hexA[index] ?? "0", 16);
    const b = Number.parseInt(hexB[index] ?? "0", 16);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    let bits = a ^ b;
    while (bits > 0) {
      distance += bits & 1;
      bits >>= 1;
    }
  }

  return distance;
}

export function scoreFromHashDistance(distance: number, bitCount = 64): number {
  return Math.max(0, 1 - distance / bitCount);
}

export function deterministicProjection(source: ArrayLike<number>, dimensions = 512): number[] {
  const projected: number[] = [];
  const sourceLength = Math.max(source.length, 1);

  for (let out = 0; out < dimensions; out += 1) {
    let value = 0;
    for (let step = 0; step < 7; step += 1) {
      const sourceIndex = (out * 17 + step * 31) % sourceLength;
      const weight = Math.sin((out + 1) * (step + 3) * 0.017) + Math.cos((sourceIndex + 5) * 0.031);
      value += (source[sourceIndex] ?? 0) * weight;
    }
    projected.push(value);
  }

  return normalizeVector(projected);
}
