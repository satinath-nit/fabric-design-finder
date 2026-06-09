import type {
  AppSettings,
  FabricFinderApi,
  IndexJobStatus,
  LibraryStats,
  ModelStatus,
  SearchResponse
} from "../../shared/types";

const fallbackModel: ModelStatus = {
  available: false,
  modelName: "Browser preview",
  modelVersion: "preview",
  mode: "fallback",
  message: "Electron preload is not attached in browser preview."
};

const fallbackSettings: AppSettings = {
  similarityThreshold: 0.62,
  indexLocation: "Browser preview",
  openAiApiKeyConfigured: false,
  onlineEnhancementEnabled: false
};

const fallbackJob: IndexJobStatus = {
  id: 0,
  state: "idle",
  roots: [],
  totalDiscovered: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  failed: 0
};

const fallbackStats: LibraryStats = {
  totalDesigns: 0,
  totalRoots: 0,
  totalFeatures: 0,
  totalAiEmbeddings: 0,
  modelStatus: fallbackModel
};

const browserFallback: FabricFinderApi = {
  pickImage: async () => null,
  pickRoots: async () => [],
  listScanRoots: async () => [],
  addScanRoots: async () => [],
  startIndex: async () => fallbackJob,
  pauseIndex: async () => fallbackJob,
  resumeIndex: async () => fallbackJob,
  cancelIndex: async () => fallbackJob,
  getIndexStatus: async () => fallbackJob,
  searchByImage: async (request): Promise<SearchResponse> => ({
    queryImagePath: request.imagePath,
    modelStatus: fallbackModel,
    elapsedMs: 0,
    results: []
  }),
  getDesign: async () => null,
  openFile: async () => undefined,
  openFolder: async () => undefined,
  getImageDataUrl: async () => null,
  getLibraryStats: async () => fallbackStats,
  getSettings: async () => fallbackSettings,
  updateSettings: async (settings) => ({ ...fallbackSettings, ...settings, openAiApiKeyConfigured: false }),
  platform: async () => "darwin",
  toFileUrl: (filePath) => filePath
};

export const fabricApi: FabricFinderApi = window.fabricFinder ?? browserFallback;
