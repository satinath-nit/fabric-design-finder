import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SUPPORTED_IMAGE_EXTENSIONS } from "../../shared/constants";
import { normalizeVector } from "./vector";

export interface ExtractedFastFeatures {
  width: number;
  height: number;
  fastVector: number[];
  perceptualHash: string;
}

export function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase() as never);
}

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export async function createThumbnail(sourcePath: string, thumbnailPath: string): Promise<void> {
  await ensureDirectory(path.dirname(thumbnailPath));
  await sharp(sourcePath)
    .rotate()
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(thumbnailPath);
}

export async function extractFastFeatures(imagePath: string): Promise<ExtractedFastFeatures> {
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const colorHist = new Array(64).fill(0);
  const grayHist = new Array(32).fill(0);
  const regionAverages = new Array(4 * 4 * 3).fill(0);
  const regionCounts = new Array(4 * 4).fill(0);
  const grayscale = new Float32Array(64 * 64);

  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const pixel = y * 64 + x;
      const offset = pixel * info.channels;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? r;
      const b = data[offset + 2] ?? g;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      grayscale[pixel] = gray;

      const rBin = Math.min(3, Math.floor(r / 64));
      const gBin = Math.min(3, Math.floor(g / 64));
      const bBin = Math.min(3, Math.floor(b / 64));
      colorHist[rBin * 16 + gBin * 4 + bBin] += 1;

      grayHist[Math.min(31, Math.floor(gray / 8))] += 1;

      const regionX = Math.min(3, Math.floor(x / 16));
      const regionY = Math.min(3, Math.floor(y / 16));
      const region = regionY * 4 + regionX;
      const base = region * 3;
      regionAverages[base] += r / 255;
      regionAverages[base + 1] += g / 255;
      regionAverages[base + 2] += b / 255;
      regionCounts[region] += 1;
    }
  }

  for (let region = 0; region < regionCounts.length; region += 1) {
    const count = Math.max(regionCounts[region], 1);
    regionAverages[region * 3] /= count;
    regionAverages[region * 3 + 1] /= count;
    regionAverages[region * 3 + 2] /= count;
  }

  const edgeHist = new Array(8).fill(0);
  const textureHist = new Array(16).fill(0);

  for (let y = 1; y < 63; y += 1) {
    for (let x = 1; x < 63; x += 1) {
      const center = grayscale[y * 64 + x] ?? 0;
      const gx =
        -(grayscale[(y - 1) * 64 + (x - 1)] ?? 0) -
        2 * (grayscale[y * 64 + (x - 1)] ?? 0) -
        (grayscale[(y + 1) * 64 + (x - 1)] ?? 0) +
        (grayscale[(y - 1) * 64 + (x + 1)] ?? 0) +
        2 * (grayscale[y * 64 + (x + 1)] ?? 0) +
        (grayscale[(y + 1) * 64 + (x + 1)] ?? 0);
      const gy =
        -(grayscale[(y - 1) * 64 + (x - 1)] ?? 0) -
        2 * (grayscale[(y - 1) * 64 + x] ?? 0) -
        (grayscale[(y - 1) * 64 + (x + 1)] ?? 0) +
        (grayscale[(y + 1) * 64 + (x - 1)] ?? 0) +
        2 * (grayscale[(y + 1) * 64 + x] ?? 0) +
        (grayscale[(y + 1) * 64 + (x + 1)] ?? 0);

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      const angle = Math.atan2(gy, gx) + Math.PI;
      edgeHist[Math.min(7, Math.floor((angle / (Math.PI * 2)) * 8))] += magnitude;

      let code = 0;
      code |= (grayscale[(y - 1) * 64 + x] ?? 0) > center ? 1 : 0;
      code |= (grayscale[y * 64 + (x + 1)] ?? 0) > center ? 2 : 0;
      code |= (grayscale[(y + 1) * 64 + x] ?? 0) > center ? 4 : 0;
      code |= (grayscale[y * 64 + (x - 1)] ?? 0) > center ? 8 : 0;
      textureHist[code] += 1;
    }
  }

  const perceptualHash = createAverageHash(grayscale);
  const pixelCount = 64 * 64;
  const vector = normalizeVector([
    ...colorHist.map((value) => value / pixelCount),
    ...grayHist.map((value) => value / pixelCount),
    ...regionAverages,
    ...normalizeVector(edgeHist),
    ...textureHist.map((value) => value / ((62 * 62) || 1))
  ]);

  const metadata = await sharp(imagePath).metadata();

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    fastVector: vector,
    perceptualHash
  };
}

function createAverageHash(grayscale: Float32Array): string {
  const blockValues: number[] = [];

  for (let by = 0; by < 8; by += 1) {
    for (let bx = 0; bx < 8; bx += 1) {
      let total = 0;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          total += grayscale[(by * 8 + y) * 64 + bx * 8 + x] ?? 0;
        }
      }
      blockValues.push(total / 64);
    }
  }

  const average = blockValues.reduce((sum, value) => sum + value, 0) / blockValues.length;
  let bits = "";
  for (const value of blockValues) bits += value >= average ? "1" : "0";

  let hex = "";
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}
