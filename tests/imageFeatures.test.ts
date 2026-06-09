import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { extractFastFeatures, isSupportedImage } from "../src/main/services/imageFeatures";

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
});
