import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, FabricFinderApi, PickedRoot, SearchRequest } from "../shared/types";

const api: FabricFinderApi = {
  pickImage: () => ipcRenderer.invoke("dialog:pick-image"),
  pickRoots: () => ipcRenderer.invoke("library:pick-roots"),
  listScanRoots: () => ipcRenderer.invoke("library:list-roots"),
  addScanRoots: (roots: PickedRoot[]) => ipcRenderer.invoke("library:add-roots", roots),
  startIndex: (payload: { roots?: PickedRoot[]; rebuild?: boolean }) => ipcRenderer.invoke("index:start", payload),
  pauseIndex: () => ipcRenderer.invoke("index:pause"),
  resumeIndex: () => ipcRenderer.invoke("index:resume"),
  cancelIndex: () => ipcRenderer.invoke("index:cancel"),
  getIndexStatus: () => ipcRenderer.invoke("index:status"),
  searchByImage: (request: SearchRequest) => ipcRenderer.invoke("search:by-image", request),
  getDesign: (id: number) => ipcRenderer.invoke("design:get", id),
  openFile: (id: number) => ipcRenderer.invoke("design:open-file", id),
  openFolder: (id: number) => ipcRenderer.invoke("design:open-folder", id),
  getImageDataUrl: (filePath: string) => ipcRenderer.invoke("image:data-url", filePath),
  getLibraryStats: () => ipcRenderer.invoke("library:stats"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<AppSettings> & { openAiApiKey?: string }) =>
    ipcRenderer.invoke("settings:update", settings),
  platform: () => ipcRenderer.invoke("app:platform"),
  toFileUrl: (filePath: string) => `fabric-file://local/?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("fabricFinder", api);
