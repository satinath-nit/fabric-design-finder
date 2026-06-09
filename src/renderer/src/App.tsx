import { useEffect, useMemo, useState } from "react";
import {
  Database,
  FolderOpen,
  Gauge,
  ImagePlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Upload,
  X
} from "lucide-react";
import type {
  AppSettings,
  IndexJobStatus,
  LibraryStats,
  PickedRoot,
  ScanRoot,
  SearchResponse,
  SearchResult
} from "../../shared/types";
import { fabricApi } from "./fabricApi";
import "./styles/app.css";

type View = "search" | "library" | "settings";

const emptyJob: IndexJobStatus = {
  id: 0,
  state: "idle",
  roots: [],
  totalDiscovered: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  failed: 0
};

export default function App(): JSX.Element {
  const [view, setView] = useState<View>("search");
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexJobStatus>(emptyJob);
  const [queryImage, setQueryImage] = useState<string>("");
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [busySearch, setBusySearch] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    void refreshAll();
    const interval = window.setInterval(() => {
      void refreshIndexStatus();
      void refreshStats();
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setSelectedResult(searchResponse?.results[0] ?? null);
  }, [searchResponse]);

  const progress = useMemo(() => {
    if (!indexStatus.totalDiscovered) return 0;
    return Math.min(100, Math.round((indexStatus.processed / indexStatus.totalDiscovered) * 100));
  }, [indexStatus]);

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshRoots(), refreshStats(), refreshSettings(), refreshIndexStatus()]);
  }

  async function refreshRoots(): Promise<void> {
    setRoots(await fabricApi.listScanRoots());
  }

  async function refreshStats(): Promise<void> {
    setStats(await fabricApi.getLibraryStats());
  }

  async function refreshSettings(): Promise<void> {
    setSettings(await fabricApi.getSettings());
  }

  async function refreshIndexStatus(): Promise<void> {
    setIndexStatus(await fabricApi.getIndexStatus());
  }

  async function pickImageAndSearch(): Promise<void> {
    const filePath = await fabricApi.pickImage();
    if (!filePath) return;
    setQueryImage(filePath);
    await runSearch(filePath);
  }

  async function runSearch(imagePath = queryImage): Promise<void> {
    if (!imagePath) return;
    setBusySearch(true);
    setError("");
    try {
      const response = await fabricApi.searchByImage({
        imagePath,
        limit: 24,
        useOnlineEnhancement: settings?.onlineEnhancementEnabled ?? false
      });
      setSearchResponse(response);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setBusySearch(false);
    }
  }

  async function addRoots(): Promise<void> {
    const picked = await fabricApi.pickRoots();
    if (picked.length === 0) return;
    await fabricApi.addScanRoots(picked);
    await refreshRoots();
    setView("library");
  }

  async function startIndex(rebuild = false, selectedRoots?: PickedRoot[]): Promise<void> {
    setError("");
    try {
      setIndexStatus(await fabricApi.startIndex({ roots: selectedRoots, rebuild }));
      setView("library");
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : String(indexError));
    }
  }

  async function updateSettings(patch: Partial<AppSettings> & { openAiApiKey?: string }): Promise<void> {
    setSettings(await fabricApi.updateSettings(patch));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (!file?.path) return;
    setQueryImage(file.path);
    void runSearch(file.path);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>Fabric Finder</strong>
            <span>Offline library</span>
          </div>
        </div>

        <nav className="nav">
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
            <Search size={18} /> Search
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            <Database size={18} /> Library
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={18} /> Settings
          </button>
        </nav>

        <div className="sidebar-stats">
          <Metric label="Designs" value={formatNumber(stats?.totalDesigns ?? 0)} />
          <Metric label="Roots" value={formatNumber(stats?.totalRoots ?? 0)} />
          <Metric label="AI vectors" value={formatNumber(stats?.totalAiEmbeddings ?? 0)} />
        </div>

        <div className={`model-chip ${stats?.modelStatus.mode ?? "fallback"}`}>
          <Sparkles size={16} />
          <span>{stats?.modelStatus.mode === "onnx" ? "OpenCLIP ONNX" : "Local fallback"}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{view === "search" ? "Design Search" : view === "library" ? "Image Library" : "Settings"}</h1>
            <span className="subtle">{statusLine(indexStatus)}</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={addRoots} title="Add folder or drive">
              <FolderOpen size={18} />
            </button>
            <button className="primary" onClick={() => void pickImageAndSearch()}>
              <ImagePlus size={18} /> Choose Image
            </button>
          </div>
        </header>

        {error ? (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError("")} title="Dismiss">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {view === "search" ? (
          <SearchView
            queryImage={queryImage}
            busySearch={busySearch}
            response={searchResponse}
            selectedResult={selectedResult}
            onDrop={handleDrop}
            onPick={pickImageAndSearch}
            onSearch={() => void runSearch()}
            onSelectResult={setSelectedResult}
          />
        ) : null}

        {view === "library" ? (
          <LibraryView
            roots={roots}
            status={indexStatus}
            progress={progress}
            onAddRoots={addRoots}
            onStart={() => void startIndex(false)}
            onRebuild={() => void startIndex(true)}
            onPause={() => void fabricApi.pauseIndex().then(setIndexStatus)}
            onResume={() => void fabricApi.resumeIndex().then(setIndexStatus)}
            onCancel={() => void fabricApi.cancelIndex().then(setIndexStatus)}
          />
        ) : null}

        {view === "settings" && settings && stats ? (
          <SettingsView settings={settings} stats={stats} onUpdate={updateSettings} />
        ) : null}
      </main>
    </div>
  );
}

function SearchView(props: {
  queryImage: string;
  busySearch: boolean;
  response: SearchResponse | null;
  selectedResult: SearchResult | null;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onPick: () => Promise<void>;
  onSearch: () => void;
  onSelectResult: (result: SearchResult) => void;
}): JSX.Element {
  return (
    <section className="search-layout">
      <div className="query-panel">
        <div
          className="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={props.onDrop}
          role="button"
          tabIndex={0}
        >
          {props.queryImage ? (
            <LocalImage filePath={props.queryImage} alt="Query fabric" />
          ) : (
            <div className="empty-query">
              <Upload size={42} />
              <strong>Query image</strong>
            </div>
          )}
        </div>
        <div className="query-actions">
          <button onClick={() => void props.onPick()}>
            <ImagePlus size={18} /> Choose
          </button>
          <button className="primary" disabled={!props.queryImage || props.busySearch} onClick={props.onSearch}>
            {props.busySearch ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
            Search
          </button>
        </div>

        {props.selectedResult ? <ResultDetail result={props.selectedResult} /> : null}
      </div>

      <div className="results-panel">
        <div className="section-heading">
          <h2>Matches</h2>
          <span>{props.response ? `${props.response.results.length} results in ${props.response.elapsedMs} ms` : ""}</span>
        </div>
        <div className="results-grid">
          {(props.response?.results ?? []).map((result) => (
            <button
              key={result.design.id}
              className={`result-card ${props.selectedResult?.design.id === result.design.id ? "selected" : ""}`}
              onClick={() => props.onSelectResult(result)}
            >
              <LocalImage filePath={result.design.thumbnailPath || result.design.filePath} alt="" />
              <div className="result-info">
                <strong>{result.design.designNumber}</strong>
                <span>{result.design.designName}</span>
                <small>{Math.round(result.score * 100)}% match</small>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultDetail({ result }: { result: SearchResult }): JSX.Element {
  return (
    <div className="detail-panel">
      <div className="section-heading">
        <h2>Top Match</h2>
        <span>{Math.round(result.score * 100)}%</span>
      </div>
      <LocalImage className="detail-image" filePath={result.design.thumbnailPath || result.design.filePath} alt="" />
      <dl className="detail-list">
        <dt>Design number</dt>
        <dd>{result.design.designNumber}</dd>
        <dt>Design name</dt>
        <dd>{result.design.designName}</dd>
        <dt>Variant</dt>
        <dd>{result.design.variant}</dd>
        <dt>Fast score</dt>
        <dd>{Math.round(result.fastScore * 100)}%</dd>
        <dt>AI score</dt>
        <dd>{result.aiScore === undefined ? "Pending" : `${Math.round(result.aiScore * 100)}%`}</dd>
      </dl>
      {result.tags?.length ? (
        <div className="tags">{result.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      ) : null}
      {result.explanation ? <p className="explanation">{result.explanation}</p> : null}
      <div className="detail-actions">
        <button onClick={() => void fabricApi.openFile(result.design.id)}>
          <FolderOpen size={18} /> Open File
        </button>
        <button onClick={() => void fabricApi.openFolder(result.design.id)}>
          <FolderOpen size={18} /> Open Folder
        </button>
      </div>
    </div>
  );
}

function LibraryView(props: {
  roots: ScanRoot[];
  status: IndexJobStatus;
  progress: number;
  onAddRoots: () => Promise<void>;
  onStart: () => void;
  onRebuild: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}): JSX.Element {
  const running = props.status.state === "running";
  const paused = props.status.state === "paused";

  return (
    <section className="library-layout">
      <div className="index-controls">
        <button onClick={() => void props.onAddRoots()}>
          <FolderOpen size={18} /> Add Folder/Drive
        </button>
        <button className="primary" onClick={props.onStart} disabled={running}>
          <Play size={18} /> Start
        </button>
        <button onClick={props.onRebuild} disabled={running}>
          <RefreshCw size={18} /> Rebuild
        </button>
        <button onClick={paused ? props.onResume : props.onPause} disabled={!running && !paused}>
          {paused ? <Play size={18} /> : <Pause size={18} />} {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={props.onCancel} disabled={!running && !paused}>
          <Square size={18} /> Stop
        </button>
      </div>

      <div className="progress-band">
        <div>
          <strong>{props.status.state.toUpperCase()}</strong>
          <span>{props.status.currentFile ?? props.status.message ?? ""}</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${props.progress}%` }} />
        </div>
        <div className="job-metrics">
          <Metric label="Found" value={formatNumber(props.status.totalDiscovered)} />
          <Metric label="Indexed" value={formatNumber(props.status.indexed)} />
          <Metric label="Skipped" value={formatNumber(props.status.skipped)} />
          <Metric label="Failed" value={formatNumber(props.status.failed)} />
        </div>
      </div>

      <div className="roots-table">
        <div className="table-header">
          <span>Root</span>
          <span>Type</span>
          <span>Last scanned</span>
        </div>
        {props.roots.map((root) => (
          <div className="table-row" key={root.id}>
            <span title={root.rootPath}>{root.rootPath}</span>
            <span>{root.kind}</span>
            <span>{root.lastScannedAt ? new Date(root.lastScannedAt).toLocaleString() : ""}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView(props: {
  settings: AppSettings;
  stats: LibraryStats;
  onUpdate: (patch: Partial<AppSettings> & { openAiApiKey?: string }) => Promise<void>;
}): JSX.Element {
  const [apiKey, setApiKey] = useState("");

  return (
    <section className="settings-layout">
      <div className="settings-row">
        <div>
          <h2>Similarity Threshold</h2>
          <span>{Math.round(props.settings.similarityThreshold * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.4"
          max="0.95"
          step="0.01"
          value={props.settings.similarityThreshold}
          onChange={(event) => void props.onUpdate({ similarityThreshold: Number(event.currentTarget.value) })}
        />
      </div>

      <div className="settings-row">
        <div>
          <h2>Online Enhancement</h2>
          <span>{props.settings.openAiApiKeyConfigured ? "API key saved" : "No API key"}</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={props.settings.onlineEnhancementEnabled}
            onChange={(event) => void props.onUpdate({ onlineEnhancementEnabled: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>

      <div className="api-key-row">
        <input
          type="password"
          value={apiKey}
          placeholder="OpenAI API key"
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
        <button onClick={() => void props.onUpdate({ openAiApiKey: apiKey }).then(() => setApiKey(""))}>Save</button>
      </div>

      <div className="settings-row">
        <div>
          <h2>Model</h2>
          <span>{props.stats.modelStatus.message}</span>
        </div>
        <span className="model-pill">{props.stats.modelStatus.modelVersion}</span>
      </div>

      <div className="settings-row">
        <div>
          <h2>Index Location</h2>
          <span>{props.settings.indexLocation}</span>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LocalImage({ filePath, alt, className }: { filePath: string; alt: string; className?: string }): JSX.Element {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSrc("");

    void fabricApi
      .getImageDataUrl(filePath)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl ?? fabricApi.toFileUrl(filePath));
      })
      .catch(() => {
        if (!cancelled) setSrc(fabricApi.toFileUrl(filePath));
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (!src) {
    return (
      <div className={`image-loading ${className ?? ""}`}>
        <Loader2 className="spin" size={22} />
      </div>
    );
  }

  return <img className={className} src={src} alt={alt} />;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function statusLine(status: IndexJobStatus): string {
  if (status.state === "running") return `Indexing ${status.processed}/${status.totalDiscovered}`;
  if (status.state === "paused") return "Indexing paused";
  if (status.state === "completed") return "Index ready";
  if (status.state === "failed") return status.message ?? "Index failed";
  return "Ready";
}
