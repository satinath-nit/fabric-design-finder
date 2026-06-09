/// <reference types="vite/client" />

import type { FabricFinderApi } from "../../shared/types";

declare global {
  interface Window {
    fabricFinder: FabricFinderApi;
  }
}
