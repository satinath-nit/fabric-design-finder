import Database from "better-sqlite3";
import type {
  AppSettings,
  DesignRecord,
  IndexJobState,
  IndexJobStatus,
  LibraryStats,
  ModelStatus,
  PickedRoot,
  ScanRoot
} from "../../shared/types";
import { DEFAULT_SIMILARITY_THRESHOLD, FAST_FEATURE_VERSION, FALLBACK_MODEL_VERSION } from "../../shared/constants";
import { bufferToVector, vectorToBuffer } from "./vector";

export interface DesignUpsertInput {
  designNumber: string;
  designName: string;
  variant: string;
  filePath: string;
  sourceRoot: string;
  folderPath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  fileSize: number;
  modifiedTime: number;
}

export interface FeatureUpsertInput {
  designId: number;
  fastVector: number[];
  aiEmbedding?: number[];
  perceptualHash: string;
  featureVersion: string;
  modelVersion: string;
}

export interface CorpusItem {
  design: DesignRecord;
  fastVector: Float32Array;
  aiEmbedding: Float32Array;
  perceptualHash: string;
}

interface DesignRow {
  id: number;
  design_number: string;
  design_name: string;
  variant: string;
  file_path: string;
  source_root: string;
  folder_path: string;
  thumbnail_path: string;
  width: number;
  height: number;
  file_size: number;
  modified_time: number;
  created_at: number;
  updated_at: number;
}

interface ScanRootRow {
  id: number;
  root_path: string;
  kind: "folder" | "drive";
  enabled: 0 | 1;
  last_scanned_at: number | null;
}

interface JobRow {
  id: number;
  state: IndexJobState;
  roots: string;
  total_discovered: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  current_file: string | null;
  started_at: number | null;
  completed_at: number | null;
  message: string | null;
}

export class DatabaseService {
  private db: Database.Database;
  private corpusCache: CorpusItem[] | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  listScanRoots(): ScanRoot[] {
    const rows = this.db.prepare("SELECT * FROM scan_roots ORDER BY root_path").all() as ScanRootRow[];
    return rows.map(mapScanRoot);
  }

  upsertScanRoots(roots: PickedRoot[]): ScanRoot[] {
    const statement = this.db.prepare(`
      INSERT INTO scan_roots (root_path, kind, enabled)
      VALUES (@rootPath, @kind, 1)
      ON CONFLICT(root_path) DO UPDATE SET
        kind = excluded.kind,
        enabled = 1
    `);

    const run = this.db.transaction((items: PickedRoot[]) => {
      for (const root of items) statement.run(root);
    });
    run(roots);
    return this.listScanRoots();
  }

  touchScanRoot(rootPath: string): void {
    this.db
      .prepare("UPDATE scan_roots SET last_scanned_at = @lastScannedAt WHERE root_path = @rootPath")
      .run({ rootPath, lastScannedAt: Date.now() });
  }

  createIndexJob(roots: string[]): IndexJobStatus {
    const result = this.db
      .prepare(
        `INSERT INTO index_jobs
          (state, roots, total_discovered, processed, indexed, skipped, failed, started_at)
        VALUES ('running', @roots, 0, 0, 0, 0, 0, @startedAt)`
      )
      .run({ roots: JSON.stringify(roots), startedAt: Date.now() });
    return this.getIndexJob(Number(result.lastInsertRowid))!;
  }

  updateIndexJob(id: number, patch: Partial<Omit<IndexJobStatus, "id" | "roots">>): IndexJobStatus {
    const current = this.getIndexJob(id);
    if (!current) throw new Error(`Index job ${id} was not found.`);

    const next = {
      state: patch.state ?? current.state,
      totalDiscovered: patch.totalDiscovered ?? current.totalDiscovered,
      processed: patch.processed ?? current.processed,
      indexed: patch.indexed ?? current.indexed,
      skipped: patch.skipped ?? current.skipped,
      failed: patch.failed ?? current.failed,
      currentFile: Object.prototype.hasOwnProperty.call(patch, "currentFile")
        ? patch.currentFile ?? null
        : current.currentFile ?? null,
      completedAt: Object.prototype.hasOwnProperty.call(patch, "completedAt")
        ? patch.completedAt ?? null
        : current.completedAt ?? null,
      message: Object.prototype.hasOwnProperty.call(patch, "message") ? patch.message ?? null : current.message ?? null
    };

    this.db
      .prepare(
        `UPDATE index_jobs SET
          state = @state,
          total_discovered = @totalDiscovered,
          processed = @processed,
          indexed = @indexed,
          skipped = @skipped,
          failed = @failed,
          current_file = @currentFile,
          completed_at = @completedAt,
          message = @message
        WHERE id = @id`
      )
      .run({ id, ...next });

    return this.getIndexJob(id)!;
  }

  getIndexJob(id: number): IndexJobStatus | null {
    const row = this.db.prepare("SELECT * FROM index_jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  getLatestIndexJob(): IndexJobStatus {
    const row = this.db.prepare("SELECT * FROM index_jobs ORDER BY id DESC LIMIT 1").get() as JobRow | undefined;
    return row
      ? mapJob(row)
      : {
          id: 0,
          state: "idle",
          roots: [],
          totalDiscovered: 0,
          processed: 0,
          indexed: 0,
          skipped: 0,
          failed: 0
        };
  }

  findDesignByPath(filePath: string): DesignRecord | null {
    const row = this.db.prepare("SELECT * FROM designs WHERE file_path = ?").get(filePath) as DesignRow | undefined;
    return row ? mapDesign(row) : null;
  }

  hasCurrentFeatures(designId: number, fileSize: number, modifiedTime: number, modelVersion: string): boolean {
    const row = this.db
      .prepare(
        `SELECT d.id
         FROM designs d
         JOIN image_features f ON f.design_id = d.id
         WHERE d.id = @designId
           AND d.file_size = @fileSize
           AND d.modified_time = @modifiedTime
           AND f.feature_version = @featureVersion
           AND f.model_version = @modelVersion`
      )
      .get({ designId, fileSize, modifiedTime, featureVersion: FAST_FEATURE_VERSION, modelVersion }) as
      | { id: number }
      | undefined;
    return Boolean(row);
  }

  upsertDesign(input: DesignUpsertInput): DesignRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO designs
          (design_number, design_name, variant, file_path, source_root, folder_path, thumbnail_path,
           width, height, file_size, modified_time, created_at, updated_at)
        VALUES
          (@designNumber, @designName, @variant, @filePath, @sourceRoot, @folderPath, @thumbnailPath,
           @width, @height, @fileSize, @modifiedTime, @now, @now)
        ON CONFLICT(file_path) DO UPDATE SET
          design_number = excluded.design_number,
          design_name = excluded.design_name,
          variant = excluded.variant,
          source_root = excluded.source_root,
          folder_path = excluded.folder_path,
          thumbnail_path = excluded.thumbnail_path,
          width = excluded.width,
          height = excluded.height,
          file_size = excluded.file_size,
          modified_time = excluded.modified_time,
          updated_at = excluded.updated_at`
      )
      .run({ ...input, now });

    this.invalidateCorpus();
    return this.findDesignByPath(input.filePath)!;
  }

  upsertFeature(input: FeatureUpsertInput): void {
    this.db
      .prepare(
        `INSERT INTO image_features
          (design_id, fast_vector, ai_embedding, perceptual_hash, feature_version, model_version, indexed_at)
        VALUES
          (@designId, @fastVector, @aiEmbedding, @perceptualHash, @featureVersion, @modelVersion, @indexedAt)
        ON CONFLICT(design_id) DO UPDATE SET
          fast_vector = excluded.fast_vector,
          ai_embedding = excluded.ai_embedding,
          perceptual_hash = excluded.perceptual_hash,
          feature_version = excluded.feature_version,
          model_version = excluded.model_version,
          indexed_at = excluded.indexed_at`
      )
      .run({
        designId: input.designId,
        fastVector: vectorToBuffer(input.fastVector),
        aiEmbedding: input.aiEmbedding ? vectorToBuffer(input.aiEmbedding) : null,
        perceptualHash: input.perceptualHash,
        featureVersion: input.featureVersion,
        modelVersion: input.modelVersion,
        indexedAt: Date.now()
      });

    this.invalidateCorpus();
  }

  deleteDesignsForRoots(roots: string[]): void {
    if (roots.length === 0) return;
    const statement = this.db.prepare("DELETE FROM designs WHERE source_root = ?");
    const run = this.db.transaction((items: string[]) => {
      for (const root of items) statement.run(root);
    });
    run(roots);
    this.invalidateCorpus();
  }

  getDesign(id: number): DesignRecord | null {
    const row = this.db.prepare("SELECT * FROM designs WHERE id = ?").get(id) as DesignRow | undefined;
    return row ? mapDesign(row) : null;
  }

  getCorpus(): CorpusItem[] {
    if (this.corpusCache) return this.corpusCache;

    const rows = this.db
      .prepare(
        `SELECT
          d.*,
          f.fast_vector,
          f.ai_embedding,
          f.perceptual_hash
        FROM designs d
        JOIN image_features f ON f.design_id = d.id`
      )
      .all() as Array<DesignRow & { fast_vector: Buffer; ai_embedding: Buffer | null; perceptual_hash: string }>;

    this.corpusCache = rows.map((row) => ({
      design: mapDesign(row),
      fastVector: bufferToVector(row.fast_vector),
      aiEmbedding: bufferToVector(row.ai_embedding),
      perceptualHash: row.perceptual_hash
    }));

    return this.corpusCache;
  }

  getSettings(indexLocation: string): AppSettings {
    return {
      similarityThreshold: Number(this.getSetting("similarity_threshold", String(DEFAULT_SIMILARITY_THRESHOLD))),
      indexLocation,
      openAiApiKeyConfigured: Boolean(this.getSetting("openai_api_key", "")),
      onlineEnhancementEnabled: this.getSetting("online_enhancement_enabled", "false") === "true"
    };
  }

  getOpenAiApiKey(): string {
    return this.getSetting("openai_api_key", "");
  }

  updateSettings(settings: Partial<AppSettings> & { openAiApiKey?: string }, indexLocation: string): AppSettings {
    if (typeof settings.similarityThreshold === "number") {
      this.setSetting("similarity_threshold", String(settings.similarityThreshold));
    }
    if (typeof settings.onlineEnhancementEnabled === "boolean") {
      this.setSetting("online_enhancement_enabled", String(settings.onlineEnhancementEnabled));
    }
    if (settings.openAiApiKey !== undefined) {
      this.setSetting("openai_api_key", settings.openAiApiKey.trim());
    }
    return this.getSettings(indexLocation);
  }

  getLibraryStats(modelStatus: ModelStatus): LibraryStats {
    const row = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM designs) AS totalDesigns,
          (SELECT COUNT(*) FROM scan_roots WHERE enabled = 1) AS totalRoots,
          (SELECT COUNT(*) FROM image_features) AS totalFeatures,
          (SELECT COUNT(*) FROM image_features WHERE ai_embedding IS NOT NULL) AS totalAiEmbeddings`
      )
      .get() as {
      totalDesigns: number;
      totalRoots: number;
      totalFeatures: number;
      totalAiEmbeddings: number;
    };

    return { ...row, modelStatus };
  }

  private getSetting(key: string, fallback: string): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value)
         VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run({ key, value });
  }

  private invalidateCorpus(): void {
    this.corpusCache = null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('folder', 'drive')),
        enabled INTEGER NOT NULL DEFAULT 1,
        last_scanned_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS designs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        design_number TEXT NOT NULL,
        design_name TEXT NOT NULL,
        variant TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        source_root TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        thumbnail_path TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        modified_time INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_designs_number ON designs(design_number);
      CREATE INDEX IF NOT EXISTS idx_designs_source_root ON designs(source_root);
      CREATE INDEX IF NOT EXISTS idx_designs_modified ON designs(modified_time);

      CREATE TABLE IF NOT EXISTS image_features (
        design_id INTEGER PRIMARY KEY,
        fast_vector BLOB NOT NULL,
        ai_embedding BLOB,
        perceptual_hash TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        model_version TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS index_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state TEXT NOT NULL,
        roots TEXT NOT NULL,
        total_discovered INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        indexed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        message TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.setSetting("feature_version", FAST_FEATURE_VERSION);
    if (!this.getSetting("similarity_threshold", "")) {
      this.setSetting("similarity_threshold", String(DEFAULT_SIMILARITY_THRESHOLD));
    }
    if (!this.getSetting("model_version", "")) {
      this.setSetting("model_version", FALLBACK_MODEL_VERSION);
    }
  }
}

function mapDesign(row: DesignRow): DesignRecord {
  return {
    id: row.id,
    designNumber: row.design_number,
    designName: row.design_name,
    variant: row.variant,
    filePath: row.file_path,
    sourceRoot: row.source_root,
    folderPath: row.folder_path,
    thumbnailPath: row.thumbnail_path,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    modifiedTime: row.modified_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapScanRoot(row: ScanRootRow): ScanRoot {
  return {
    id: row.id,
    rootPath: row.root_path,
    kind: row.kind,
    enabled: row.enabled === 1,
    lastScannedAt: row.last_scanned_at ?? undefined
  };
}

function mapJob(row: JobRow): IndexJobStatus {
  return {
    id: row.id,
    state: row.state,
    roots: JSON.parse(row.roots) as string[],
    totalDiscovered: row.total_discovered,
    processed: row.processed,
    indexed: row.indexed,
    skipped: row.skipped,
    failed: row.failed,
    currentFile: row.current_file ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    message: row.message ?? undefined
  };
}
