import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://huggingface.co/amikos/openclip-vit-b-32-laion2b-s34b-b79k-onnx/resolve/main/vision_model.onnx";
const MODEL_SHA256 = "7e14f76233d0c840c0621b1ef68f5877efe9357850782b1bbaf0c01693f73b43";
const MODEL_SIZE_BYTES = 351618799;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const modelPath = path.join(projectRoot, "assets", "models", "openclip", "model.onnx");
const tempPath = `${modelPath}.download`;
const force = process.argv.includes("--force");

async function main() {
  await fs.mkdir(path.dirname(modelPath), { recursive: true });

  if (!force && (await fileExists(modelPath))) {
    const currentHash = await sha256File(modelPath);
    if (currentHash === MODEL_SHA256) {
      console.log(`OpenCLIP model already exists at ${relativePath(modelPath)}.`);
      console.log(`sha256 ${currentHash}`);
      return;
    }

    console.log(`Existing model hash did not match; downloading a fresh copy.`);
    console.log(`found    ${currentHash}`);
    console.log(`expected ${MODEL_SHA256}`);
  }

  await fs.rm(tempPath, { force: true });
  console.log(`Downloading OpenCLIP ONNX model to ${relativePath(modelPath)}.`);
  console.log(`Source: ${MODEL_URL}`);
  await downloadFile(MODEL_URL, tempPath);

  const downloadedHash = await sha256File(tempPath);
  if (downloadedHash !== MODEL_SHA256) {
    await fs.rm(tempPath, { force: true });
    throw new Error(`Downloaded model checksum mismatch. Expected ${MODEL_SHA256}, got ${downloadedHash}.`);
  }

  await fs.rename(tempPath, modelPath);
  console.log(`Downloaded ${relativePath(modelPath)}.`);
  console.log(`sha256 ${downloadedHash}`);
}

async function downloadFile(url, destination, redirectCount = 0) {
  if (redirectCount > 5) throw new Error("Too many redirects while downloading model.");

  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      const redirect = response.headers.location;
      if (status >= 300 && status < 400 && redirect) {
        response.resume();
        resolve(downloadFile(new URL(redirect, url).toString(), destination, redirectCount + 1));
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}.`));
        return;
      }

      const total = Number(response.headers["content-length"] ?? MODEL_SIZE_BYTES);
      let downloaded = 0;
      let lastPercent = -1;
      const output = createWriteStream(destination);

      response.on("data", (chunk) => {
        downloaded += chunk.length;
        const percent = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
        if (percent !== lastPercent && (percent % 5 === 0 || percent === 100)) {
          process.stdout.write(`\r${percent}%`);
          lastPercent = percent;
        }
      });

      response.pipe(output);
      output.on("finish", () => {
        output.close(() => {
          process.stdout.write("\n");
          resolve();
        });
      });
      output.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function relativePath(filePath) {
  return path.relative(projectRoot, filePath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
