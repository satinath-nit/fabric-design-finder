import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { extractFastFeatureVariants, extractFastFeatures, isSupportedImage } from "../src/main/services/imageFeatures";

describe("image feature extraction", () => {
  it("extracts a stable feature vector and perceptual hash", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-features-"));
    const imagePath = path.join(tempDirectory, "D100 Stripe.jpg");

    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 3,
        background: { r: 32, g: 120, b: 180 }
      }
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="96" height="96"><rect x="20" width="12" height="96" fill="#f2c84b"/><rect x="54" width="10" height="96" fill="#ffffff"/></svg>`
          ),
          top: 0,
          left: 0
        }
      ])
      .jpeg()
      .toFile(imagePath);

    const features = await extractFastFeatures(imagePath);

    expect(isSupportedImage(imagePath)).toBe(true);
    expect(features.width).toBe(96);
    expect(features.height).toBe(96);
    expect(features.fastVector.length).toBeGreaterThan(100);
    expect(features.perceptualHash).toHaveLength(16);
  });

  it("recognizes common phone and design-tool image extensions", () => {
    expect(isSupportedImage("sample.HEIC")).toBe(true);
    expect(isSupportedImage("sample.avif")).toBe(true);
    expect(isSupportedImage("sample.svg")).toBe(true);
    expect(isSupportedImage("machine-card.jc5")).toBe(false);
  });

  it("extracts search variants for larger query photos", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-variants-"));
    const imagePath = path.join(tempDirectory, "query-photo.jpg");

    await sharp({
      create: {
        width: 260,
        height: 180,
        channels: 3,
        background: { r: 32, g: 120, b: 180 }
      }
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="260" height="180"><rect x="42" width="24" height="180" fill="#f2c84b"/><rect x="154" width="20" height="180" fill="#ffffff"/></svg>`
          ),
          top: 0,
          left: 0
        }
      ])
      .jpeg()
      .toFile(imagePath);

    const variants = await extractFastFeatureVariants(imagePath);

    expect(variants.length).toBeGreaterThan(1);
    expect(variants[0]?.label).toBe("whole");
    expect(variants.every((variant) => variant.fastVector.length === variants[0]?.fastVector.length)).toBe(true);
  });

  it("extracts features from indexed-color BMP files", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-bmp-"));
    const imagePath = path.join(tempDirectory, "D300 Indexed.bmp");
    await fs.writeFile(imagePath, createIndexedBmp(72, 40));

    const features = await extractFastFeatures(imagePath);

    expect(features.width).toBe(72);
    expect(features.height).toBe(40);
    expect(features.fastVector.length).toBeGreaterThan(100);
    expect(features.perceptualHash).toHaveLength(16);
  });
});

function createIndexedBmp(width: number, height: number): Buffer {
  const paletteSize = 256 * 4;
  const pixelOffset = 14 + 40 + paletteSize;
  const rowSize = Math.floor((8 * width + 31) / 32) * 4;
  const fileSize = pixelOffset + rowSize * height;
  const bytes = Buffer.alloc(fileSize);

  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(fileSize, 2);
  bytes.writeUInt32LE(pixelOffset, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(8, 28);
  bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(rowSize * height, 34);
  bytes.writeUInt32LE(256, 46);

  for (let index = 0; index < 256; index += 1) {
    const offset = 14 + 40 + index * 4;
    bytes[offset] = index;
    bytes[offset + 1] = Math.max(0, 255 - index);
    bytes[offset + 2] = index % 2 === 0 ? 34 : 220;
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = pixelOffset + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      bytes[rowOffset + x] = Math.floor((x / Math.max(width - 1, 1)) * 255);
    }
  }

  return bytes;
}
