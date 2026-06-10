import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DatabaseService } from "../src/main/services/database";
import { IndexingService } from "../src/main/services/indexingService";
import { ModelService } from "../src/main/services/modelService";
import { OpenAiEnhancer } from "../src/main/services/openAiEnhancer";
import { SearchService } from "../src/main/services/searchService";

describe("indexing and search", () => {
  it("indexes generated fabric images and ranks the matching design first", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-index-"));
    const root = path.join(tempDirectory, "Jacquard Floral");
    const thumbnails = path.join(tempDirectory, "thumbs");
    await fs.mkdir(root, { recursive: true });

    const blueStripe = path.join(root, "D100 Blue Stripe.jpg");
    const redDot = path.join(root, "D200 Red Dot.jpg");
    await makeFabric(blueStripe, "#2369a8", "#f2c84b", "stripe");
    await makeFabric(redDot, "#b93434", "#ffffff", "dot");

    const database = new DatabaseService(path.join(tempDirectory, "index.db"));
    const model = new ModelService({ appRoot: process.cwd(), resourcesPath: process.cwd() });
    const indexer = new IndexingService(database, model, thumbnails);
    const search = new SearchService(database, model, new OpenAiEnhancer());

    await indexer.start({ roots: [{ rootPath: root, kind: "folder" }], rebuild: true });
    await waitForCompletion(indexer);

    const response = await search.search({ imagePath: blueStripe, limit: 2 });

    expect(response.results[0]?.design.designNumber).toBe("D100");
    expect(response.results[0]?.score ?? 0).toBeGreaterThan(0.8);
    expect(database.getLibraryStats(model.getStatus()).totalDesigns).toBe(2);
    expect(database.listDesigns({ limit: 1 }).designs).toHaveLength(1);
    expect(database.listDesigns({ search: "Blue Stripe", limit: 100 }).designs[0]?.filePath).toBe(blueStripe);

    database.close();
  });

  it("matches a photographed fabric crop back to the source design", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-photo-search-"));
    const root = path.join(tempDirectory, "Photo Samples");
    const thumbnails = path.join(tempDirectory, "thumbs");
    await fs.mkdir(root, { recursive: true });

    const blueStripe = path.join(root, "D100 Blue Stripe.jpg");
    const redDot = path.join(root, "D200 Red Dot.jpg");
    const photoQuery = path.join(tempDirectory, "phone-photo-blue-stripe.jpg");
    await makeFabric(blueStripe, "#2369a8", "#f2c84b", "stripe");
    await makeFabric(redDot, "#b93434", "#ffffff", "dot");
    await makeFabricPhoto(photoQuery, "#2369a8", "#f2c84b", "stripe");

    const database = new DatabaseService(path.join(tempDirectory, "index.db"));
    const model = new ModelService({ appRoot: process.cwd(), resourcesPath: process.cwd() });
    const indexer = new IndexingService(database, model, thumbnails);
    const search = new SearchService(database, model, new OpenAiEnhancer());

    await indexer.start({ roots: [{ rootPath: root, kind: "folder" }], rebuild: true });
    await waitForCompletion(indexer);

    const response = await search.search({ imagePath: photoQuery, limit: 2 });

    expect(response.results[0]?.design.designNumber).toBe("D100");
    expect(response.results[0]?.score ?? 0).toBeGreaterThan(0.55);

    database.close();
  });

  it("matches a rotated fabric photo back to the source design", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-rotated-search-"));
    const root = path.join(tempDirectory, "Rotated Samples");
    const thumbnails = path.join(tempDirectory, "thumbs");
    await fs.mkdir(root, { recursive: true });

    const verticalVine = path.join(root, "D300 Vertical Vine.jpg");
    const checkPattern = path.join(root, "D400 Check Pattern.jpg");
    const rotatedQuery = path.join(tempDirectory, "phone-photo-rotated-vine.jpg");
    await makeVineDesign(verticalVine);
    await makeFabric(checkPattern, "#745fc9", "#d8cf54", "stripe");
    await sharp(verticalVine)
      .rotate(90)
      .modulate({ brightness: 0.9, saturation: 0.2 })
      .jpeg({ quality: 88 })
      .toFile(rotatedQuery);

    const database = new DatabaseService(path.join(tempDirectory, "index.db"));
    const model = new ModelService({ appRoot: process.cwd(), resourcesPath: process.cwd() });
    const indexer = new IndexingService(database, model, thumbnails);
    const search = new SearchService(database, model, new OpenAiEnhancer());

    await indexer.start({ roots: [{ rootPath: root, kind: "folder" }], rebuild: true });
    await waitForCompletion(indexer);

    const response = await search.search({ imagePath: rotatedQuery, limit: 2 });

    expect(response.results[0]?.design.designNumber).toBe("D300");

    database.close();
  });

  it("stores failed image file paths and reasons during indexing", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-failures-"));
    const root = path.join(tempDirectory, "Mixed Quality");
    const thumbnails = path.join(tempDirectory, "thumbs");
    await fs.mkdir(root, { recursive: true });

    const validImage = path.join(root, "D100 Valid.jpg");
    const brokenImage = path.join(root, "D999 Broken.bmp");
    await makeFabric(validImage, "#2369a8", "#f2c84b", "stripe");
    await fs.writeFile(brokenImage, Buffer.from("BMbad"));

    const database = new DatabaseService(path.join(tempDirectory, "index.db"));
    const model = new ModelService({ appRoot: process.cwd(), resourcesPath: process.cwd() });
    const indexer = new IndexingService(database, model, thumbnails);

    await indexer.start({ roots: [{ rootPath: root, kind: "folder" }], rebuild: true });
    await waitForCompletion(indexer);

    const status = indexer.status();
    const failures = database.listIndexFailures(status.id);

    expect(status.failed).toBe(1);
    expect(failures.total).toBe(1);
    expect(failures.failures[0]?.filePath).toBe(brokenImage);
    expect(failures.failures[0]?.reason).toBeTruthy();

    database.close();
  });

  it("skips files that have image extensions but are not image data", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-skipped-"));
    const root = path.join(tempDirectory, "Mixed Extensions");
    const thumbnails = path.join(tempDirectory, "thumbs");
    await fs.mkdir(root, { recursive: true });

    const validImage = path.join(root, "D100 Valid.jpg");
    const misnamedImage = path.join(root, "D998 Not Really Jpeg.jpg");
    await makeFabric(validImage, "#2369a8", "#f2c84b", "stripe");
    await fs.writeFile(misnamedImage, Buffer.from([0x07, 0x02, 0x02, 0x07, 0xff, 0x03]));

    const database = new DatabaseService(path.join(tempDirectory, "index.db"));
    const model = new ModelService({ appRoot: process.cwd(), resourcesPath: process.cwd() });
    const indexer = new IndexingService(database, model, thumbnails);

    await indexer.start({ roots: [{ rootPath: root, kind: "folder" }], rebuild: true });
    await waitForCompletion(indexer);

    const status = indexer.status();
    const failures = database.listIndexFailures(status.id);

    expect(status.failed).toBe(0);
    expect(status.skipped).toBe(1);
    expect(failures.total).toBe(0);
    expect(database.getLibraryStats(model.getStatus()).totalDesigns).toBe(1);

    database.close();
  });
});

async function waitForCompletion(indexer: IndexingService): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = indexer.status();
    if (status.state === "completed") return;
    if (status.state === "failed") throw new Error(status.message ?? "Index failed");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for index completion.");
}

async function makeFabric(filePath: string, background: string, accent: string, pattern: "stripe" | "dot"): Promise<void> {
  await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background
    }
  })
    .composite([{ input: Buffer.from(fabricOverlaySvg(128, 128, accent, pattern)), left: 0, top: 0 }])
    .jpeg()
    .toFile(filePath);
}

async function makeFabricPhoto(
  filePath: string,
  background: string,
  accent: string,
  pattern: "stripe" | "dot"
): Promise<void> {
  const fabricPanel = Buffer.from(`
    <svg width="300" height="230" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="fabric" width="128" height="128" patternUnits="userSpaceOnUse">
          <rect width="128" height="128" fill="${background}"/>
          ${fabricOverlaySvg(128, 128, accent, pattern, false)}
        </pattern>
      </defs>
      <rect width="300" height="230" fill="url(#fabric)"/>
      <rect width="300" height="230" fill="rgba(255,255,255,0.12)"/>
      <path d="M0 20 C80 0 190 45 300 18 L300 230 L0 230 Z" fill="rgba(0,0,0,0.06)"/>
    </svg>
  `);

  await sharp({
    create: {
      width: 360,
      height: 280,
      channels: 3,
      background: "#ece7dd"
    }
  })
    .composite([{ input: fabricPanel, left: 30, top: 24 }])
    .modulate({ brightness: 0.92, saturation: 0.84 })
    .blur(0.3)
    .jpeg({ quality: 88 })
    .toFile(filePath);
}

async function makeVineDesign(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 180,
      height: 220,
      channels: 3,
      background: "#f7f7f7"
    }
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="180" height="220" xmlns="http://www.w3.org/2000/svg">
            <path d="M92 215 C72 170 78 132 103 102 C130 70 124 32 90 4" fill="none" stroke="#111" stroke-width="13" stroke-linecap="round"/>
            <path d="M85 165 C38 158 30 110 75 98" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/>
            <path d="M100 128 C148 126 154 80 111 71" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/>
            <path d="M72 75 C34 54 56 19 89 42" fill="none" stroke="#111" stroke-width="7" stroke-linecap="round"/>
            <path d="M111 176 C152 169 160 130 122 119" fill="none" stroke="#111" stroke-width="7" stroke-linecap="round"/>
          </svg>
        `),
        top: 0,
        left: 0
      }
    ])
    .jpeg()
    .toFile(filePath);
}

function fabricOverlaySvg(
  width: number,
  height: number,
  accent: string,
  pattern: "stripe" | "dot",
  includeSvgTag = true
): string {
  const shapes =
    pattern === "stripe"
      ? `<rect x="18" width="14" height="${height}" fill="${accent}"/><rect x="68" width="18" height="${height}" fill="${accent}"/>`
      : `<circle cx="32" cy="32" r="12" fill="${accent}"/><circle cx="82" cy="82" r="14" fill="${accent}"/><circle cx="100" cy="28" r="9" fill="${accent}"/>`;

  return includeSvgTag ? `<svg width="${width}" height="${height}">${shapes}</svg>` : shapes;
}
