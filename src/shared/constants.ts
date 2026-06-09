import type { SupportedImageExtension } from "./types";

export const SUPPORTED_IMAGE_EXTENSIONS: SupportedImageExtension[] = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff"
];

export const FAST_FEATURE_VERSION = "fast-features-v1";
export const FALLBACK_MODEL_VERSION = "local-projection-v1";
export const OPENCLIP_MODEL_NAME = "OpenCLIP ONNX image encoder";
export const DEFAULT_SEARCH_LIMIT = 24;
export const AI_RERANK_CANDIDATES = 80;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.62;
