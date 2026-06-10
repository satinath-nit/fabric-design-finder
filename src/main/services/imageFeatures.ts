import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { SUPPORTED_IMAGE_EXTENSIONS } from "../../shared/constants";
import { normalizeVector } from "./vector";

export interface ExtractedFastFeatures {
  width: number;
  height: number;
  fastVector: number[];
  perceptualHash: string;
}

export interface ExtractedFastFeatureVariant extends ExtractedFastFeatures {
  label: string;
}

export interface ExtractFastFeatureVariantOptions {
  rotations?: number[];
}

export class UnsupportedImageFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageFileError";
  }
}

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ImageSource {
  width: number;
  height: number;
  createPipeline: () => Sharp;
}

interface DecodedImage {
  width: number;
  height: number;
  data: Buffer;
}

export function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase() as never);
}

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export async function createThumbnail(sourcePath: string, thumbnailPath: string): Promise<void> {
  await ensureDirectory(path.dirname(thumbnailPath));
  const source = await loadImageSource(sourcePath);
  await source
    .createPipeline()
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(thumbnailPath);
}

export async function createImagePreview(sourcePath: string): Promise<{ mime: string; bytes: Buffer }> {
  const source = await loadImageSource(sourcePath);
  const bytes = await source
    .createPipeline()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { mime: "image/jpeg", bytes };
}

export async function extractFastFeatures(imagePath: string): Promise<ExtractedFastFeatures> {
  return extractFastFeaturesForRegion(await loadImageSource(imagePath));
}

export async function extractFastFeatureVariants(
  imagePath: string,
  options: ExtractFastFeatureVariantOptions = {}
): Promise<ExtractedFastFeatureVariant[]> {
  const rotations = [...new Set(options.rotations ?? [0])].map(normalizeRotation);
  const variants: ExtractedFastFeatureVariant[] = [];

  for (const rotation of rotations) {
    const source = await loadImageSource(imagePath, rotation);
    const rotationLabel = rotation === 0 ? "" : `rot${rotation}-`;
    const whole = await extractFastFeaturesForRegion(source);
    variants.push({ ...whole, label: `${rotationLabel}whole` });

    for (const variant of buildSearchCropRegions(source.width, source.height)) {
      try {
        const features = await extractFastFeaturesForRegion(source, variant.region);
        variants.push({ ...features, label: `${rotationLabel}${variant.label}` });
      } catch {
        // Cropped variants are best-effort recall helpers; the whole image still carries the query.
      }
    }
  }

  return variants;
}

async function extractFastFeaturesForRegion(source: ImageSource, region?: CropRegion): Promise<ExtractedFastFeatures> {
  let pipeline = source.createPipeline();
  if (region) {
    pipeline = pipeline.extract(region);
  }

  const { data, info } = await pipeline
    .resize(64, 64, { fit: "cover", position: "center" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const colorHist = new Array(64).fill(0);
  const grayHist = new Array(32).fill(0);
  const hueHist = new Array(24).fill(0);
  const saturationHist = new Array(8).fill(0);
  const valueHist = new Array(8).fill(0);
  const regionAverages = new Array(4 * 4 * 3).fill(0);
  const regionGrayTotals = new Array(4 * 4).fill(0);
  const regionGraySquares = new Array(4 * 4).fill(0);
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

      const [hue, saturation, value] = rgbToHsv(r, g, b);
      hueHist[Math.min(23, Math.floor(hue * 24))] += saturation;
      saturationHist[Math.min(7, Math.floor(saturation * 8))] += 1;
      valueHist[Math.min(7, Math.floor(value * 8))] += 1;

      const rBin = Math.min(3, Math.floor(r / 64));
      const gBin = Math.min(3, Math.floor(g / 64));
      const bBin = Math.min(3, Math.floor(b / 64));
      colorHist[rBin * 16 + gBin * 4 + bBin] += 1;

      grayHist[Math.min(31, Math.floor(gray / 8))] += 1;

      const regionX = Math.min(3, Math.floor(x / 16));
      const regionY = Math.min(3, Math.floor(y / 16));
      const localRegion = regionY * 4 + regionX;
      const base = localRegion * 3;
      regionAverages[base] += r / 255;
      regionAverages[base + 1] += g / 255;
      regionAverages[base + 2] += b / 255;
      regionGrayTotals[localRegion] += gray;
      regionGraySquares[localRegion] += gray * gray;
      regionCounts[localRegion] += 1;
    }
  }

  const regionContrast = new Array(4 * 4).fill(0);
  for (let localRegion = 0; localRegion < regionCounts.length; localRegion += 1) {
    const count = Math.max(regionCounts[localRegion], 1);
    regionAverages[localRegion * 3] /= count;
    regionAverages[localRegion * 3 + 1] /= count;
    regionAverages[localRegion * 3 + 2] /= count;
    const mean = regionGrayTotals[localRegion] / count;
    const variance = Math.max(0, regionGraySquares[localRegion] / count - mean * mean);
    regionContrast[localRegion] = Math.sqrt(variance) / 128;
  }

  const edgeHist = new Array(8).fill(0);
  const localEdgeHist = new Array(4 * 4 * 8).fill(0);
  const edgeDensityGrid = new Array(4 * 4).fill(0);
  const textureHist = new Array(16).fill(0);
  const localTextureHist = new Array(4 * 4 * 16).fill(0);

  for (let y = 1; y < 63; y += 1) {
    for (let x = 1; x < 63; x += 1) {
      const center = grayscale[y * 64 + x] ?? 0;
      const regionX = Math.min(3, Math.floor(x / 16));
      const regionY = Math.min(3, Math.floor(y / 16));
      const localRegion = regionY * 4 + regionX;
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
      const edgeBin = Math.min(7, Math.floor((angle / (Math.PI * 2)) * 8));
      edgeHist[edgeBin] += magnitude;
      localEdgeHist[localRegion * 8 + edgeBin] += magnitude;
      edgeDensityGrid[localRegion] += magnitude / 1024;

      let code = 0;
      code |= (grayscale[(y - 1) * 64 + x] ?? 0) > center ? 1 : 0;
      code |= (grayscale[y * 64 + (x + 1)] ?? 0) > center ? 2 : 0;
      code |= (grayscale[(y + 1) * 64 + x] ?? 0) > center ? 4 : 0;
      code |= (grayscale[y * 64 + (x - 1)] ?? 0) > center ? 8 : 0;
      textureHist[code] += 1;
      localTextureHist[localRegion * 16 + code] += 1;
    }
  }

  const perceptualHash = createAverageHash(grayscale);
  const pixelCount = 64 * 64;
  const colorFeatures = weightedFeatures(
    normalizeVector([
      ...colorHist.map((value) => value / pixelCount),
      ...hueHist.map((value) => value / pixelCount),
      ...saturationHist.map((value) => value / pixelCount),
      ...valueHist.map((value) => value / pixelCount),
      ...regionAverages
    ]),
    0.72
  );
  const toneFeatures = weightedFeatures(
    normalizeVector([...grayHist.map((value) => value / pixelCount), ...regionContrast]),
    0.9
  );
  const patternFeatures = weightedFeatures(
    normalizeVector([
      ...normalizeVector(edgeHist),
      ...normalizeVector(localEdgeHist),
      ...normalizeVector(edgeDensityGrid),
      ...textureHist.map((value) => value / ((62 * 62) || 1)),
      ...normalizeVector(localTextureHist)
    ]),
    1.45
  );
  const legacyFeatures = weightedFeatures(
    normalizeVector([
      ...colorHist.map((value) => value / pixelCount),
      ...grayHist.map((value) => value / pixelCount),
      ...regionAverages,
      ...normalizeVector(edgeHist),
      ...textureHist.map((value) => value / ((62 * 62) || 1))
    ]),
    0.55
  );

  return {
    width: region?.width ?? source.width,
    height: region?.height ?? source.height,
    fastVector: normalizeVector([...colorFeatures, ...toneFeatures, ...patternFeatures, ...legacyFeatures]),
    perceptualHash
  };
}

async function loadImageSource(imagePath: string, rotation = 0): Promise<ImageSource> {
  try {
    const metadata = await sharp(imagePath).metadata();
    const { width, height } = rotatedDimensions(
      orientedDimensions(metadata.width ?? 0, metadata.height ?? 0, metadata.orientation),
      rotation
    );
    if (width <= 0 || height <= 0) {
      throw new Error("Image metadata did not include valid dimensions.");
    }
    return {
      width,
      height,
      createPipeline: () => rotatePipeline(sharp(imagePath), rotation)
    };
  } catch (error) {
    const decoded = await decodeFallbackImage(imagePath, error);
    const { width, height } = rotatedDimensions(decoded, rotation);
    return {
      width,
      height,
      createPipeline: () =>
        rotatePipeline(
          sharp(decoded.data, {
            raw: {
              width: decoded.width,
              height: decoded.height,
              channels: 3
            }
          }),
          rotation
        )
    };
  }
}

function rotatePipeline(pipeline: Sharp, rotation: number): Sharp {
  return rotation === 0 ? pipeline.rotate() : pipeline.rotate(rotation);
}

async function decodeFallbackImage(imagePath: string, cause: unknown): Promise<DecodedImage> {
  const bytes = await fs.readFile(imagePath);
  if (isBmp(bytes)) return decodeBmp(bytes);
  throw createUnsupportedImageError(imagePath, bytes, cause);
}

function isBmp(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function decodeBmp(bytes: Buffer): DecodedImage {
  if (bytes.length < 54 || !isBmp(bytes)) {
    throw new Error("BMP file header is missing or incomplete.");
  }

  const pixelOffset = bytes.readUInt32LE(10);
  const dibHeaderSize = bytes.readUInt32LE(14);
  if (dibHeaderSize < 40) {
    throw new Error(`Unsupported BMP DIB header size ${dibHeaderSize}.`);
  }

  const width = bytes.readInt32LE(18);
  const rawHeight = bytes.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const planes = bytes.readUInt16LE(26);
  const bitsPerPixel = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  const colorsUsed = bytes.readUInt32LE(46);

  if (width <= 0 || height <= 0) throw new Error("BMP dimensions are invalid.");
  if (planes !== 1) throw new Error(`Unsupported BMP plane count ${planes}.`);
  if (compression !== 0) throw new Error(`Unsupported compressed BMP encoding (${compression}).`);
  if (![1, 4, 8, 24, 32].includes(bitsPerPixel)) {
    throw new Error(`Unsupported BMP bit depth ${bitsPerPixel}.`);
  }

  const palette: Array<[number, number, number]> = [];
  if (bitsPerPixel <= 8) {
    const colorCount = colorsUsed || 1 << bitsPerPixel;
    const paletteOffset = 14 + dibHeaderSize;
    for (let index = 0; index < colorCount; index += 1) {
      const offset = paletteOffset + index * 4;
      if (offset + 2 >= bytes.length) break;
      palette.push([bytes[offset + 2] ?? 0, bytes[offset + 1] ?? 0, bytes[offset] ?? 0]);
    }
    if (palette.length === 0) throw new Error("BMP color palette is missing.");
  }

  const rowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const data = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const rowOffset = pixelOffset + sourceY * rowSize;
    if (rowOffset + rowSize > bytes.length) throw new Error("BMP pixel data is incomplete.");

    for (let x = 0; x < width; x += 1) {
      const outputOffset = (y * width + x) * 3;
      const [r, g, b] = readBmpPixel(bytes, rowOffset, x, bitsPerPixel, palette);
      data[outputOffset] = r;
      data[outputOffset + 1] = g;
      data[outputOffset + 2] = b;
    }
  }

  return { width, height, data };
}

function readBmpPixel(
  bytes: Buffer,
  rowOffset: number,
  x: number,
  bitsPerPixel: number,
  palette: Array<[number, number, number]>
): [number, number, number] {
  if (bitsPerPixel === 1) {
    const value = bytes[rowOffset + Math.floor(x / 8)] ?? 0;
    return palette[(value >> (7 - (x % 8))) & 1] ?? [0, 0, 0];
  }
  if (bitsPerPixel === 4) {
    const value = bytes[rowOffset + Math.floor(x / 2)] ?? 0;
    return palette[x % 2 === 0 ? value >> 4 : value & 0x0f] ?? [0, 0, 0];
  }
  if (bitsPerPixel === 8) {
    return palette[bytes[rowOffset + x] ?? 0] ?? [0, 0, 0];
  }
  if (bitsPerPixel === 24) {
    const offset = rowOffset + x * 3;
    return [bytes[offset + 2] ?? 0, bytes[offset + 1] ?? 0, bytes[offset] ?? 0];
  }

  const offset = rowOffset + x * 4;
  return [bytes[offset + 2] ?? 0, bytes[offset + 1] ?? 0, bytes[offset] ?? 0];
}

function createUnsupportedImageError(filePath: string, bytes: Buffer, cause: unknown): Error {
  const extension = path.extname(filePath).toLowerCase();
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const magic = bytes.subarray(0, 12);

  if ((extension === ".jpg" || extension === ".jpeg") && !(magic[0] === 0xff && magic[1] === 0xd8)) {
    return new UnsupportedImageFileError(
      "File has a .jpg extension, but its bytes are not JPEG image data. It may be corrupt, misnamed, or a machine-design file."
    );
  }
  if (extension === ".png" && !magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return new UnsupportedImageFileError(
      "File has a .png extension, but its bytes are not PNG image data. It may be corrupt or misnamed."
    );
  }

  return new Error(causeMessage || "Input file contains unsupported image format.");
}

function weightedFeatures(values: number[], weight: number): number[] {
  return values.map((value) => value * weight);
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;

  if (delta !== 0) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  return [hue, saturation, max];
}

function orientedDimensions(width: number, height: number, orientation?: number): { width: number; height: number } {
  if (orientation && orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

function rotatedDimensions(
  dimensions: { width: number; height: number },
  rotation: number
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function normalizeRotation(rotation: number): number {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

function buildSearchCropRegions(width: number, height: number): Array<{ label: string; region: CropRegion }> {
  if (width < 128 || height < 128) return [];

  const regions: Array<{ label: string; region: CropRegion }> = [];
  const addCentered = (label: string, scale: number) => {
    const regionWidth = Math.max(64, Math.round(width * scale));
    const regionHeight = Math.max(64, Math.round(height * scale));
    regions.push({
      label,
      region: {
        left: Math.max(0, Math.round((width - regionWidth) / 2)),
        top: Math.max(0, Math.round((height - regionHeight) / 2)),
        width: Math.min(width, regionWidth),
        height: Math.min(height, regionHeight)
      }
    });
  };

  addCentered("center-80", 0.8);
  addCentered("center-55", 0.55);

  const halfWidth = Math.max(64, Math.floor(width / 2));
  const halfHeight = Math.max(64, Math.floor(height / 2));
  const right = Math.max(0, width - halfWidth);
  const bottom = Math.max(0, height - halfHeight);

  regions.push(
    { label: "top-left", region: { left: 0, top: 0, width: halfWidth, height: halfHeight } },
    { label: "top-right", region: { left: right, top: 0, width: halfWidth, height: halfHeight } },
    { label: "bottom-left", region: { left: 0, top: bottom, width: halfWidth, height: halfHeight } },
    { label: "bottom-right", region: { left: right, top: bottom, width: halfWidth, height: halfHeight } }
  );

  const seen = new Set<string>();
  return regions.filter(({ region }) => {
    const key = `${region.left}:${region.top}:${region.width}:${region.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
