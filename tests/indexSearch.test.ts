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
  const overlay =
    pattern === "stripe"
      ? `<svg width="128" height="128"><rect x="18" width="14" height="128" fill="${accent}"/><rect x="68" width="18" height="128" fill="${accent}"/></svg>`
      : `<svg width="128" height="128"><circle cx="32" cy="32" r="12" fill="${accent}"/><circle cx="82" cy="82" r="14" fill="${accent}"/><circle cx="100" cy="28" r="9" fill="${accent}"/></svg>`;

  await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background
    }
  })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .jpeg()
    .toFile(filePath);
}
