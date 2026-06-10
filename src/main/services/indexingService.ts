import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { IndexJobStatus, PickedRoot } from "../../shared/types";
import { FAST_FEATURE_VERSION } from "../../shared/constants";
import { DatabaseService } from "./database";
import {
  createThumbnail,
  ensureDirectory,
  extractFastFeatures,
  isSupportedImage,
  UnsupportedImageFileError
} from "./imageFeatures";
import { inferMetadataFromPath } from "./metadata";
import { ModelService } from "./modelService";

export class IndexingService {
  private activeJobId: number | null = null;
  private pauseRequested = false;
  private cancelRequested = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly modelService: ModelService,
    private readonly thumbnailDirectory: string
  ) {}

  async start(payload: { roots?: PickedRoot[]; rebuild?: boolean }): Promise<IndexJobStatus> {
    const latest = this.database.getLatestIndexJob();
    if (this.activeJobId && (latest.state === "running" || latest.state === "paused")) {
      return latest;
    }

    if (payload.roots?.length) {
      this.database.upsertScanRoots(payload.roots);
    }

    const rootPaths = (payload.roots?.length ? payload.roots : this.database.listScanRoots())
      .filter((root) => "enabled" in root ? root.enabled : true)
      .map((root) => root.rootPath);

    if (rootPaths.length === 0) {
      throw new Error("Add at least one folder or drive before indexing.");
    }

    if (payload.rebuild) {
      this.database.deleteDesignsForRoots(rootPaths);
    }

    await ensureDirectory(this.thumbnailDirectory);
    const job = this.database.createIndexJob(rootPaths);
    this.activeJobId = job.id;
    this.pauseRequested = false;
    this.cancelRequested = false;

    void this.runJob(job.id, rootPaths).catch((error) => {
      this.database.updateIndexJob(job.id, {
        state: "failed",
        completedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error)
      });
      this.activeJobId = null;
    });

    return job;
  }

  pause(): IndexJobStatus {
    this.pauseRequested = true;
    const latest = this.database.getLatestIndexJob();
    if (latest.id) {
      return this.database.updateIndexJob(latest.id, { state: "paused", message: "Indexing paused." });
    }
    return latest;
  }

  resume(): IndexJobStatus {
    this.pauseRequested = false;
    const latest = this.database.getLatestIndexJob();
    if (latest.id && latest.state === "paused") {
      return this.database.updateIndexJob(latest.id, { state: "running", message: "Indexing resumed." });
    }
    return latest;
  }

  cancel(): IndexJobStatus {
    this.cancelRequested = true;
    const latest = this.database.getLatestIndexJob();
    if (latest.id) {
      return this.database.updateIndexJob(latest.id, {
        state: "cancelled",
        completedAt: Date.now(),
        message: "Indexing cancelled."
      });
    }
    return latest;
  }

  status(): IndexJobStatus {
    return this.database.getLatestIndexJob();
  }

  private async runJob(jobId: number, rootPaths: string[]): Promise<void> {
    let status = this.database.getIndexJob(jobId)!;
    const modelVersion = this.modelService.getModelVersion();

    for (const rootPath of rootPaths) {
      if (this.cancelRequested) break;

      for await (const filePath of walkImageFiles(rootPath)) {
        if (this.cancelRequested) break;
        await this.waitIfPaused(jobId);
        let phase = "Read file information";

        status = this.database.updateIndexJob(jobId, {
          state: "running",
          totalDiscovered: status.totalDiscovered + 1,
          currentFile: filePath
        });

        try {
          phase = "Read file information";
          const stat = await fs.stat(filePath);
          const existing = this.database.findDesignByPath(filePath);
          const modifiedTime = Math.round(stat.mtimeMs);

          if (existing && this.database.hasCurrentFeatures(existing.id, stat.size, modifiedTime, modelVersion)) {
            status = this.database.updateIndexJob(jobId, {
              processed: status.processed + 1,
              skipped: status.skipped + 1
            });
            continue;
          }

          phase = "Extract visual features";
          const fastFeatures = await extractFastFeatures(filePath);
          const thumbnailPath = path.join(this.thumbnailDirectory, `${hashPath(filePath)}.jpg`);

          phase = "Create thumbnail";
          await createThumbnail(filePath, thumbnailPath);
          const metadata = inferMetadataFromPath(filePath, rootPath);

          phase = "Save design metadata";
          const design = this.database.upsertDesign({
            ...metadata,
            filePath,
            sourceRoot: rootPath,
            folderPath: path.dirname(filePath),
            thumbnailPath,
            width: fastFeatures.width,
            height: fastFeatures.height,
            fileSize: stat.size,
            modifiedTime
          });

          phase = "Generate visual embedding";
          const aiEmbedding = await this.modelService.embedImage(filePath, fastFeatures.fastVector);

          phase = "Save visual features";
          this.database.upsertFeature({
            designId: design.id,
            fastVector: fastFeatures.fastVector,
            aiEmbedding,
            perceptualHash: fastFeatures.perceptualHash,
            featureVersion: FAST_FEATURE_VERSION,
            modelVersion
          });

          status = this.database.updateIndexJob(jobId, {
            processed: status.processed + 1,
            indexed: status.indexed + 1
          });
        } catch (error) {
          const reason = describeIndexingError(error);

          if (error instanceof UnsupportedImageFileError) {
            status = this.database.updateIndexJob(jobId, {
              processed: status.processed + 1,
              skipped: status.skipped + 1,
              message: `${path.basename(filePath)} skipped: ${reason}`
            });
            continue;
          }

          this.database.recordIndexFailure({
            jobId,
            filePath,
            reason,
            phase
          });

          status = this.database.updateIndexJob(jobId, {
            processed: status.processed + 1,
            failed: status.failed + 1,
            message: `${path.basename(filePath)}: ${reason}`
          });
        }
      }

      this.database.touchScanRoot(rootPath);
    }

    if (this.cancelRequested) {
      this.database.updateIndexJob(jobId, {
        state: "cancelled",
        completedAt: Date.now(),
        currentFile: undefined,
        message: "Indexing cancelled."
      });
    } else {
      this.database.updateIndexJob(jobId, {
        state: "completed",
        completedAt: Date.now(),
        currentFile: undefined,
        message: "Indexing completed."
      });
    }

    this.activeJobId = null;
  }

  private async waitIfPaused(jobId: number): Promise<void> {
    if (!this.pauseRequested) return;
    this.database.updateIndexJob(jobId, { state: "paused", message: "Indexing paused." });
    while (this.pauseRequested && !this.cancelRequested) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function* walkImageFiles(rootPath: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkImageFiles(fullPath);
    } else if (entry.isFile() && isSupportedImage(fullPath)) {
      yield fullPath;
    }
  }
}

function hashPath(filePath: string): string {
  return crypto.createHash("sha1").update(filePath).digest("hex");
}

function describeIndexingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return "Unknown indexing error.";
  return message.replace(/\s+/g, " ").trim();
}
