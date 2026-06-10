import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import type { AppSettings, DesignListRequest, PickedRoot, SearchRequest } from "../shared/types";
import { SUPPORTED_IMAGE_EXTENSIONS } from "../shared/constants";
import { DatabaseService } from "./services/database";
import { IndexingService } from "./services/indexingService";
import { ModelService } from "./services/modelService";
import { OpenAiEnhancer } from "./services/openAiEnhancer";
import { SearchService } from "./services/searchService";
import { createImagePreview, ensureDirectory } from "./services/imageFeatures";

let mainWindow: BrowserWindow | null = null;
let database: DatabaseService;
let indexingService: IndexingService;
let searchService: SearchService;
let modelService: ModelService;

const isDevelopment = !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "fabric-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

async function bootstrapServices(): Promise<void> {
  const userDataPath = app.getPath("userData");
  await ensureDirectory(userDataPath);
  const databasePath = path.join(userDataPath, "fabric-design-finder.db");
  const thumbnailDirectory = path.join(userDataPath, "thumbnails");

  database = new DatabaseService(databasePath);
  modelService = new ModelService({
    appRoot: app.getAppPath(),
    resourcesPath: app.isPackaged ? process.resourcesPath : app.getAppPath()
  });
  indexingService = new IndexingService(database, modelService, thumbnailDirectory);
  searchService = new SearchService(database, modelService, new OpenAiEnhancer());
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: "Fabric Design Finder",
    backgroundColor: "#f7f4ef",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDevelopment) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("dialog:pick-image", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose fabric design image",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.replace(".", ""))
        }
      ]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("library:pick-roots", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose folders or drives to index",
      properties: ["openDirectory", "multiSelections", "createDirectory"]
    });
    if (result.canceled) return [];
    return result.filePaths.map((rootPath) => ({
      rootPath,
      kind: isDriveRoot(rootPath) ? "drive" : "folder"
    }));
  });

  ipcMain.handle("library:list-roots", () => database.listScanRoots());
  ipcMain.handle("library:add-roots", (_event, roots: PickedRoot[]) => database.upsertScanRoots(roots));
  ipcMain.handle("index:start", (_event, payload: { roots?: PickedRoot[]; rebuild?: boolean }) =>
    indexingService.start(payload)
  );
  ipcMain.handle("index:pause", () => indexingService.pause());
  ipcMain.handle("index:resume", () => indexingService.resume());
  ipcMain.handle("index:cancel", () => indexingService.cancel());
  ipcMain.handle("index:status", () => indexingService.status());
  ipcMain.handle("index:failures", (_event, jobId?: number) => database.listIndexFailures(jobId));
  ipcMain.handle("search:by-image", (_event, request: SearchRequest) => searchService.search(request));
  ipcMain.handle("design:get", (_event, id: number) => database.getDesign(id));
  ipcMain.handle("design:list", (_event, request?: DesignListRequest) => database.listDesigns(request));
  ipcMain.handle("design:open-file", async (_event, id: number) => {
    const design = database.getDesign(id);
    if (!design) throw new Error("Design was not found.");
    const error = await shell.openPath(design.filePath);
    if (error) throw new Error(error);
  });
  ipcMain.handle("design:open-folder", (_event, id: number) => {
    const design = database.getDesign(id);
    if (!design) throw new Error("Design was not found.");
    shell.showItemInFolder(design.filePath);
  });
  ipcMain.handle("image:data-url", async (_event, filePath: string) => {
    if (needsConvertedPreview(filePath)) {
      const preview = await createImagePreview(filePath);
      return `data:${preview.mime};base64,${preview.bytes.toString("base64")}`;
    }

    const bytes = await fs.readFile(filePath);
    return `data:${mimeForPath(filePath)};base64,${bytes.toString("base64")}`;
  });
  ipcMain.handle("library:stats", () => database.getLibraryStats(modelService.getStatus()));
  ipcMain.handle("settings:get", () => database.getSettings(app.getPath("userData")));
  ipcMain.handle("settings:update", (_event, settings: Partial<AppSettings> & { openAiApiKey?: string }) =>
    database.updateSettings(settings, app.getPath("userData"))
  );
  ipcMain.handle("app:platform", () => process.platform);
}

function registerLocalFileProtocol(): void {
  protocol.handle("fabric-file", async (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return new Response("Missing file path.", { status: 400 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function isDriveRoot(rootPath: string): boolean {
  return /^[A-Za-z]:[\\/]*$/.test(rootPath) || rootPath === "/";
}

function mimeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".jp2":
    case ".j2k":
      return "image/jp2";
    case ".jxl":
      return "image/jxl";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "image/jpeg";
  }
}

function needsConvertedPreview(filePath: string): boolean {
  return [".bmp", ".heic", ".heif", ".jp2", ".j2k", ".jxl", ".tif", ".tiff"].includes(
    path.extname(filePath).toLowerCase()
  );
}

app.whenReady().then(async () => {
  await bootstrapServices();
  registerLocalFileProtocol();
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  database?.close();
});
