import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
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
  DesignRecord,
  IndexFailureList,
  IndexJobStatus,
  LibraryStats,
  PickedRoot,
  ScanRoot,
  SearchResponse,
  SearchResult
} from "../../shared/types";
import { fabricApi } from "./fabricApi";
import "./styles/app.css";

type View = "search" | "library" | "designs" | "settings";

const DESIGN_PAGE_SIZE = 100;

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
          <Metric
            label="Designs"
            value={formatNumber(stats?.totalDesigns ?? 0)}
            active={view === "designs"}
            title="View designs"
            onClick={() => setView("designs")}
          />
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
            <h1>{viewTitle(view)}</h1>
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

        {view === "designs" ? <DesignsView /> : null}

        {view === "settings" && settings && stats ? (
          <SettingsView settings={settings} stats={stats} onUpdate={updateSettings} />
        ) : null}
      </main>
    </div>
  );
}

function DesignsView(): JSX.Element {
  const [search, setSearch] = useState("");
  const [designs, setDesigns] = useState<DesignRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState("");
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const version = requestVersionRef.current + 1;
    requestVersionRef.current = version;
    const timer = window.setTimeout(() => {
      void loadDesignPage(search, 0, "replace", version);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [search]);

  async function loadDesignPage(
    query: string,
    offset: number,
    mode: "replace" | "append",
    version = requestVersionRef.current
  ): Promise<void> {
    if (mode === "replace") setLoading(true);
    else setLoadingMore(true);
    setListError("");

    try {
      const response = await fabricApi.listDesigns({
        search: query,
        offset,
        limit: DESIGN_PAGE_SIZE
      });
      if (version !== requestVersionRef.current) return;

      setDesigns((current) => (mode === "replace" ? response.designs : [...current, ...response.designs]));
      setTotal(response.total);
      setHasMore(response.hasMore);
    } catch (loadError) {
      if (version === requestVersionRef.current) {
        setListError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (version === requestVersionRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 280;
    if (!nearBottom || loading || loadingMore || !hasMore) return;
    void loadDesignPage(search, designs.length, "append");
  }

  return (
    <section className="designs-layout">
      <div className="designs-toolbar">
        <label className="design-search">
          <Search size={18} />
          <input
            value={search}
            placeholder="Search file name, design number, or design name"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <span>
          {loading ? "Loading" : `${formatNumber(designs.length)} of ${formatNumber(total)} designs`}
        </span>
      </div>

      {listError ? <div className="error-banner">{listError}</div> : null}

      <div className="designs-scroller" onScroll={handleScroll}>
        {loading && designs.length === 0 ? (
          <div className="designs-empty">
            <Loader2 className="spin" size={22} />
          </div>
        ) : designs.length ? (
          <div className="designs-grid">
            {designs.map((design) => (
              <DesignCard design={design} key={design.id} />
            ))}
          </div>
        ) : (
          <div className="designs-empty">No designs found.</div>
        )}

        {loadingMore ? (
          <div className="designs-load-more">
            <Loader2 className="spin" size={18} />
            <span>Loading more</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DesignCard({ design }: { design: DesignRecord }): JSX.Element {
  const fileName = design.filePath.split(/[\\/]/).pop() || design.filePath;

  return (
    <article className="design-card">
      <LocalImage filePath={design.thumbnailPath || design.filePath} alt="" />
      <div className="design-card-body">
        <strong title={design.designNumber}>{design.designNumber}</strong>
        <span title={design.designName}>{design.designName}</span>
        <small title={design.filePath}>{fileName}</small>
      </div>
      <div className="design-card-actions">
        <button onClick={() => void fabricApi.openFile(design.id)}>
          <ImagePlus size={16} /> Open
        </button>
        <button onClick={() => void fabricApi.openFolder(design.id)}>
          <FolderOpen size={16} /> Folder
        </button>
      </div>
    </article>
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
  const [failuresExpanded, setFailuresExpanded] = useState(false);
  const [failureList, setFailureList] = useState<IndexFailureList | null>(null);
  const [loadingFailures, setLoadingFailures] = useState(false);

  useEffect(() => {
    if (props.status.failed === 0) {
      setFailuresExpanded(false);
      setFailureList(null);
    }
  }, [props.status.id, props.status.failed]);

  useEffect(() => {
    if (!failuresExpanded || props.status.failed === 0) return;

    let cancelled = false;
    setLoadingFailures(true);
    void fabricApi
      .listIndexFailures(props.status.id || undefined)
      .then((list) => {
        if (!cancelled) setFailureList(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingFailures(false);
      });

    return () => {
      cancelled = true;
    };
  }, [failuresExpanded, props.status.id, props.status.failed, props.status.processed]);

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
          <Metric
            label="Failed"
            value={formatNumber(props.status.failed)}
            active={failuresExpanded}
            title={props.status.failed > 0 ? "Show failed files" : undefined}
            onClick={
              props.status.failed > 0 ? () => setFailuresExpanded((current) => !current) : undefined
            }
          />
        </div>

        {props.status.failed > 0 && failuresExpanded ? (
          <div className="failure-details">
            <div className="failure-details-header">
              <div>
                <AlertTriangle size={17} />
                <strong>Failed Files</strong>
                <span>
                  {loadingFailures
                    ? "Loading"
                    : failureList
                      ? `Showing ${failureList.failures.length} of ${failureList.total}`
                      : ""}
                </span>
              </div>
              <button
                className="icon-button"
                onClick={() => void fabricApi.listIndexFailures(props.status.id || undefined).then(setFailureList)}
                title="Refresh failed files"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            {loadingFailures ? (
              <div className="failure-empty">
                <Loader2 className="spin" size={18} />
                <span>Loading failed files</span>
              </div>
            ) : failureList?.failures.length ? (
              <div className="failure-table">
                <div className="failure-row failure-row-header">
                  <span>File</span>
                  <span>Reason</span>
                  <span>Step</span>
                  <span>Time</span>
                </div>
                {failureList.failures.map((failure) => (
                  <div className="failure-row" key={failure.id}>
                    <span title={formatFailureTooltip(failure)}>{failure.filePath}</span>
                    <span title={failure.reason}>{failure.reason}</span>
                    <span>{failure.phase}</span>
                    <span>{formatDateTime(failure.failedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="failure-empty">No failure details are stored for this job.</div>
            )}
          </div>
        ) : null}
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

function Metric({
  label,
  value,
  active = false,
  title,
  onClick
}: {
  label: string;
  value: string;
  active?: boolean;
  title?: string;
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {onClick ? <ChevronDown className="metric-chevron" size={16} /> : null}
    </>
  );

  if (onClick) {
    return (
      <button className={`metric metric-action ${active ? "active" : ""}`} onClick={onClick} title={title}>
        {content}
      </button>
    );
  }

  return <div className="metric">{content}</div>;
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

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString();
}

function formatFailureTooltip(failure: IndexFailureList["failures"][number]): string {
  return `${failure.filePath}\n\nReason: ${failure.reason}\nStep: ${failure.phase}`;
}

function viewTitle(view: View): string {
  if (view === "search") return "Design Search";
  if (view === "library") return "Image Library";
  if (view === "designs") return "Designs";
  return "Settings";
}

function statusLine(status: IndexJobStatus): string {
  if (status.state === "running") return `Indexing ${status.processed}/${status.totalDiscovered}`;
  if (status.state === "paused") return "Indexing paused";
  if (status.state === "completed") return "Index ready";
  if (status.state === "failed") return status.message ?? "Index failed";
  return "Ready";
}
