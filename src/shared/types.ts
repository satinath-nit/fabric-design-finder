export type SupportedImageExtension =
  | ".avif"
  | ".gif"
  | ".heic"
  | ".heif"
  | ".jp2"
  | ".j2k"
  | ".jxl"
  | ".jpg"
  | ".jpeg"
  | ".png"
  | ".svg"
  | ".webp"
  | ".bmp"
  | ".tif"
  | ".tiff";

export type ScanRootKind = "folder" | "drive";

export type IndexJobState = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface ScanRoot {
  id: number;
  rootPath: string;
  kind: ScanRootKind;
  enabled: boolean;
  lastScannedAt?: number;
}

export interface DesignRecord {
  id: number;
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
  createdAt: number;
  updatedAt: number;
}

export interface DesignFeatureRecord {
  designId: number;
  fastVector: number[];
  aiEmbedding?: number[];
  perceptualHash: string;
  featureVersion: string;
  modelVersion: string;
  indexedAt: number;
}

export interface IndexJobStatus {
  id: number;
  state: IndexJobState;
  roots: string[];
  totalDiscovered: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  startedAt?: number;
  completedAt?: number;
  message?: string;
}

export interface IndexFailureRecord {
  id: number;
  jobId: number;
  filePath: string;
  reason: string;
  phase: string;
  failedAt: number;
}

export interface IndexFailureList {
  jobId: number;
  total: number;
  failures: IndexFailureRecord[];
}

export interface DesignListRequest {
  search?: string;
  offset?: number;
  limit?: number;
}

export interface DesignListResponse {
  designs: DesignRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SearchResult {
  design: DesignRecord;
  score: number;
  fastScore: number;
  aiScore?: number;
  hashDistance: number;
  explanation?: string;
  tags?: string[];
}

export interface SearchRequest {
  imagePath: string;
  limit?: number;
  useOnlineEnhancement?: boolean;
}

export interface SearchResponse {
  queryImagePath: string;
  modelStatus: ModelStatus;
  elapsedMs: number;
  results: SearchResult[];
}

export interface ModelStatus {
  available: boolean;
  modelName: string;
  modelVersion: string;
  modelPath?: string;
  mode: "onnx" | "fallback";
  message: string;
}

export interface AppSettings {
  similarityThreshold: number;
  indexLocation: string;
  openAiApiKeyConfigured: boolean;
  onlineEnhancementEnabled: boolean;
}

export interface LibraryStats {
  totalDesigns: number;
  totalRoots: number;
  totalFeatures: number;
  totalAiEmbeddings: number;
  modelStatus: ModelStatus;
}

export interface MetadataParts {
  designNumber: string;
  designName: string;
  variant: string;
}

export interface PickedRoot {
  rootPath: string;
  kind: ScanRootKind;
}

export interface FabricFinderApi {
  pickImage(): Promise<string | null>;
  pickRoots(): Promise<PickedRoot[]>;
  listScanRoots(): Promise<ScanRoot[]>;
  addScanRoots(roots: PickedRoot[]): Promise<ScanRoot[]>;
  startIndex(payload: { roots?: PickedRoot[]; rebuild?: boolean }): Promise<IndexJobStatus>;
  pauseIndex(): Promise<IndexJobStatus>;
  resumeIndex(): Promise<IndexJobStatus>;
  cancelIndex(): Promise<IndexJobStatus>;
  deleteIndex(): Promise<LibraryStats>;
  getIndexStatus(): Promise<IndexJobStatus>;
  listIndexFailures(jobId?: number): Promise<IndexFailureList>;
  listDesigns(request?: DesignListRequest): Promise<DesignListResponse>;
  searchByImage(request: SearchRequest): Promise<SearchResponse>;
  getDesign(id: number): Promise<DesignRecord | null>;
  openFile(id: number): Promise<void>;
  openFolder(id: number): Promise<void>;
  getImageDataUrl(filePath: string): Promise<string | null>;
  getLibraryStats(): Promise<LibraryStats>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings> & { openAiApiKey?: string }): Promise<AppSettings>;
  platform(): Promise<NodeJS.Platform>;
  toFileUrl(filePath: string): string;
}
