# Fabric Design Finder

Offline-first AI-powered desktop application for textile and fabric manufacturers. The app indexes fabric design images from local folders or drives, stores searchable records in SQLite, and finds matching designs from an uploaded image without requiring internet access.

## What It Does

- Indexes fabric images from selected folders or full drives.
- Infers design metadata from folder and file names.
- Generates thumbnails and local image features.
- Searches indexed designs from an uploaded query image.
- Ranks matches using fast visual features plus local AI embeddings.
- Supports optional OpenAI API enhancement for descriptions and tags only.
- Packages as a Windows installer `.exe` using Electron Builder.

## Local Setup

### Prerequisites

- Node.js 22 LTS or newer
- npm 10 or newer
- macOS for local testing, or Windows for final `.exe` validation
- Optional for Windows native rebuild issues: Visual Studio Build Tools with "Desktop development with C++"

### Install Dependencies

```bash
npm install
```

If npm fails because of stale private registry credentials, use a clean npm config:

```bash
npm install --userconfig /tmp/fabric-finder-empty-npmrc --registry https://registry.npmjs.org/
```

On Windows PowerShell, use:

```powershell
New-Item -ItemType File -Force "$env:TEMP\fabric-finder-empty-npmrc"
npm install --userconfig "$env:TEMP\fabric-finder-empty-npmrc" --registry https://registry.npmjs.org/
```

## Run Locally

```bash
npm run dev
```

This starts the Vite renderer at `http://127.0.0.1:5173` and launches the Electron desktop app.

Use the app to:

1. Open the **Library** screen.
2. Add one or more folders or drives.
3. Start indexing.
4. Return to **Search**.
5. Choose a query fabric image and search.

## Test And Build

Run tests:

```bash
npm run test
```

Run production build:

```bash
npm run build
```

The test command rebuilds `better-sqlite3` for Node.js first. The dev and packaging flows rebuild native modules for Electron.

## Windows Installer `.exe`

### Recommended: Build On Windows

Run these commands from a Windows machine:

```powershell
npm install
npm run test
npm run build
npm run dist:win
```

The installer is created under:

```text
release/Fabric Design Finder Setup 0.1.0.exe
```

The Windows installer is configured as an NSIS installer with:

- x64 target
- Start Menu shortcut
- Desktop shortcut
- User-selectable install directory

### Build Script

```bash
npm run dist:win
```

This runs:

```bash
npm run build
electron-builder --win nsis --x64
```

### Notes For macOS Users

You can use macOS to develop and test the app behavior:

```bash
npm run dev
```

You can also build the renderer/main code:

```bash
npm run build
```

However, final Windows installer validation should happen on Windows or in a Windows CI runner because Windows-specific behavior must be verified:

- `.exe` installer creation
- `C:\`, `D:\`, `E:\` drive scanning
- Windows file permissions
- open file/open folder shell actions
- Windows native module packaging
- SmartScreen and antivirus behavior

## AI Model Setup

The app expects an OpenCLIP-compatible ONNX image encoder here:

```text
assets/models/openclip/model.onnx
```

If the model is present, Electron Builder packages it into the installed app under `resources/models/openclip/model.onnx`.

If the model is not present, the app still works using deterministic local visual embeddings. This is useful for development and functional testing, but production matching should use the bundled OpenCLIP ONNX model.

## Optional OpenAI API Key

The OpenAI API key is optional and is not required for local search.

The core matching flow does not upload the local image library to the cloud. If enabled, OpenAI can be used only for online enhancements such as:

- result explanations
- design tags
- visible color/motif/style descriptions
- small top-result enrichment

## Project Structure

```text
src/main/       Electron main process, IPC, indexing, database, search services
src/preload/    Safe renderer-to-main bridge
src/renderer/   React desktop UI
src/shared/     Shared TypeScript contracts and constants
assets/models/  Bundled offline AI model location
tests/          Unit and integration tests
docs/           Architecture and implementation notes
```

## Architecture

See [docs/architecture.md](docs/architecture.md).
