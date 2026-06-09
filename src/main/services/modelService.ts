import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { ModelStatus } from "../../shared/types";
import { FALLBACK_MODEL_VERSION, OPENCLIP_MODEL_NAME } from "../../shared/constants";
import { deterministicProjection, normalizeVector } from "./vector";

type OnnxRuntime = typeof import("onnxruntime-node");
type OnnxSession = Awaited<ReturnType<OnnxRuntime["InferenceSession"]["create"]>>;

export class ModelService {
  private session: OnnxSession | null = null;
  private runtime: OnnxRuntime | null = null;
  private readonly modelPath: string;
  private readonly packagedModelPath: string;
  private readonly developmentModelPath: string;

  constructor(options: { appRoot: string; resourcesPath: string }) {
    this.packagedModelPath = path.join(options.resourcesPath, "models", "openclip", "model.onnx");
    this.developmentModelPath = path.join(options.appRoot, "assets", "models", "openclip", "model.onnx");
    this.modelPath = fs.existsSync(this.packagedModelPath) ? this.packagedModelPath : this.developmentModelPath;
  }

  getStatus(): ModelStatus {
    const available = fs.existsSync(this.modelPath);
    return {
      available,
      modelName: available ? OPENCLIP_MODEL_NAME : "Deterministic local visual embedding",
      modelVersion: available ? "openclip-onnx-v1" : FALLBACK_MODEL_VERSION,
      modelPath: available ? this.modelPath : undefined,
      mode: available ? "onnx" : "fallback",
      message: available
        ? "Bundled OpenCLIP ONNX model is available for offline AI reranking."
        : "OpenCLIP ONNX model is not present; using deterministic local visual embeddings for development/testing."
    };
  }

  getModelVersion(): string {
    return this.getStatus().modelVersion;
  }

  async embedImage(imagePath: string, fastVector: number[]): Promise<number[]> {
    if (!fs.existsSync(this.modelPath)) {
      return deterministicProjection(fastVector);
    }

    try {
      const session = await this.getSession();
      const runtime = this.runtime!;
      const tensorData = await preprocessClipImage(imagePath);
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];

      if (!inputName || !outputName) {
        throw new Error("ONNX model does not expose input/output names.");
      }

      const feeds = {
        [inputName]: new runtime.Tensor("float32", tensorData, [1, 3, 224, 224])
      };
      const result = await session.run(feeds);
      const output = result[outputName];
      const values = Array.from(output.data as Float32Array | number[]);
      return normalizeVector(values);
    } catch (error) {
      console.warn("OpenCLIP ONNX inference failed; falling back to deterministic projection.", error);
      return deterministicProjection(fastVector);
    }
  }

  private async getSession(): Promise<OnnxSession> {
    if (this.session) return this.session;
    this.runtime = await import("onnxruntime-node");
    this.session = await this.runtime.InferenceSession.create(this.modelPath, {
      executionProviders: ["cpu"]
    });
    return this.session;
  }
}

async function preprocessClipImage(imagePath: string): Promise<Float32Array> {
  const { data } = await sharp(imagePath)
    .rotate()
    .resize(224, 224, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = 224;
  const height = 224;
  const channelSize = width * height;
  const output = new Float32Array(3 * channelSize);
  const mean = [0.48145466, 0.4578275, 0.40821073];
  const std = [0.26862954, 0.26130258, 0.27577711];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 3;
      output[pixel] = ((data[offset] ?? 0) / 255 - mean[0]) / std[0];
      output[channelSize + pixel] = ((data[offset + 1] ?? 0) / 255 - mean[1]) / std[1];
      output[channelSize * 2 + pixel] = ((data[offset + 2] ?? 0) / 255 - mean[2]) / std[2];
    }
  }

  return output;
}
