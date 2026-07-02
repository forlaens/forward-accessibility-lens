import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowLeftRight, Captions, ClipboardCopy, Compass, ExternalLink, Eye, Heading, Image as ImageIcon, Keyboard, ListTree, Mail, MessageSquare, Pipette, Settings, Star, Table2, Tag } from "lucide-react";
import type { AccessibilityAnalysis, AriaLabelItem, GraphicItem, HeadingItem, InteractiveItem, LandmarkItem, LandmarkStructureItem, LinearSemanticItem, LiveRegionItem, ScanProgress, TableItem } from "../shared/types";
import {
  DEFAULT_LIVE_REGION_CAPTION_SETTINGS,
  normalizeLiveRegionCaptionSettings
} from "../shared/live-region-caption-settings.js";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  SUPPORTED_LANGUAGES,
  formatCount,
  formatList,
  getItemWord,
  getLanguageOptions,
  getNavigatorLanguages,
  normalizeLanguagePreference,
  resolvePluginLanguage,
  t
} from "../shared/i18n.js";
import "./styles.css";

declare global {
  interface Window {
    EyeDropper?: new () => {
      open: () => Promise<{ sRGBHex: string }>;
    };
  }
}

type Tool = "headings" | "landmarks" | "graphics" | "tables" | "contrast" | "textResize" | "ariaLabels" | "liveRegions" | "linearView" | "interactive";
type View = "tools" | "settings" | "feedback";
type PageStructureOverlay = {
  headings: boolean;
  landmarks: boolean;
  graphics: boolean;
  ariaLabels: boolean;
  interactive: boolean;
  tables: boolean;
};
type PageContext = {
  tabId: number | null;
  url: string;
};
type ScanState = "idle" | "scanning" | "ready" | "unavailable";
type LiveRegionCaptionSettings = typeof DEFAULT_LIVE_REGION_CAPTION_SETTINGS;
type HighlightLabelPlacement = "inside" | "above" | "below" | "left" | "right";
type HighlightSettings = {
  dashedBorders: boolean;
  labelPlacement: HighlightLabelPlacement;
};
type ScanSettings = {
  includeIframes: boolean;
  includeShadowDom: boolean;
};
type PanelLanguagePreference = string;
type PanelLanguage = string;
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type ResultsPerPage = 5 | 10 | 15 | 20 | 25 | 50 | 75 | 100 | 150 | 200;
type ThumbnailSize = "small" | "medium" | "large";
type GraphicFilterKey = "named" | "decorative" | "unnamed";
type GraphicFilters = Record<GraphicFilterKey, boolean>;
type PaginatedListKey = "headings" | "landmarks" | "liveRegions" | "graphics" | "ariaLabels" | "tables";
type PaginatedListPageIndexes = Partial<Record<PaginatedListKey, number>>;
type ContrastColorTarget = "text" | "background";
type TextResizeSimulation = {
  enabled: boolean;
  scale: number;
};
type InteractiveNavigatorState = {
  enabled: boolean;
  index: number;
  count: number;
  currentHidden: boolean;
  currentLabel: string;
};

const PANEL_PREFERENCES_KEY = "panelPreferences";
const TOOL_ORDER: Tool[] = ["headings", "landmarks", "graphics", "tables", "contrast", "textResize", "liveRegions", "ariaLabels", "linearView", "interactive"];
const TOOLS = new Set<Tool>(TOOL_ORDER);
const DEFAULT_GRAPHIC_FILTERS: GraphicFilters = {
  named: true,
  decorative: true,
  unnamed: true
};
const DEFAULT_HIGHLIGHT_SETTINGS: HighlightSettings = {
  dashedBorders: false,
  labelPlacement: "inside"
};
const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  includeIframes: true,
  includeShadowDom: true
};
const EMPTY_PAGE_STRUCTURE_OVERLAY: PageStructureOverlay = {
  headings: false,
  landmarks: false,
  graphics: false,
  ariaLabels: false,
  interactive: false,
  tables: false
};
const DEFAULT_PANEL_LANGUAGE: PanelLanguagePreference = DEFAULT_LANGUAGE_PREFERENCE;
const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";
const DEFAULT_RESULTS_PER_PAGE: ResultsPerPage = 25;
const RESULTS_PER_PAGE_OPTIONS: ResultsPerPage[] = [5, 10, 15, 20, 25, 50, 75, 100, 150, 200];
const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize = "small";
const THUMBNAIL_SIZE_OPTIONS: ThumbnailSize[] = ["small", "medium", "large"];
const DEFAULT_CONTRAST_TEXT_COLOR = "#111827";
const DEFAULT_CONTRAST_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_TEXT_RESIZE_SIMULATION: TextResizeSimulation = {
  enabled: false,
  scale: 200
};
const TEXT_RESIZE_MIN_SCALE = 100;
const TEXT_RESIZE_MAX_SCALE = 400;
const TEXT_RESIZE_STEP = 25;
const TEXT_RESIZE_PRESETS = [100, 200, 300, 400];
const STATUS_KEYS = [
  "status.live",
  "status.scanning",
  "status.refresh",
  "status.noActivePage",
  "status.openPage",
  "status.cannotInspect"
] as const;

const emptyAnalysis: AccessibilityAnalysis = {
  headings: [],
  landmarks: [],
  tables: [],
  updatedAt: new Date().toISOString()
};

export function App() {
  const [activeView, setActiveView] = useState<View>("tools");
  const [activeTool, setActiveTool] = useState<Tool>("headings");
  const [analysis, setAnalysis] = useState<AccessibilityAnalysis>(emptyAnalysis);
  const analysisRef = useRef<AccessibilityAnalysis>(emptyAnalysis);
  const [liveRegions, setLiveRegions] = useState<LiveRegionItem[]>([]);
  const [status, setStatus] = useState("");
  const [revealAnnouncement, setRevealAnnouncement] = useState("");
  const [languagePreference, setLanguagePreference] = useState<PanelLanguagePreference>(DEFAULT_PANEL_LANGUAGE);
  const [themePreference, setThemePreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [resultsPerPage, setResultsPerPage] = useState<ResultsPerPage>(DEFAULT_RESULTS_PER_PAGE);
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>(DEFAULT_THUMBNAIL_SIZE);
  const [contrastTextColor, setContrastTextColor] = useState(DEFAULT_CONTRAST_TEXT_COLOR);
  const [contrastBackgroundColor, setContrastBackgroundColor] = useState(DEFAULT_CONTRAST_BACKGROUND_COLOR);
  const [contrastPickerStatus, setContrastPickerStatus] = useState("");
  const [textResizeSimulation, setTextResizeSimulationState] = useState<TextResizeSimulation>(DEFAULT_TEXT_RESIZE_SIMULATION);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [liveRegionCaptionsEnabled, setLiveRegionCaptionsEnabled] = useState(false);
  const [semanticLinearViewEnabled, setSemanticLinearViewEnabled] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [interactiveNavigator, setInteractiveNavigator] = useState<InteractiveNavigatorState>({
    enabled: false,
    index: 0,
    count: 0,
    currentHidden: false,
    currentLabel: ""
  });
  const [pageStructureOverlay, setPageStructureOverlayState] = useState<PageStructureOverlay>(EMPTY_PAGE_STRUCTURE_OVERLAY);
  const [liveRegionCaptionSettings, setLiveRegionCaptionSettings] = useState<LiveRegionCaptionSettings>(
    DEFAULT_LIVE_REGION_CAPTION_SETTINGS
  );
  const [highlightSettings, setHighlightSettings] = useState<HighlightSettings>(DEFAULT_HIGHLIGHT_SETTINGS);
  const [scanSettings, setScanSettings] = useState<ScanSettings>(DEFAULT_SCAN_SETTINGS);
  const [pageContext, setPageContext] = useState<PageContext>({ tabId: null, url: "" });
  const [listPageIndexesByPage, setListPageIndexesByPage] = useState<Record<string, PaginatedListPageIndexes>>({});
  const pageContextRef = useRef(pageContext);
  const scanStateRef = useRef(scanState);
  const scanProgressRef = useRef<ScanProgress | null>(scanProgress);
  const hasAcceptedAnalysisRef = useRef(false);
  const pendingInteractiveMoveRef = useRef<"previous" | "next" | null>(null);

  useEffect(() => {
    pageContextRef.current = pageContext;
  }, [pageContext]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    scanStateRef.current = scanState;
  }, [scanState]);

  useEffect(() => {
    scanProgressRef.current = scanProgress;
  }, [scanProgress]);

  useEffect(() => {
    globalThis.chrome?.storage?.local
      ?.get(PANEL_PREFERENCES_KEY)
      .then((stored: { [PANEL_PREFERENCES_KEY]?: { activeTool?: unknown; language?: unknown; theme?: unknown; resultsPerPage?: unknown; thumbnailSize?: unknown } }) => {
        const preferences = stored[PANEL_PREFERENCES_KEY];
        const storedTool = preferences?.activeTool;

        if (isTool(storedTool)) {
          setActiveTool(storedTool);
        }

        setLanguagePreference(normalizeLanguagePreference(preferences?.language));
        setThemePreference(normalizeThemePreference(preferences?.theme));
        setResultsPerPage(normalizeResultsPerPage(preferences?.resultsPerPage));
        setThumbnailSize(normalizeThumbnailSize(preferences?.thumbnailSize));
      })
      .catch(() => {});
  }, []);

  const resolvedLanguage = useMemo(() => resolvePluginLanguage(languagePreference, getNavigatorLanguages()), [languagePreference]);
  const resolvedTheme = themePreference === "system" ? systemTheme : themePreference;
  const languageOptions = useMemo(() => getLanguageOptions(), []);
  const feedbackEmailHref = useMemo(
    () => getFeedbackEmailHref(resolvedLanguage, resolvedTheme, pageContext.url),
    [pageContext.url, resolvedLanguage, resolvedTheme]
  );

  function setScanStatus(nextState: ScanState, nextStatus: string) {
    scanStateRef.current = nextState;
    setScanState(nextState);
    setStatus(nextStatus);
  }

  function setScanProgressState(nextProgress: ScanProgress | null) {
    scanProgressRef.current = nextProgress;
    setScanProgress(nextProgress);
  }

  function finishScanStatus(nextProgress: ScanProgress) {
    if (nextProgress.problems.length > 0) {
      setScanStatus("ready", getScanProgressProblemSummary(nextProgress, resolvedLanguage));
      return;
    }

    setScanProgressState(null);
    setScanStatus("ready", t(resolvedLanguage, "status.live"));
  }

  useEffect(() => {
    if (!status) {
      setStatus(t(resolvedLanguage, "status.waiting"));
    }

    globalThis.chrome?.runtime?.sendMessage({
      type: "A11Y_TOOLS_UPDATE_LANGUAGE",
      language: resolvedLanguage
    }).catch(() => {});
  }, [resolvedLanguage, status]);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

    if (!media) {
      return;
    }

    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");

    updateSystemTheme();
    media.addEventListener?.("change", updateSystemTheme);
    return () => media.removeEventListener?.("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    if (!pendingInteractiveMoveRef.current || !interactiveNavigator.enabled) {
      return;
    }

    announceReveal(getInteractiveNavigatorMoveAnnouncement(interactiveNavigator, resolvedLanguage));
    pendingInteractiveMoveRef.current = null;
  }, [interactiveNavigator, resolvedLanguage]);

  useEffect(() => {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime?.onMessage) {
      setScanStatus("ready", t(resolvedLanguage, "status.preview"));
      return;
    }

    const listener = (message: {
      type?: string;
      tabId?: number | null;
      url?: string;
      status?: string;
      enabled?: boolean;
      liveRegionCaptionsEnabled?: boolean;
      semanticLinearViewEnabled?: boolean;
      textResizeSimulation?: Partial<TextResizeSimulation>;
      interactiveNavigator?: typeof interactiveNavigator;
      state?: Partial<InteractiveNavigatorState>;
      pageStructureOverlay?: PageStructureOverlay;
      liveRegionCaptionSettings?: LiveRegionCaptionSettings;
      settings?: Partial<LiveRegionCaptionSettings>;
      highlightSettings?: HighlightSettings;
      scanSettings?: ScanSettings;
      devtoolsOpen?: boolean;
      open?: boolean;
      liveRegions?: LiveRegionItem[];
      analysis?: AccessibilityAnalysis;
      progress?: ScanProgress;
      scanId?: number | null;
    }) => {
      if (message.type === "A11Y_TOOLS_ACTIVE_TAB" && typeof message.tabId === "number") {
        const nextContext = { tabId: message.tabId, url: message.url ?? "" };
        const currentContext = pageContextRef.current;

        if (
          currentContext.tabId !== nextContext.tabId ||
          currentContext.url !== nextContext.url
        ) {
          const resetAnalysis = {
            ...emptyAnalysis,
            updatedAt: new Date().toISOString()
          };
          pageContextRef.current = nextContext;
          setPageContext(nextContext);
          analysisRef.current = resetAnalysis;
          hasAcceptedAnalysisRef.current = false;
          setAnalysis(resetAnalysis);
          setLiveRegions([]);
          setScanProgressState(null);
          setDevtoolsOpen(false);
        }

        setLiveRegionCaptionsEnabled(Boolean(message.liveRegionCaptionsEnabled));
        setSemanticLinearViewEnabled(Boolean(message.semanticLinearViewEnabled));
        setTextResizeSimulationState(normalizeTextResizeSimulation(message.textResizeSimulation));
        setInteractiveNavigator(normalizeInteractiveNavigator(message.interactiveNavigator));
        setDevtoolsOpen(Boolean(message.devtoolsOpen));
        if (message.pageStructureOverlay) {
          setPageStructureOverlayState(normalizePageStructureOverlay(message.pageStructureOverlay));
        } else {
          setPageStructureOverlayState(EMPTY_PAGE_STRUCTURE_OVERLAY);
        }
        if (message.liveRegionCaptionSettings) {
          setLiveRegionCaptionSettings(normalizeLiveRegionCaptionSettings(message.liveRegionCaptionSettings));
        }
        if (message.scanSettings) {
          setScanSettings(normalizeScanSettings(message.scanSettings));
        }
        if (scanStateRef.current !== "ready" || currentContext.tabId !== nextContext.tabId || currentContext.url !== nextContext.url) {
          setScanStatus("scanning", localizeStatus(message.status ?? "Scanning page", resolvedLanguage));
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_LIVE_REGION_CAPTIONS_STATE") {
        if (matchesCurrentPage(message.tabId, message.url) && typeof message.enabled === "boolean") {
          setLiveRegionCaptionsEnabled(message.enabled);
          if (message.liveRegionCaptionSettings) {
            setLiveRegionCaptionSettings(normalizeLiveRegionCaptionSettings(message.liveRegionCaptionSettings));
          }
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_PAGE_STRUCTURE_OVERLAY_STATE") {
        if (matchesCurrentPage(message.tabId, message.url) && message.pageStructureOverlay) {
          setPageStructureOverlayState(normalizePageStructureOverlay(message.pageStructureOverlay));
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_SEMANTIC_LINEAR_VIEW_STATE") {
        if (matchesCurrentPage(message.tabId, message.url) && typeof message.enabled === "boolean") {
          setSemanticLinearViewEnabled(message.enabled);
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_TEXT_RESIZE_SIMULATION_STATE") {
        if (matchesCurrentPage(message.tabId, message.url) && message.textResizeSimulation) {
          setTextResizeSimulationState(normalizeTextResizeSimulation(message.textResizeSimulation));
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_INTERACTIVE_NAVIGATOR_STATE") {
        if (matchesCurrentPage(message.tabId, message.url) && message.state) {
          setInteractiveNavigator(normalizeInteractiveNavigator(message.state));
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_LIVE_REGION_CAPTION_SETTINGS" && message.settings) {
        setLiveRegionCaptionSettings(normalizeLiveRegionCaptionSettings(message.settings));
        return;
      }

      if (message.type === "A11Y_TOOLS_HIGHLIGHT_SETTINGS" && message.highlightSettings) {
        setHighlightSettings(normalizeHighlightSettings(message.highlightSettings));
        return;
      }

      if (message.type === "A11Y_TOOLS_SCAN_SETTINGS" && message.scanSettings) {
        setScanSettings(normalizeScanSettings(message.scanSettings));
        return;
      }

      if (message.type === "A11Y_TOOLS_SCAN_PROGRESS" && message.progress) {
        if (matchesCurrentPage(message.tabId, message.url)) {
          acceptScanProgress(message.tabId, message.url, message.progress);
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_LIVE_REGIONS_UPDATE" && message.liveRegions) {
        if (matchesCurrentPage(message.tabId, message.url)) {
          setLiveRegions(message.liveRegions);
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_DEVTOOLS_STATE") {
        if (matchesCurrentPage(message.tabId, message.url)) {
          setDevtoolsOpen(Boolean(message.open));
        }
        return;
      }

      if (message.type === "A11Y_TOOLS_PANEL_STATUS" && typeof message.status === "string") {
        if (matchesCurrentPage(message.tabId, message.url)) {
          if (scanStateIsReadyWithData()) {
            return;
          }

          setScanStatus("unavailable", message.status);
        }
        return;
      }

      if (message.type !== "A11Y_TOOLS_PANEL_UPDATE" || !message.analysis) {
        return;
      }

      if (!matchesCurrentPage(message.tabId, message.url)) {
        return;
      }

      acceptPanelAnalysis(message.tabId, message.url, message.analysis, message.scanId);
    };

    function matchesCurrentPage(tabId?: number | null, url?: string) {
      const currentContext = pageContextRef.current;

      if (typeof tabId === "number" && currentContext.tabId !== null && currentContext.tabId !== tabId) {
        return false;
      }

      if (url && currentContext.url && currentContext.url !== url) {
        return false;
      }

      return true;
    }

    function acceptPanelAnalysis(tabId: number | null | undefined, url: string | undefined, nextAnalysis: AccessibilityAnalysis, scanId: number | null | undefined) {
      if (typeof tabId === "number" || url) {
        const nextContext = {
          tabId: typeof tabId === "number" ? tabId : pageContextRef.current.tabId,
          url: url ?? pageContextRef.current.url
        };
        pageContextRef.current = nextContext;
        setPageContext(nextContext);
      }

      analysisRef.current = nextAnalysis;
      hasAcceptedAnalysisRef.current = true;
      setAnalysis(nextAnalysis);
      setLiveRegions(nextAnalysis.liveRegions ?? []);

      const currentProgress = scanProgressRef.current;
      if (currentProgress && Number.isInteger(scanId) && currentProgress.scanId === scanId && !isScanProgressFinished(currentProgress)) {
        setScanStatus("ready", getScanProgressTitle(currentProgress, resolvedLanguage));
        return;
      }

      if (currentProgress && isScanProgressFinished(currentProgress)) {
        finishScanStatus(currentProgress);
        return;
      }

      setScanStatus("ready", t(resolvedLanguage, "status.live"));
    }

    function acceptScanProgress(tabId: number | null | undefined, url: string | undefined, nextProgress: ScanProgress) {
      if (typeof tabId === "number" || url) {
        const nextContext = {
          tabId: typeof tabId === "number" ? tabId : pageContextRef.current.tabId,
          url: url ?? pageContextRef.current.url
        };
        pageContextRef.current = nextContext;
        setPageContext(nextContext);
      }

      setScanProgressState(nextProgress);

      if (isScanProgressFinished(nextProgress)) {
        if (!hasAcceptedAnalysisRef.current && nextProgress.totalFrames !== null && nextProgress.failedFrames >= nextProgress.totalFrames) {
          setScanStatus("unavailable", getScanProgressTitle(nextProgress, resolvedLanguage));
          return;
        }

        finishScanStatus(nextProgress);
        return;
      }

      if (hasAcceptedAnalysisRef.current) {
        setScanStatus("ready", getScanProgressTitle(nextProgress, resolvedLanguage));
        return;
      }

      setScanStatus("scanning", getScanProgressTitle(nextProgress, resolvedLanguage));
    }

    function scanStateIsReadyWithData() {
      const currentAnalysis = analysisRef.current;

      return (
        scanStateRef.current === "ready" ||
        currentAnalysis.headings.length > 0 ||
        currentAnalysis.landmarks.length > 0 ||
        (currentAnalysis.liveRegions?.length ?? 0) > 0 ||
        (currentAnalysis.linearItems?.length ?? 0) > 0 ||
        (currentAnalysis.interactiveItems?.length ?? 0) > 0 ||
        (currentAnalysis.graphics?.length ?? 0) > 0 ||
        (currentAnalysis.ariaLabels?.length ?? 0) > 0 ||
        (currentAnalysis.tables?.length ?? 0) > 0
      );
    }

    runtime.onMessage.addListener(listener);
    const panelPort = runtime.connect?.({ name: "a11y-tools-panel" });
    hasAcceptedAnalysisRef.current = false;
    setScanProgressState(null);
    setScanStatus("scanning", t(resolvedLanguage, "status.scanning"));
    runtime.sendMessage({ type: "A11Y_TOOLS_REQUEST_LIVE_REGION_CAPTION_SETTINGS" }).catch(() => {});
    runtime.sendMessage({ type: "A11Y_TOOLS_REQUEST_HIGHLIGHT_SETTINGS" }).catch(() => {});
    runtime.sendMessage({ type: "A11Y_TOOLS_REQUEST_SCAN_SETTINGS" }).catch(() => {});
    runtime.sendMessage({ type: "A11Y_TOOLS_REQUEST_ACTIVE_TAB" }).catch(() => {
      setScanStatus("unavailable", t(resolvedLanguage, "status.refresh"));
    });

    const refreshOnFocus = () => {
      runtime.sendMessage({ type: "A11Y_TOOLS_REQUEST_ACTIVE_TAB" }).catch(() => {});
    };
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      runtime.onMessage.removeListener(listener);
      panelPort?.disconnect?.();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const activeViewTitle = activeView === "tools" ? t(resolvedLanguage, "view.tools") : activeView === "settings" ? t(resolvedLanguage, "view.settings") : t(resolvedLanguage, "view.feedback");
  const revealActionLabel = devtoolsOpen ? t(resolvedLanguage, "common.devtools") : t(resolvedLanguage, "common.show");
  const localizedStatus = getPanelStatusText(status, scanProgress, resolvedLanguage);
  const paginationContextKey = getPaginationContextKey(pageContext);

  function getListPageIndex(listKey: PaginatedListKey) {
    return listPageIndexesByPage[paginationContextKey]?.[listKey] ?? 0;
  }

  function updateListPageIndex(listKey: PaginatedListKey, nextPageIndex: number) {
    const normalizedPageIndex = Number.isFinite(nextPageIndex)
      ? Math.max(0, Math.floor(nextPageIndex))
      : 0;

    setListPageIndexesByPage((current) => {
      const currentPageIndexes = current[paginationContextKey] ?? {};

      if ((currentPageIndexes[listKey] ?? 0) === normalizedPageIndex) {
        return current;
      }

      return {
        ...current,
        [paginationContextKey]: {
          ...currentPageIndexes,
          [listKey]: normalizedPageIndex
        }
      };
    });
  }

  return (
    <main className="app-shell" data-theme={resolvedTheme} data-thumbnail-size={thumbnailSize} lang={resolvedLanguage}>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {revealAnnouncement}
      </div>
      <header className="brand-header">
        <img src="/icons/forward-favicon-inverted.png" alt="" />
        <span className="brand-name">Forward</span>
        <span className="brand-product">{t(resolvedLanguage, "brand.product")}</span>
      </header>

      <div className="panel-surface">
        <header className="app-header">
          <div>
            <h1>{activeViewTitle}</h1>
          </div>
          <div className="header-actions">
            {localizedStatus.toLowerCase() === t(resolvedLanguage, "status.live").toLowerCase() ? null : <p className="status" aria-live="polite" aria-atomic="true">{localizedStatus}</p>}
            {activeView === "tools" ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t(resolvedLanguage, "settings.open")}
                onClick={() => setActiveView("settings")}
              >
                <Settings aria-hidden="true" size={24} />
              </button>
            ) : null}
          </div>
        </header>

        {activeView === "tools" ? (
          <>
          <ToolDropdown
            activeTool={activeTool}
            counts={getToolCounts(analysis, liveRegions)}
            language={resolvedLanguage}
            onChange={selectTool}
          />

          {activeTool === "headings" ? (
            <section className="panel-control" aria-labelledby="heading-overlay-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Eye size={20} />
              </div>
              <div>
                <h2 id="heading-overlay-control-title">{t(resolvedLanguage, "control.heading.title")}</h2>
                <p id="heading-overlay-control-description">{t(resolvedLanguage, "control.heading.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.headings ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={pageStructureOverlay.headings}
                  aria-labelledby="heading-overlay-control-title"
                  aria-describedby="heading-overlay-control-description"
                  onChange={(event) => updatePageStructureOverlay({ headings: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "landmarks" ? (
            <section className="panel-control" aria-labelledby="landmark-overlay-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Compass size={20} />
              </div>
              <div>
                <h2 id="landmark-overlay-control-title">{t(resolvedLanguage, "control.landmark.title")}</h2>
                <p id="landmark-overlay-control-description">{t(resolvedLanguage, "control.landmark.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.landmarks ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={pageStructureOverlay.landmarks}
                  aria-labelledby="landmark-overlay-control-title"
                  aria-describedby="landmark-overlay-control-description"
                  onChange={(event) => updatePageStructureOverlay({ landmarks: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "graphics" ? (
            <section className="panel-control" aria-labelledby="graphics-overlay-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Eye size={20} />
              </div>
              <div>
                <h2 id="graphics-overlay-control-title">{t(resolvedLanguage, "control.graphics.title")}</h2>
                <p id="graphics-overlay-control-description">{t(resolvedLanguage, "control.graphics.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.graphics ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={pageStructureOverlay.graphics}
                  aria-labelledby="graphics-overlay-control-title"
                  aria-describedby="graphics-overlay-control-description"
                  onChange={(event) => updatePageStructureOverlay({ graphics: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "tables" ? (
            <section className="panel-control" aria-labelledby="tables-overlay-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Table2 size={20} />
              </div>
              <div>
                <h2 id="tables-overlay-control-title">{t(resolvedLanguage, "control.tables.title")}</h2>
                <p id="tables-overlay-control-description">{t(resolvedLanguage, "control.tables.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.tables ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={pageStructureOverlay.tables}
                  aria-labelledby="tables-overlay-control-title"
                  aria-describedby="tables-overlay-control-description"
                  onChange={(event) => updatePageStructureOverlay({ tables: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "ariaLabels" ? (
            <section className="panel-control" aria-labelledby="aria-label-overlay-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Eye size={20} />
              </div>
              <div>
                <h2 id="aria-label-overlay-control-title">{t(resolvedLanguage, "control.aria.title")}</h2>
                <p id="aria-label-overlay-control-description">{t(resolvedLanguage, "control.aria.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.ariaLabels ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={pageStructureOverlay.ariaLabels}
                  aria-labelledby="aria-label-overlay-control-title"
                  aria-describedby="aria-label-overlay-control-description"
                  onChange={(event) => updatePageStructureOverlay({ ariaLabels: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "textResize" ? (
            <section className="panel-control" aria-labelledby="text-resize-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <Heading size={20} />
              </div>
              <div>
                <h2 id="text-resize-control-title">{t(resolvedLanguage, "control.textResize.title")}</h2>
                <p id="text-resize-control-description">{t(resolvedLanguage, "control.textResize.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, textResizeSimulation.enabled ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={textResizeSimulation.enabled}
                  aria-labelledby="text-resize-control-title"
                  aria-describedby="text-resize-control-description"
                  onChange={(event) => setTextResizeSimulation({ enabled: event.currentTarget.checked })}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "liveRegions" ? (
            <section className="live-region-control" aria-labelledby="live-region-control-title">
              <div className="live-region-control__icon" aria-hidden="true">
                <Captions size={20} />
              </div>
              <div>
                <h2 id="live-region-control-title">{t(resolvedLanguage, "control.live.title")}</h2>
                <p id="live-region-control-description">{t(resolvedLanguage, "control.live.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, liveRegionCaptionsEnabled ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={liveRegionCaptionsEnabled}
                  aria-labelledby="live-region-control-title"
                  aria-describedby="live-region-control-description"
                  onChange={(event) => setLiveRegionCaptions(event.currentTarget.checked)}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "linearView" ? (
            <section className="panel-control" aria-labelledby="linear-view-control-title">
              <div className="panel-control__icon" aria-hidden="true">
                <ListTree size={20} />
              </div>
              <div>
                <h2 id="linear-view-control-title">{t(resolvedLanguage, "control.linear.title")}</h2>
                <p id="linear-view-control-description">{t(resolvedLanguage, "control.linear.description")}</p>
              </div>
              <label className="switch">
                <span className="switch__text">{t(resolvedLanguage, semanticLinearViewEnabled ? "common.on" : "common.off")}</span>
                <input
                  type="checkbox"
                  checked={semanticLinearViewEnabled}
                  aria-labelledby="linear-view-control-title"
                  aria-describedby="linear-view-control-description"
                  onChange={(event) => setSemanticLinearView(event.currentTarget.checked)}
                />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </label>
            </section>
          ) : null}

          {activeTool === "interactive" ? (
            <>
              <section className="panel-control" aria-labelledby="interactive-browser-control-title">
                <div className="panel-control__icon" aria-hidden="true">
                  <Keyboard size={20} />
                </div>
                <div>
                  <h2 id="interactive-browser-control-title">{t(resolvedLanguage, "control.interactive.browser.title")}</h2>
                  <p id="interactive-browser-control-description">{t(resolvedLanguage, "control.interactive.browser.description")}</p>
                </div>
                <label className="switch">
                  <span className="switch__text">{t(resolvedLanguage, interactiveNavigator.enabled ? "common.on" : "common.off")}</span>
                  <input
                    type="checkbox"
                    checked={interactiveNavigator.enabled}
                    aria-labelledby="interactive-browser-control-title"
                    aria-describedby="interactive-browser-control-description"
                    onChange={(event) => setInteractiveNavigatorEnabled(event.currentTarget.checked)}
                  />
                  <span className="switch__track" aria-hidden="true">
                    <span className="switch__thumb" />
                  </span>
                </label>
              </section>
              <section className="panel-control" aria-labelledby="interactive-highlight-control-title">
                <div className="panel-control__icon" aria-hidden="true">
                  <Eye size={20} />
                </div>
                <div>
                  <h2 id="interactive-highlight-control-title">{t(resolvedLanguage, "control.interactive.highlight.title")}</h2>
                  <p id="interactive-highlight-control-description">{t(resolvedLanguage, "control.interactive.highlight.description")}</p>
                </div>
                <label className="switch">
                  <span className="switch__text">{t(resolvedLanguage, pageStructureOverlay.interactive ? "common.on" : "common.off")}</span>
                  <input
                    type="checkbox"
                    checked={pageStructureOverlay.interactive}
                    aria-labelledby="interactive-highlight-control-title"
                    aria-describedby="interactive-highlight-control-description"
                    onChange={(event) => setInteractiveHighlights(event.currentTarget.checked)}
                  />
                  <span className="switch__track" aria-hidden="true">
                    <span className="switch__thumb" />
                  </span>
                </label>
              </section>
            </>
          ) : null}

          {activeTool === "interactive" && interactiveNavigator.enabled ? (
            <div className="navigator-controls" aria-label={t(resolvedLanguage, "navigator.label")}>
              <button type="button" className="secondary-action" onClick={() => moveInteractiveNavigator("previous")}>
                {t(resolvedLanguage, "common.previous")}
              </button>
              <p>
                {interactiveNavigator.count === 0
                  ? t(resolvedLanguage, "navigator.none")
                  : `${interactiveNavigator.index + 1} / ${interactiveNavigator.count}${interactiveNavigator.currentHidden ? ` - ${t(resolvedLanguage, "navigator.hidden")}` : ""}`}
              </p>
              <button type="button" className="secondary-action" onClick={() => moveInteractiveNavigator("next")}>
                {t(resolvedLanguage, "common.next")}
              </button>
            </div>
          ) : null}

          {scanState === "ready" && scanProgress?.problems.length ? (
            <ScanProblemNotice progress={scanProgress} language={resolvedLanguage} onRevealFrame={revealFrameProblem} />
          ) : null}

          <div
            id="page-structure-content"
          >
            {activeTool === "contrast" ? (
              <ContrastChecker
                textColor={contrastTextColor}
                backgroundColor={contrastBackgroundColor}
                pickerStatus={contrastPickerStatus}
                onTextColorChange={setContrastTextColor}
                onBackgroundColorChange={setContrastBackgroundColor}
                onPickColor={pickContrastColor}
                language={resolvedLanguage}
              />
            ) : activeTool === "textResize" ? (
              <TextResizeTool
                simulation={textResizeSimulation}
                language={resolvedLanguage}
                onScaleChange={(scale) => setTextResizeSimulation({ scale })}
              />
            ) : scanState === "scanning" || scanState === "idle" || (scanState === "unavailable" && scanProgress) ? (
              <ScanStateMessage
                title={scanProgress ? getScanProgressTitle(scanProgress, resolvedLanguage) : t(resolvedLanguage, "scan.scanning")}
                progress={scanProgress}
                language={resolvedLanguage}
                onRevealFrame={revealFrameProblem}
              />
            ) : activeTool === "headings" ? (
              <HeadingList
                headings={analysis.headings}
                onReveal={revealElement}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("headings")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("headings", pageIndex)}
              />
            ) : activeTool === "landmarks" ? (
              <LandmarkList
                landmarks={analysis.landmarks}
                structure={analysis.landmarkStructure}
                onReveal={revealElement}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("landmarks")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("landmarks", pageIndex)}
              />
            ) : activeTool === "liveRegions" ? (
              <LiveRegionList
                liveRegions={liveRegions}
                onReveal={revealLiveRegion}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("liveRegions")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("liveRegions", pageIndex)}
              />
            ) : activeTool === "graphics" ? (
              <GraphicList
                graphics={analysis.graphics ?? []}
                onReveal={revealElement}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("graphics")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("graphics", pageIndex)}
              />
            ) : activeTool === "tables" ? (
              <TableList
                tables={analysis.tables ?? []}
                onReveal={revealElement}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("tables")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("tables", pageIndex)}
              />
            ) : activeTool === "ariaLabels" ? (
              <AriaLabelList
                labels={analysis.ariaLabels ?? []}
                onReveal={revealElement}
                actionLabel={revealActionLabel}
                language={resolvedLanguage}
                resultsPerPage={resultsPerPage}
                pageIndex={getListPageIndex("ariaLabels")}
                onPageIndexChange={(pageIndex) => updateListPageIndex("ariaLabels", pageIndex)}
              />
            ) : activeTool === "linearView" ? (
              <LinearViewInfo items={analysis.linearItems ?? []} language={resolvedLanguage} />
            ) : activeTool === "interactive" && pageStructureOverlay.interactive ? (
              <InteractiveHighlightInfo items={analysis.interactiveItems ?? []} language={resolvedLanguage} />
            ) : (
              <InteractiveBrowserInfo items={analysis.interactiveItems ?? []} language={resolvedLanguage} />
            )}
          </div>
          </>
        ) : activeView === "settings" ? (
          <section
            id="settings-content"
            className="settings-panel"
            aria-label={t(resolvedLanguage, "view.settings")}
          >
            <button type="button" className="secondary-action settings-back" onClick={() => setActiveView("tools")}>
              <ArrowLeft aria-hidden="true" size={18} />
              {t(resolvedLanguage, "settings.back")}
            </button>

            <section className="settings-group" aria-labelledby="language-settings-title">
              <h2 id="language-settings-title">{t(resolvedLanguage, "settings.language")}</h2>
              <div className="settings-grid">
                <label className="field">
                  <span>{t(resolvedLanguage, "settings.pluginLanguage")}</span>
                  <select
                    value={languagePreference}
                    onChange={(event) => updateLanguagePreference(event.currentTarget.value)}
                  >
                    {languageOptions.map((language) => (
                      <option key={language.code} value={language.code}>
                        {getLanguageOptionLabel(language, resolvedLanguage)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="appearance-settings-title">
              <h2 id="appearance-settings-title">{t(resolvedLanguage, "settings.appearance")}</h2>
              <div className="settings-grid">
                <label className="field">
                  <span>{t(resolvedLanguage, "settings.colorMode")}</span>
                  <select
                    value={themePreference}
                    onChange={(event) => updateThemePreference(event.currentTarget.value)}
                  >
                    <option value="system">{t(resolvedLanguage, "settings.theme.system")}</option>
                    <option value="light">{t(resolvedLanguage, "settings.theme.light")}</option>
                    <option value="dark">{t(resolvedLanguage, "settings.theme.dark")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t(resolvedLanguage, "settings.thumbnailSize")}</span>
                  <select
                    value={thumbnailSize}
                    onChange={(event) => updateThumbnailSize(event.currentTarget.value)}
                  >
                    {THUMBNAIL_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(resolvedLanguage, `settings.size.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="highlight-settings-title">
              <h2 id="highlight-settings-title">{t(resolvedLanguage, "settings.highlight")}</h2>
              <div className="settings-grid">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={highlightSettings.dashedBorders}
                    onChange={(event) => updateHighlightSettings({ dashedBorders: event.currentTarget.checked })}
                  />
                  <span>{t(resolvedLanguage, "settings.dashedBorders")}</span>
                </label>
                <label className="field">
                  <span>{t(resolvedLanguage, "settings.labelPosition")}</span>
                  <select
                    value={highlightSettings.labelPlacement}
                    onChange={(event) => updateHighlightSettings({ labelPlacement: event.currentTarget.value as HighlightLabelPlacement })}
                  >
                    <option value="inside">{t(resolvedLanguage, "settings.position.inside")}</option>
                    <option value="above">{t(resolvedLanguage, "settings.position.above")}</option>
                    <option value="below">{t(resolvedLanguage, "settings.position.below")}</option>
                    <option value="left">{t(resolvedLanguage, "settings.position.left")}</option>
                    <option value="right">{t(resolvedLanguage, "settings.position.right")}</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="scan-settings-title">
              <h2 id="scan-settings-title">{t(resolvedLanguage, "settings.scan")}</h2>
              <div className="settings-grid">
                <label className="settings-toggle">
                  <span>{t(resolvedLanguage, "settings.scanIframes")}</span>
                  <input
                    type="checkbox"
                    checked={scanSettings.includeIframes}
                    onChange={(event) => updateScanSettings({ includeIframes: event.currentTarget.checked })}
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t(resolvedLanguage, "settings.scanShadowDom")}</span>
                  <input
                    type="checkbox"
                    checked={scanSettings.includeShadowDom}
                    onChange={(event) => updateScanSettings({ includeShadowDom: event.currentTarget.checked })}
                  />
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="list-settings-title">
              <h2 id="list-settings-title">{t(resolvedLanguage, "settings.lists")}</h2>
              <div className="settings-grid">
                <label className="field">
                  <span>{t(resolvedLanguage, "settings.resultsPerPage")}</span>
                  <select
                    value={resultsPerPage}
                    onChange={(event) => updateResultsPerPage(event.currentTarget.value)}
                  >
                    {RESULTS_PER_PAGE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(resolvedLanguage, "settings.resultsPerPageOption", { count: option })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="caption-settings-title">
              <h2 id="caption-settings-title">{t(resolvedLanguage, "settings.caption")}</h2>
              <div className="settings-grid">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={liveRegionCaptionSettings.autoHide}
                    onChange={(event) => updateLiveRegionCaptionSettings({ autoHide: event.currentTarget.checked })}
                  />
                  <span>{t(resolvedLanguage, "settings.autoHide")}</span>
                </label>

                {liveRegionCaptionSettings.autoHide ? (
                  <label className="field">
                    <span>{t(resolvedLanguage, "settings.hideAfter")}</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      step="1"
                      value={liveRegionCaptionSettings.autoHideSeconds}
                      onChange={(event) => updateLiveRegionCaptionSettings({ autoHideSeconds: event.currentTarget.valueAsNumber })}
                    />
                  </label>
                ) : null}

                <label className="field">
                  <span>{t(resolvedLanguage, "settings.position")}</span>
                  <select
                    value={liveRegionCaptionSettings.position}
                    onChange={(event) => updateLiveRegionCaptionSettings({ position: event.currentTarget.value as LiveRegionCaptionSettings["position"] })}
                  >
                    <option value="bottom">{t(resolvedLanguage, "settings.bottom")}</option>
                    <option value="top">{t(resolvedLanguage, "settings.top")}</option>
                  </select>
                </label>

                <label className="field">
                  <span>{t(resolvedLanguage, "settings.textSize")}</span>
                  <select
                    value={liveRegionCaptionSettings.textSize}
                    onChange={(event) => updateLiveRegionCaptionSettings({ textSize: event.currentTarget.value as LiveRegionCaptionSettings["textSize"] })}
                  >
                    <option value="small">{t(resolvedLanguage, "settings.size.small")}</option>
                    <option value="medium">{t(resolvedLanguage, "settings.size.medium")}</option>
                    <option value="large">{t(resolvedLanguage, "settings.size.large")}</option>
                    <option value="extra-large">{t(resolvedLanguage, "settings.size.extraLarge")}</option>
                  </select>
                </label>

                <div className="field color-field">
                  <label htmlFor="live-region-caption-text-color">{t(resolvedLanguage, "settings.textColor")}</label>
                  <input
                    id="live-region-caption-text-color"
                    type="color"
                    value={liveRegionCaptionSettings.textColor}
                    onChange={(event) => updateLiveRegionCaptionSettings({ textColor: event.currentTarget.value })}
                  />
                </div>

                <div className="field color-field">
                  <label htmlFor="live-region-caption-background-color">{t(resolvedLanguage, "settings.backgroundColor")}</label>
                  <input
                    id="live-region-caption-background-color"
                    type="color"
                    value={liveRegionCaptionSettings.backgroundColor}
                    onChange={(event) => updateLiveRegionCaptionSettings({ backgroundColor: event.currentTarget.value })}
                  />
                </div>

                <label className="field">
                  <span>{t(resolvedLanguage, "settings.backgroundOpacity")}</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={liveRegionCaptionSettings.backgroundOpacity}
                    onChange={(event) => updateLiveRegionCaptionSettings({ backgroundOpacity: event.currentTarget.valueAsNumber })}
                  />
                  <span className="range-value" aria-hidden="true">{liveRegionCaptionSettings.backgroundOpacity}%</span>
                </label>
              </div>
            </section>
          </section>
        ) : (
          <section
            id="feedback-content"
            className="feedback-panel"
            aria-label={t(resolvedLanguage, "view.feedback")}
          >
            <button type="button" className="secondary-action settings-back" onClick={() => setActiveView("tools")}>
              <ArrowLeft aria-hidden="true" size={18} />
              {t(resolvedLanguage, "settings.back")}
            </button>

            <section className="feedback-card" aria-labelledby="feedback-title">
              <div className="feedback-card__icon" aria-hidden="true">
                <MessageSquare size={32} />
              </div>
              <h2 id="feedback-title">{t(resolvedLanguage, "feedback.title")}</h2>
              <p>
                {t(resolvedLanguage, "feedback.intro")}
              </p>
              <p>
                {t(resolvedLanguage, "feedback.direct")}
              </p>
              <div className="feedback-actions">
                <a className="primary-action" href={feedbackEmailHref}>
                  <Mail aria-hidden="true" size={18} />
                  support@forlaens.com
                </a>
                <hr className="feedback-divider" />
                <p className="feedback-note">
                  <Star aria-hidden="true" size={18} />
                  {t(resolvedLanguage, "feedback.review")}
                </p>
              </div>
            </section>
          </section>
        )}
        <footer className={`panel-footer${activeView === "feedback" ? " panel-footer--single" : ""}`}>
          <span className="footer-credit">
            {t(resolvedLanguage, "footer.madeBy")}{" "}
            <a className="footer-link" href="https://forlaens.com" target="_blank" rel="noreferrer">
              <span>Forlæns</span>
              <ExternalLink aria-hidden="true" size={14} strokeWidth={2.5} />
              <span className="sr-only">{t(resolvedLanguage, "common.opensNewTab")}</span>
            </a>
          </span>
          {activeView === "feedback" ? null : (
            <button type="button" className="footer-action" onClick={() => setActiveView("feedback")}>
              <MessageSquare aria-hidden="true" size={16} />
              {t(resolvedLanguage, "footer.feedback")}
            </button>
          )}
        </footer>
      </div>
    </main>
  );

  function revealElement(elementId: string, announcement = t(resolvedLanguage, "announce.showItem")) {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime) {
      return;
    }

    const canInspectInDevTools = devtoolsOpen && !isFrameScopedElementId(elementId);
    announceReveal(canInspectInDevTools ? getDevToolsAnnouncement(announcement, resolvedLanguage) : announcement);
    runtime.sendMessage({
      type: canInspectInDevTools ? "A11Y_TOOLS_INSPECT_ELEMENT" : "A11Y_TOOLS_REVEAL_ELEMENT",
      elementId
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function revealFrameProblem(problem: ScanProgress["problems"][number]) {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime || !Number.isInteger(problem.frameId)) {
      return;
    }

    announceReveal(t(resolvedLanguage, "announce.showItem"));
    runtime.sendMessage({
      type: "A11Y_TOOLS_REVEAL_FRAME",
      frameId: problem.frameId
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function selectTool(nextTool: Tool) {
    if (nextTool === activeTool) {
      return;
    }

    if (nextTool !== "linearView" && semanticLinearViewEnabled) {
      setSemanticLinearView(false);
    }

    if (nextTool !== "interactive" && interactiveNavigator.enabled) {
      setInteractiveNavigatorEnabled(false);
    }

    if (nextTool !== "interactive" && pageStructureOverlay.interactive) {
      setInteractiveHighlights(false);
    }

    setActiveTool(nextTool);
    savePanelPreferences({ activeTool: nextTool });
  }

  async function pickContrastColor(target: ContrastColorTarget) {
    const EyeDropperConstructor = window.EyeDropper;

    if (!EyeDropperConstructor) {
      setContrastPickerStatus(t(resolvedLanguage, "contrast.unsupported"));
      return;
    }

    setContrastPickerStatus(t(resolvedLanguage, "contrast.picking"));

    try {
      const result = await new EyeDropperConstructor().open();
      const nextColor = normalizeColorInput(result.sRGBHex);

      if (!nextColor) {
        setContrastPickerStatus(t(resolvedLanguage, "contrast.invalidPick"));
        return;
      }

      if (target === "text") {
        setContrastTextColor(nextColor);
      } else {
        setContrastBackgroundColor(nextColor);
      }

      setContrastPickerStatus(t(resolvedLanguage, target === "text" ? "contrast.textPicked" : "contrast.backgroundPicked", { color: nextColor }));
    } catch {
      setContrastPickerStatus(t(resolvedLanguage, "contrast.cancelled"));
    }
  }

  function updateLanguagePreference(value: string) {
    const nextLanguage = normalizeLanguagePreference(value);

    setLanguagePreference(nextLanguage);
    savePanelPreferences({ language: nextLanguage });
    announceReveal(t(resolvePluginLanguage(nextLanguage, getNavigatorLanguages()), "announce.language"));
  }

  function updateThemePreference(value: string) {
    const nextTheme = normalizeThemePreference(value);

    setThemePreference(nextTheme);
    savePanelPreferences({ theme: nextTheme });
  }

  function updateResultsPerPage(value: string) {
    const nextResultsPerPage = normalizeResultsPerPage(value);

    setResultsPerPage(nextResultsPerPage);
    savePanelPreferences({ resultsPerPage: nextResultsPerPage });
  }

  function updateThumbnailSize(value: string) {
    const nextThumbnailSize = normalizeThumbnailSize(value);

    setThumbnailSize(nextThumbnailSize);
    savePanelPreferences({ thumbnailSize: nextThumbnailSize });
  }

  function revealLiveRegion(key: string, announcement = t(resolvedLanguage, "announce.showLive", { name: "" }), selector = "") {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime) {
      return;
    }

    const canInspectInDevTools = devtoolsOpen && selector && !isFrameScopedElementId(key);
    announceReveal(canInspectInDevTools ? getDevToolsAnnouncement(announcement, resolvedLanguage) : announcement);
    runtime.sendMessage({
      type: canInspectInDevTools ? "A11Y_TOOLS_INSPECT_SELECTOR" : "A11Y_TOOLS_REVEAL_LIVE_REGION",
      key,
      selector
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function announceReveal(message: string) {
    setRevealAnnouncement("");
    window.setTimeout(() => setRevealAnnouncement(message), 0);
  }

  function setLiveRegionCaptions(enabled: boolean) {
    const runtime = globalThis.chrome?.runtime;
    setLiveRegionCaptionsEnabled(enabled);
    announceReveal(getLiveRegionCaptionsAnnouncement(enabled, liveRegions.length, resolvedLanguage));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setLiveRegionCaptionsEnabled(false);
    });
  }

  function setTextResizeSimulation(settings: Partial<TextResizeSimulation>) {
    const runtime = globalThis.chrome?.runtime;
    const previousSimulation = textResizeSimulation;
    const nextSimulation = normalizeTextResizeSimulation({
      ...textResizeSimulation,
      ...settings
    });

    setTextResizeSimulationState(nextSimulation);

    if (
      previousSimulation.enabled !== nextSimulation.enabled ||
      (nextSimulation.enabled && previousSimulation.scale !== nextSimulation.scale)
    ) {
      announceReveal(getTextResizeSimulationAnnouncement(nextSimulation, resolvedLanguage));
    }

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: nextSimulation
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setTextResizeSimulationState(previousSimulation);
    });
  }

  function setSemanticLinearView(enabled: boolean) {
    const runtime = globalThis.chrome?.runtime;
    if (enabled) {
      clearPageStructureOverlay(runtime);
    }
    setSemanticLinearViewEnabled(enabled);
    const itemCount = analysis.linearItems?.length ?? 0;
    announceReveal(getSemanticLinearViewAnnouncement(enabled, itemCount, resolvedLanguage));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW",
      enabled
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setSemanticLinearViewEnabled(false);
    });
  }

  function setInteractiveNavigatorEnabled(enabled: boolean) {
    const runtime = globalThis.chrome?.runtime;
    if (enabled) {
      clearPageStructureOverlay(runtime);
    }
    setInteractiveNavigator((current) => ({ ...current, enabled }));
    const itemCount = analysis.interactiveItems?.length ?? 0;
    announceReveal(getInteractiveNavigatorAnnouncement(enabled, itemCount, resolvedLanguage));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_INTERACTIVE_NAVIGATOR",
      enabled
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setInteractiveNavigator((current) => ({ ...current, enabled: false }));
    });
  }

  function setInteractiveHighlights(enabled: boolean) {
    const runtime = globalThis.chrome?.runtime;
    const nextOverlay = enabled
      ? { ...EMPTY_PAGE_STRUCTURE_OVERLAY, interactive: true }
      : { ...pageStructureOverlay, interactive: false };

    if (enabled && interactiveNavigator.enabled) {
      setInteractiveNavigatorEnabled(false);
    }

    setPageStructureOverlayState(nextOverlay);
    announceReveal(getPageStructureOverlayAnnouncement({ interactive: enabled }, nextOverlay, resolvedLanguage));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: nextOverlay
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setPageStructureOverlayState(pageStructureOverlay);
    });
  }

  function moveInteractiveNavigator(direction: "previous" | "next") {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime) {
      return;
    }

    pendingInteractiveMoveRef.current = direction;
    runtime.sendMessage({
      type: "A11Y_TOOLS_MOVE_INTERACTIVE_NAVIGATOR",
      direction
    }).catch(() => {
      pendingInteractiveMoveRef.current = null;
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function clearPageStructureOverlay(runtime = globalThis.chrome?.runtime) {
    const nextOverlay = EMPTY_PAGE_STRUCTURE_OVERLAY;

    setPageStructureOverlayState(nextOverlay);

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: nextOverlay
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function updatePageStructureOverlay(partialOverlay: Partial<PageStructureOverlay>) {
    const runtime = globalThis.chrome?.runtime;
    const nextOverlay = normalizePageStructureOverlay({
      ...pageStructureOverlay,
      ...partialOverlay
    });

    setPageStructureOverlayState(nextOverlay);
    announceReveal(getPageStructureOverlayAnnouncement(partialOverlay, nextOverlay, resolvedLanguage));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: nextOverlay
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
      setPageStructureOverlayState(pageStructureOverlay);
    });
  }

  function getPageStructureOverlayAnnouncement(partialOverlay: Partial<PageStructureOverlay>, nextOverlay: PageStructureOverlay, language: PanelLanguage) {
    if ("headings" in partialOverlay) {
      return nextOverlay.headings
        ? t(language, "announce.overlay.headings.on", { countText: formatCount(language, analysis.headings.length, "count.heading") })
        : t(language, "announce.overlay.headings.off");
    }

    if ("landmarks" in partialOverlay) {
      return nextOverlay.landmarks
        ? t(language, "announce.overlay.landmarks.on", { countText: formatCount(language, analysis.landmarks.length, "count.landmark") })
        : t(language, "announce.overlay.landmarks.off");
    }

    if ("graphics" in partialOverlay) {
      return nextOverlay.graphics
        ? t(language, "announce.overlay.graphics.on", { countText: formatCount(language, analysis.graphics?.length ?? 0, "count.graphic") })
        : t(language, "announce.overlay.graphics.off");
    }

    if ("ariaLabels" in partialOverlay) {
      return nextOverlay.ariaLabels
        ? t(language, "announce.overlay.aria.on", { countText: formatCount(language, analysis.ariaLabels?.length ?? 0, "count.aria") })
        : t(language, "announce.overlay.aria.off");
    }

    if ("interactive" in partialOverlay) {
      return nextOverlay.interactive
        ? t(language, "announce.overlay.interactive.on", { countText: formatCount(language, analysis.interactiveItems?.length ?? 0, "count.keyboard") })
        : t(language, "announce.overlay.interactive.off");
    }

    if ("tables" in partialOverlay) {
      return nextOverlay.tables
        ? t(language, "announce.overlay.tables.on", { countText: formatCount(language, analysis.tables?.length ?? 0, "count.table") })
        : t(language, "announce.overlay.tables.off");
    }

    return t(language, "announce.visual.updated");
  }

  function updateLiveRegionCaptionSettings(settings: Partial<LiveRegionCaptionSettings>) {
    const runtime = globalThis.chrome?.runtime;
    const nextSettings = normalizeLiveRegionCaptionSettings({
      ...liveRegionCaptionSettings,
      ...settings
    });

    setLiveRegionCaptionSettings(nextSettings);

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_UPDATE_LIVE_REGION_CAPTION_SETTINGS",
      settings: nextSettings
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function updateHighlightSettings(settings: Partial<HighlightSettings>) {
    const runtime = globalThis.chrome?.runtime;
    const nextSettings = normalizeHighlightSettings({
      ...highlightSettings,
      ...settings
    });

    setHighlightSettings(nextSettings);

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_UPDATE_HIGHLIGHT_SETTINGS",
      highlightSettings: nextSettings
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }

  function updateScanSettings(settings: Partial<ScanSettings>) {
    const runtime = globalThis.chrome?.runtime;
    const nextSettings = normalizeScanSettings({
      ...scanSettings,
      ...settings
    });

    setScanSettings(nextSettings);
    hasAcceptedAnalysisRef.current = false;
    setScanProgressState(null);
    setScanStatus("scanning", t(resolvedLanguage, "status.scanning"));

    if (!runtime) {
      return;
    }

    runtime.sendMessage({
      type: "A11Y_TOOLS_UPDATE_SCAN_SETTINGS",
      scanSettings: nextSettings
    }).catch(() => {
      setStatus(t(resolvedLanguage, "status.refresh"));
    });
  }
}

function normalizePageStructureOverlay(value?: Partial<PageStructureOverlay>): PageStructureOverlay {
  return {
    headings: Boolean(value?.headings),
    landmarks: Boolean(value?.landmarks),
    graphics: Boolean(value?.graphics),
    ariaLabels: Boolean(value?.ariaLabels),
    interactive: Boolean(value?.interactive),
    tables: Boolean(value?.tables)
  };
}

function normalizeInteractiveNavigator(value?: Partial<InteractiveNavigatorState>): InteractiveNavigatorState {
  return {
    enabled: Boolean(value?.enabled),
    index: Number.isInteger(value?.index) ? value.index as number : 0,
    count: Number.isInteger(value?.count) ? value.count as number : 0,
    currentHidden: Boolean(value?.currentHidden),
    currentLabel: typeof value?.currentLabel === "string" ? value.currentLabel : ""
  };
}

function normalizeTextResizeSimulation(value?: Partial<TextResizeSimulation>): TextResizeSimulation {
  return {
    enabled: Boolean(value?.enabled),
    scale: normalizeTextResizeScale(value?.scale)
  };
}

function normalizeTextResizeScale(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_TEXT_RESIZE_SIMULATION.scale;
  }

  const steppedValue = Math.round(numericValue / TEXT_RESIZE_STEP) * TEXT_RESIZE_STEP;
  return Math.max(TEXT_RESIZE_MIN_SCALE, Math.min(TEXT_RESIZE_MAX_SCALE, steppedValue));
}

function normalizeHighlightSettings(value?: Partial<HighlightSettings>): HighlightSettings {
  const placement = value?.labelPlacement;

  return {
    dashedBorders: Boolean(value?.dashedBorders),
    labelPlacement: placement === "inside" || placement === "above" || placement === "below" || placement === "left" || placement === "right"
      ? placement
      : DEFAULT_HIGHLIGHT_SETTINGS.labelPlacement
  };
}

function normalizeScanSettings(value?: Partial<ScanSettings>): ScanSettings {
  return {
    includeIframes: value?.includeIframes !== false,
    includeShadowDom: value?.includeShadowDom !== false
  };
}

function isFrameScopedElementId(value: string) {
  return value.startsWith("a11y-frame:");
}

function isScanProgressFinished(progress: ScanProgress) {
  return progress.phase === "complete" || progress.phase === "problem";
}

function getScanProgressPercent(progress: ScanProgress | null | undefined) {
  if (!progress?.totalFrames) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((progress.completedFrames / progress.totalFrames) * 100)));
}

function getScanProgressTitle(progress: ScanProgress, language: PanelLanguage) {
  if (progress.phase === "preparing") {
    return t(language, "scan.progress.preparing");
  }

  if (progress.phase === "injecting") {
    return t(language, "scan.progress.injecting");
  }

  if (progress.phase === "applyingSettings") {
    return t(language, "scan.progress.applyingSettings");
  }

  if (progress.phase === "complete") {
    return progress.problems.length > 0
      ? getScanProgressProblemSummary(progress, language)
      : t(language, "scan.progress.complete");
  }

  if (progress.phase === "problem") {
    return getScanProgressProblemSummary(progress, language);
  }

  if (progress.totalFrames && progress.totalFrames > 1) {
    return t(language, "scan.progress.frames", {
      completed: progress.completedFrames,
      total: progress.totalFrames
    });
  }

  return t(language, "scan.progress.page");
}

function getScanProgressDetail(progress: ScanProgress, language: PanelLanguage) {
  if (!progress.totalFrames) {
    return progress.includeIframes
      ? t(language, "scan.progress.detail.findingFrames")
      : t(language, "scan.progress.detail.mainFrameOnly");
  }

  const scannedText = progress.totalFrames > 1
    ? t(language, "scan.progress.detail.frames", {
        completed: progress.completedFrames,
        successful: progress.successfulFrames,
        failed: progress.failedFrames,
        total: progress.totalFrames
      })
    : t(language, "scan.progress.detail.mainFrame");

  const shadowText = progress.includeShadowDom
    ? t(language, "scan.progress.detail.shadowIncluded")
    : t(language, "scan.progress.detail.shadowSkipped");

  return `${scannedText} ${shadowText}`;
}

function getScanProgressProblemSummary(progress: ScanProgress, language: PanelLanguage) {
  const count = progress.problems.length || progress.failedFrames;

  if (count === 1) {
    return t(language, "scan.progress.problem.one");
  }

  return t(language, "scan.progress.problem.other", { count });
}

function getScanProgressProblemText(problem: ScanProgress["problems"][number], language: PanelLanguage) {
  const frameText = Number.isInteger(problem.frameId)
    ? t(language, "scan.progress.problem.frame", { frame: problem.frameId })
    : "";
  const detail = problem.detail ? ` ${problem.detail}` : "";

  if (problem.code === "allFramesInjectionFailed") {
    return t(language, "scan.progress.problem.allFramesInjectionFailed");
  }

  if (problem.code === "frameMessageFailed") {
    return `${frameText}${t(language, "scan.progress.problem.frameMessageFailed")}${detail}`;
  }

  if (problem.code === "frameInjectionSkipped") {
    return `${frameText}${t(language, "scan.progress.problem.frameInjectionSkipped")}${detail}`;
  }

  if (problem.code === "frameTimeout") {
    return `${frameText}${t(language, "scan.progress.problem.frameTimeout")}`;
  }

  if (problem.code === "frameAnalysisFailed") {
    return `${frameText}${t(language, "scan.progress.problem.frameAnalysisFailed")}${detail}`;
  }

  if (problem.code === "allFramesFailed") {
    return t(language, "scan.progress.problem.allFramesFailed");
  }

  return detail.trim() || t(language, "scan.progress.problem.unknown");
}

function isTool(value: unknown): value is Tool {
  return typeof value === "string" && TOOLS.has(value as Tool);
}

function savePanelPreferences(preferences: Partial<{ activeTool: Tool; language: PanelLanguagePreference; theme: ThemePreference; resultsPerPage: ResultsPerPage; thumbnailSize: ThumbnailSize }>) {
  const storage = globalThis.chrome?.storage?.local;

  if (!storage) {
    return;
  }

  storage
    .get(PANEL_PREFERENCES_KEY)
    .then((stored: { [PANEL_PREFERENCES_KEY]?: object }) => storage.set({
      [PANEL_PREFERENCES_KEY]: {
        ...(stored[PANEL_PREFERENCES_KEY] ?? {}),
        ...preferences
      }
    }))
    .catch(() => {});
}

function getPaginationContextKey(context: PageContext) {
  const tabPart = context.tabId === null ? "tab:none" : `tab:${context.tabId}`;

  return `${tabPart}|url:${context.url}`;
}

function ScanStateMessage({
  title,
  progress,
  language,
  onRevealFrame
}: {
  title: string;
  progress?: ScanProgress | null;
  language: PanelLanguage;
  onRevealFrame: (problem: ScanProgress["problems"][number]) => void;
}) {
  const progressPercent = getScanProgressPercent(progress);
  const isDeterminate = progressPercent !== null;
  const progressStyle = isDeterminate
    ? ({ "--scan-progress-value": `${progressPercent}%` } as React.CSSProperties)
    : undefined;

  return (
    <section className="empty-state" aria-live="polite" aria-atomic="true" aria-busy="true">
      <p>{title}</p>
      {progress ? <span className="scan-detail">{getScanProgressDetail(progress, language)}</span> : null}
      <div
        className={`scan-progress${isDeterminate ? " scan-progress--determinate" : ""}`}
        role="progressbar"
        aria-label={title}
        aria-valuemin={isDeterminate ? 0 : undefined}
        aria-valuemax={isDeterminate ? 100 : undefined}
        aria-valuenow={isDeterminate ? progressPercent : undefined}
        style={progressStyle}
      >
        <span />
      </div>
      {progress?.problems.length ? (
        <ul className="scan-problems">
          {progress.problems.map((problem, index) => (
            <li key={`${problem.code}-${problem.frameId ?? "page"}-${index}`}>
              <span>{getScanProgressProblemText(problem, language)}</span>
              {problem.canReveal ? (
                <button type="button" className="secondary-action scan-problem-action" onClick={() => onRevealFrame(problem)}>
                  {t(language, "scan.progress.problem.showFrame")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ScanProblemNotice({
  progress,
  language,
  onRevealFrame
}: {
  progress: ScanProgress;
  language: PanelLanguage;
  onRevealFrame: (problem: ScanProgress["problems"][number]) => void;
}) {
  return (
    <section className="scan-warning" aria-label={getScanProgressProblemSummary(progress, language)}>
      <p>{getScanProgressProblemSummary(progress, language)}</p>
      <ul>
        {progress.problems.map((problem, index) => (
          <li key={`${problem.code}-${problem.frameId ?? "page"}-${index}`}>
            <span>{getScanProgressProblemText(problem, language)}</span>
            {problem.canReveal ? (
              <button type="button" className="secondary-action scan-problem-action" onClick={() => onRevealFrame(problem)}>
                {t(language, "scan.progress.problem.showFrame")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ToolDropdown({
  activeTool,
  counts,
  language,
  onChange
}: {
  activeTool: Tool;
  counts: Record<Tool, number>;
  language: PanelLanguage;
  onChange: (tool: Tool) => void;
}) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [open, setOpen] = useState(false);
  const activeCount = counts[activeTool] ?? 0;
  const activeIndex = Math.max(0, TOOL_ORDER.indexOf(activeTool));
  const showActiveCount = activeTool !== "contrast" && activeTool !== "textResize";

  useEffect(() => {
    if (!open) {
      return;
    }

    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function chooseTool(tool: Tool) {
    setOpen(false);
    onChange(tool);
  }

  function focusOption(index: number) {
    optionRefs.current[clampIndex(index)]?.focus();
  }

  function clampIndex(index: number) {
    return Math.max(0, Math.min(index, TOOL_ORDER.length - 1));
  }

  function handleButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => focusOption(event.key === "ArrowDown" ? activeIndex + 1 : activeIndex - 1));
    }
  }

  function handleOptionKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number, tool: Tool) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusOption(TOOL_ORDER.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseTool(tool);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      document.getElementById(id)?.focus();
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    const nextFocusedElement = event.relatedTarget;

    if (!nextFocusedElement || !containerRef.current?.contains(nextFocusedElement as Node)) {
      setOpen(false);
    }
  }

  return (
    <div className={`tool-select${open ? " tool-select--open" : ""}`} ref={containerRef} onBlur={handleBlur}>
      <button
        id={id}
        type="button"
        className="tool-select__control"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
      >
        <span className="tool-select__visual">
          <span className="tool-select__icon">{getToolIcon(activeTool)}</span>
          <span className="tool-select__text">
            <span className="tool-select__meta">{t(language, "tools.type")}</span>
            <span className="tool-select__label">{getToolLabel(activeTool, language)}</span>
          </span>
          {showActiveCount ? <CountBadge count={activeCount} language={language} /> : null}
        </span>
      </button>

      {open ? (
        <div id={listboxId} className="tool-select__listbox" role="listbox" aria-label={t(language, "tools.label")}>
          {TOOL_ORDER.map((tool, index) => {
            const count = counts[tool] ?? 0;
            return (
              <div
                key={tool}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="option"
                aria-selected={activeTool === tool}
                tabIndex={activeTool === tool ? 0 : -1}
                className="tool-select__option"
                onClick={() => chooseTool(tool)}
                onKeyDown={(event) => handleOptionKeyDown(event, index, tool)}
              >
                <span className="tool-select__check" aria-hidden="true">{activeTool === tool ? "✓" : ""}</span>
                <span className="tool-select__icon" aria-hidden="true">{getToolIcon(tool)}</span>
                <span className="tool-select__text">
                  <span className="tool-select__label">{getToolLabel(tool, language)}</span>
                </span>
                {tool === "contrast" || tool === "textResize" ? null : <CountBadge count={count} language={language} />}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CountBadge({ count, language }: { count: number; language: PanelLanguage }) {
  return (
    <span className="count">
      {count}
      <span className="sr-only" lang={language}> {getItemWord(language, count)}</span>
    </span>
  );
}

function getToolCounts(analysis: AccessibilityAnalysis, liveRegions: LiveRegionItem[]): Record<Tool, number> {
  return {
    headings: analysis.headings.length,
    landmarks: analysis.landmarks.length,
    liveRegions: liveRegions.length,
    graphics: analysis.graphics?.length ?? 0,
    tables: analysis.tables?.length ?? 0,
    contrast: 0,
    textResize: 0,
    ariaLabels: analysis.ariaLabels?.length ?? 0,
    linearView: analysis.linearItems?.length ?? 0,
    interactive: analysis.interactiveItems?.length ?? 0
  };
}

function getToolLabel(tool: Tool, language: PanelLanguage) {
  switch (tool) {
    case "headings":
      return t(language, "tools.headings");
    case "landmarks":
      return t(language, "tools.landmarks");
    case "liveRegions":
      return t(language, "tools.liveRegions");
    case "graphics":
      return t(language, "tools.images");
    case "tables":
      return t(language, "tools.tables");
    case "contrast":
      return t(language, "tools.contrast");
    case "textResize":
      return t(language, "tools.textResize");
    case "ariaLabels":
      return t(language, "tools.ariaLabels");
    case "linearView":
      return t(language, "tools.linearView");
    case "interactive":
      return t(language, "tools.interactive");
  }
}

function getToolIcon(tool: Tool) {
  switch (tool) {
    case "headings":
      return <Heading size={22} />;
    case "landmarks":
      return <Compass size={22} />;
    case "liveRegions":
      return <Captions size={22} />;
    case "graphics":
      return <ImageIcon size={22} />;
    case "tables":
      return <Table2 size={22} />;
    case "contrast":
      return <Pipette size={22} />;
    case "textResize":
      return <Heading size={22} />;
    case "ariaLabels":
      return <Tag size={22} />;
    case "linearView":
      return <ListTree size={22} />;
    case "interactive":
      return <Keyboard size={22} />;
  }
}

function CopyListButton({ text, language }: { text: string; language: PanelLanguage }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const statusId = useId();

  async function handleCopy() {
    try {
      await copyTextToClipboard(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("failed");
      window.setTimeout(() => setState("idle"), 2200);
    }
  }

  return (
    <div className="export-actions">
      <button type="button" className="secondary-action export-action" onClick={handleCopy} aria-describedby={statusId}>
        <ClipboardCopy aria-hidden="true" size={16} />
        {state === "copied" ? t(language, "export.copied") : t(language, "export.copyList")}
      </button>
      <span id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
        {state === "copied" ? t(language, "export.copied") : state === "failed" ? t(language, "export.copyFailed") : ""}
      </span>
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy failed");
    }
  } finally {
    textarea.remove();
  }
}

function PaginatedList<T>({
  items,
  resultsPerPage,
  language,
  listClassName,
  pageIndex,
  onPageIndexChange,
  renderItem
}: {
  items: T[];
  resultsPerPage: ResultsPerPage;
  language: PanelLanguage;
  listClassName: string;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
  renderItem: (item: T) => React.ReactNode;
}) {
  const listId = useId();
  const pageCount = Math.max(1, Math.ceil(items.length / resultsPerPage));
  const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
  const startIndex = safePageIndex * resultsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + resultsPerPage);
  const visibleStart = items.length === 0 ? 0 : startIndex + 1;
  const visibleEnd = Math.min(items.length, startIndex + resultsPerPage);
  const paginationSummary = t(language, "pagination.summary", {
    start: visibleStart,
    end: visibleEnd,
    total: items.length,
    page: safePageIndex + 1,
    pages: pageCount
  }).split(/(?<=\.)\s+/).map((part) => part.replace(/\.$/, ""));

  useEffect(() => {
    if (safePageIndex !== pageIndex) {
      onPageIndexChange(safePageIndex);
    }
  }, [onPageIndexChange, pageIndex, safePageIndex]);

  return (
    <>
      <ol id={listId} className={listClassName} start={visibleStart}>
        {visibleItems.map(renderItem)}
      </ol>
      {pageCount > 1 ? (
        <nav className="pagination" aria-label={t(language, "pagination.label")}>
          <button
            type="button"
            className="secondary-action"
            disabled={safePageIndex === 0}
            aria-controls={listId}
            aria-label={t(language, "pagination.previousPage")}
            onClick={() => onPageIndexChange(Math.max(0, safePageIndex - 1))}
          >
            {t(language, "common.previous")}
          </button>
          <p aria-live="polite" aria-atomic="true">
            {paginationSummary.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={safePageIndex >= pageCount - 1}
            aria-controls={listId}
            aria-label={t(language, "pagination.nextPage")}
            onClick={() => onPageIndexChange(Math.min(pageCount - 1, safePageIndex + 1))}
          >
            {t(language, "common.next")}
          </button>
        </nav>
      ) : null}
    </>
  );
}

function HeadingList({
  headings,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  headings: HeadingItem[];
  onReveal: (elementId: string, announcement?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  if (headings.length === 0) {
    return <EmptyState title={t(language, "empty.headings")} />;
  }

  return (
    <section aria-labelledby="headings-title">
      <h2 id="headings-title" className="section-title">{t(language, "headings.title")}</h2>
      <PaginatedList
        items={headings}
        resultsPerPage={resultsPerPage}
        language={language}
        listClassName="structure-list"
        pageIndex={pageIndex}
        onPageIndexChange={onPageIndexChange}
        renderItem={(heading) => (
          <li
            key={heading.id}
            className={`heading-structure-item${heading.level > 1 ? " is-nested" : ""}${heading.problem ? " has-problem" : ""}`}
            style={{ marginInlineStart: `${getHeadingStructureIndent(heading.level)}px` }}
          >
            <button
              type="button"
              className="structure-row"
              onClick={() => onReveal(heading.id, t(language, "announce.showHeading", { level: heading.level, name: heading.text || t(language, "common.noAccessibleName") }))}
            >
              <span className="level">H{heading.level}</span>
              <span className="item-text">{heading.text}</span>
              {heading.problem ? <span className="issue-badge">{t(language, "common.issue")}</span> : null}
              <span className="row-action">{actionLabel}</span>
              <span className="row-meta">
                {t(language, "export.field.source")}: <code>{heading.source}</code>
              </span>
              <ScopeMeta scope={heading.scope} language={language} />
            </button>
            {heading.problem ? <p className="problem">{localizeProblem(heading.problem, language)}</p> : null}
          </li>
        )}
      />
      <CopyListButton text={formatHeadingExport(headings, language)} language={language} />
    </section>
  );
}

function getHeadingStructureIndent(level: number) {
  return Math.min(160, Math.max(0, level - 1) * 32);
}

function LandmarkList({
  landmarks,
  structure,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  landmarks: LandmarkItem[];
  structure?: LandmarkStructureItem[];
  onReveal: (elementId: string, announcement?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  const landmarkStructure = structure?.length
    ? structure
    : landmarks.map((landmark) => ({ ...landmark, type: "landmark" as const }));

  return (
    <section aria-labelledby="landmarks-title">
      <h2 id="landmarks-title" className="section-title">{t(language, "landmarks.title")}</h2>
      <details className="explainer">
        <summary>{t(language, "landmarks.what")}</summary>
        <div>
          <p>
            {t(language, "landmarks.explain1")}
          </p>
          <p>
            {t(language, "landmarks.explain2")}
          </p>
        </div>
      </details>
      {landmarkStructure.length === 0 ? (
        <EmptyState title={t(language, "empty.landmarks")} />
      ) : (
        <PaginatedList
          items={landmarkStructure}
          resultsPerPage={resultsPerPage}
          language={language}
          listClassName="structure-list"
          pageIndex={pageIndex}
          onPageIndexChange={onPageIndexChange}
          renderItem={(item) => {
            if (item.type === "content") {
              return (
                <li
                  key={item.id}
                  className={`landmark-structure-item${item.depth > 0 ? " is-nested" : ""} landmark-gap has-problem`}
                  style={{ marginInlineStart: `${getLandmarkStructureIndent(item.depth)}px` }}
                >
                  <div className="structure-row">
                    <span className="level">{t(language, "common.outside")}</span>
                    <span className="item-text">{t(language, "landmarks.gap")}</span>
                    <span className="issue-badge">{t(language, "common.issue")}</span>
                    <ScopeMeta scope={item.scope} language={language} />
                  </div>
                  {item.snippets.length > 0 ? (
                    <p className="landmark-gap-preview">
                      {t(language, "landmarks.gapIncludes", { snippets: formatSnippetList(item.snippets, language) })}
                    </p>
                  ) : null}
                  <p className="problem">{localizeProblem(item.problem, language)}</p>
                </li>
              );
            }

            return (
              <li
                key={item.id}
                className={`landmark-structure-item${item.depth > 0 ? " is-nested" : ""}${item.problem ? " has-problem" : ""}`}
                style={{ marginInlineStart: `${getLandmarkStructureIndent(item.depth)}px` }}
              >
                <button
                  type="button"
                  className="structure-row landmark-row"
                  onClick={() => onReveal(item.id, t(language, "announce.showLandmark", { role: item.role, name: item.name ? `: ${item.name}` : "" }))}
                >
                  <span className="item-field">
                    <span className="item-field__label">{t(language, "export.field.role")}</span>
                    <span className="level">{item.role}</span>
                  </span>
                  <span className="item-field">
                    <span className="item-field__label">{t(language, "export.field.name")}</span>
                    <span className={`item-text${item.name ? "" : " item-text--missing"}`}>
                      {item.name || t(language, "common.noAccessibleName")}
                    </span>
                  </span>
                  {item.problem ? <span className="issue-badge">{t(language, "common.issue")}</span> : null}
                  <span className="row-action">{actionLabel}</span>
                  <span className="row-meta">
                    {t(language, "export.field.source")}: <code>{item.source}</code>
                  </span>
                  <ScopeMeta scope={item.scope} language={language} />
                </button>
                {item.problem ? <p className="problem">{localizeProblem(item.problem, language)}</p> : null}
              </li>
            );
          }}
        />
      )}
      {landmarkStructure.length > 0 ? <CopyListButton text={formatLandmarkExport(landmarkStructure, language)} language={language} /> : null}
    </section>
  );
}

function getLandmarkStructureIndent(depth: number) {
  return Math.min(96, Math.max(0, depth) * 32);
}

function LiveRegionList({
  liveRegions,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  liveRegions: LiveRegionItem[];
  onReveal: (key: string, announcement?: string, selector?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  if (liveRegions.length === 0) {
    return <EmptyState title={t(language, "empty.liveRegions")} />;
  }

  return (
    <section aria-labelledby="live-regions-title">
      <h2 id="live-regions-title" className="section-title">{t(language, "live.title")}</h2>
      <PaginatedList
        items={liveRegions}
        resultsPerPage={resultsPerPage}
        language={language}
        listClassName="live-region-list"
        pageIndex={pageIndex}
        onPageIndexChange={onPageIndexChange}
        renderItem={(region) => (
          <li key={region.key} className={region.present ? "" : "is-removed"}>
            <div className="live-region-card__header">
              <div>
                <h3>{region.label}</h3>
                <p>{t(language, region.present ? "live.current" : "live.removed")}</p>
              </div>
              <button type="button" className="secondary-action" onClick={() => onReveal(region.key, t(language, "announce.showLive", { name: region.label }), region.selector)}>
                {actionLabel}
              </button>
            </div>
            <ScopeText scope={region.scope} language={language} />

            {region.duplicatePosition ? (
              <p className="problem">{t(language, "live.duplicateProblem")}</p>
            ) : null}

            <ul className="live-region-behavior">
              {getLiveRegionBehaviorNotes(region, language).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>

            <details className="message-history">
              <summary>{t(language, "live.history", { count: region.messages.length })}</summary>
              {region.messages.length > 0 ? (
                <ol>
                  {region.messages.map((message) => (
                    <li key={`${message.time}-${message.text}`}>
                      <time dateTime={message.time}>{new Date(message.time).toLocaleTimeString()}</time>
                      <span>{message.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>{t(language, "live.noMessages")}</p>
              )}
            </details>
          </li>
        )}
      />
      <CopyListButton text={formatLiveRegionExport(liveRegions, language)} language={language} />
    </section>
  );
}

function getLiveRegionBehaviorNotes(region: LiveRegionItem, language: PanelLanguage) {
  const notes = [
    getLiveRegionUrgencyNote(region, language),
    getLiveRegionAtomicNote(region, language),
    getLiveRegionRelevantNote(region, language)
  ];

  if (region.role && region.role !== "none") {
    notes.push(t(language, "live.role", { role: region.role }));
  }

  if (region.ariaBusy === "true") {
    notes.push(t(language, "live.busy"));
  }

  return notes;
}

function getLiveRegionUrgencyNote(region: LiveRegionItem, language: PanelLanguage) {
  if (region.politeness === "assertive") {
    return t(language, "live.assertive");
  }

  return t(language, "live.polite");
}

function getLiveRegionAtomicNote(region: LiveRegionItem, language: PanelLanguage) {
  if (region.ariaAtomic === "true") {
    return t(language, "live.atomic.true");
  }

  return t(language, "live.atomic.false");
}

function getLiveRegionRelevantNote(region: LiveRegionItem, language: PanelLanguage) {
  const relevant = region.ariaRelevant || "additions text";
  const parts = relevant.split(/\s+/).filter(Boolean);
  const labels: string[] = [];

  if (parts.includes("additions")) {
    labels.push(t(language, "live.relevant.additions"));
  }

  if (parts.includes("text")) {
    labels.push(t(language, "live.relevant.text"));
  }

  if (parts.includes("removals")) {
    labels.push(t(language, "live.relevant.removals"));
  }

  if (labels.length === 0 || parts.includes("all")) {
    return t(language, "live.relevant.all");
  }

  return t(language, "live.relevant.some", { items: formatList(language, labels) });
}

function GraphicList({
  graphics,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  graphics: GraphicItem[];
  onReveal: (elementId: string, announcement?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  const [filters, setFilters] = useState<GraphicFilters>(DEFAULT_GRAPHIC_FILTERS);
  const filteredGraphics = graphics.filter((graphic) => filters[getGraphicFilterKey(graphic)]);
  const filterCounts = graphics.reduce<Record<GraphicFilterKey, number>>((counts, graphic) => {
    counts[getGraphicFilterKey(graphic)] += 1;
    return counts;
  }, { named: 0, decorative: 0, unnamed: 0 });

  function updateFilter(filter: GraphicFilterKey, checked: boolean) {
    setFilters((current) => ({ ...current, [filter]: checked }));
  }

  if (graphics.length === 0) {
    return <EmptyState title={t(language, "empty.graphics")} />;
  }

  return (
    <section aria-labelledby="graphics-title">
      <h2 id="graphics-title" className="section-title">{t(language, "graphics.title")}</h2>
      <div className="tool-explanation">
        <p>
          {t(language, "graphics.explain1")}
        </p>
        <p>
          {t(language, "graphics.explain2")}
        </p>
      </div>
      <fieldset className="filter-panel">
        <legend>{t(language, "graphics.filter")}</legend>
        <label>
          <input
            type="checkbox"
            checked={filters.named}
            onChange={(event) => updateFilter("named", event.currentTarget.checked)}
          />
          <GraphicFilterLabel label={t(language, "graphics.withText")} count={filterCounts.named} language={language} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.decorative}
            onChange={(event) => updateFilter("decorative", event.currentTarget.checked)}
          />
          <GraphicFilterLabel label={t(language, "graphics.decorative")} count={filterCounts.decorative} language={language} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.unnamed}
            onChange={(event) => updateFilter("unnamed", event.currentTarget.checked)}
          />
          <GraphicFilterLabel label={t(language, "graphics.unnamed")} count={filterCounts.unnamed} language={language} />
        </label>
      </fieldset>
      {filteredGraphics.length === 0 ? (
        <EmptyState title={t(language, "empty.graphicFilters")} />
      ) : (
        <>
          <PaginatedList
            items={filteredGraphics}
            resultsPerPage={resultsPerPage}
            language={language}
            listClassName="structure-list"
            pageIndex={pageIndex}
            onPageIndexChange={onPageIndexChange}
            renderItem={(graphic) => {
              const problem = getGraphicProblem(graphic);

              return (
                <li key={graphic.id} className={problem ? "has-problem graphic-problem" : ""}>
                  <button type="button" className="structure-row graphic-row" onClick={() => onReveal(graphic.id, t(language, "announce.showGraphic", { name: getGraphicDisplayName(graphic, language) }))}>
                    {graphic.thumbnailSrc ? (
                      <span className="image-thumb" aria-hidden="true">
                        <img src={graphic.thumbnailSrc} alt="" loading="lazy" />
                      </span>
                    ) : null}
                    <span className="level">{getGraphicTypeLabel(graphic)}</span>
                    <span className={problem ? "item-text issue-text" : "item-text"}>{getGraphicDisplayName(graphic, language)}</span>
                    {problem ? <span className="issue-badge">{getGraphicIssueLabel(graphic, language)}</span> : null}
                    <span className="row-action">{actionLabel}</span>
                    {getGraphicMetaText(graphic, language) ? <span className="meta-text row-meta">{getGraphicMetaText(graphic, language)}</span> : null}
                    <ScopeMeta scope={graphic.scope} language={language} />
                  </button>
                  {problem ? <p className="problem">{localizeProblem(problem, language)}</p> : null}
                </li>
              );
            }}
          />
          <CopyListButton text={formatGraphicExport(filteredGraphics, language)} language={language} />
        </>
      )}
    </section>
  );
}

function GraphicFilterLabel({ label, count, language }: { label: string; count: number; language: PanelLanguage }) {
  return (
    <span>
      {label} <span className="filter-count" aria-hidden="true">({count})</span>
      <span className="sr-only"> {count} {getItemWord(language, count)}</span>
    </span>
  );
}

function ScopeMeta({ scope, language }: { scope?: string; language: PanelLanguage }) {
  if (!scope) {
    return null;
  }

  return (
    <span className="row-meta">
      {t(language, "export.field.scope")}: <code>{scope}</code>
    </span>
  );
}

function ScopeText({ scope, language }: { scope?: string; language: PanelLanguage }) {
  if (!scope) {
    return null;
  }

  return <p className="scope-text">{t(language, "export.field.scope")}: {scope}</p>;
}

function getGraphicFilterKey(graphic: GraphicItem): GraphicFilterKey {
  if (graphic.status === "decorative") {
    return "decorative";
  }

  return graphic.name ? "named" : "unnamed";
}

function getGraphicDisplayName(graphic: GraphicItem, language: PanelLanguage) {
  if (graphic.status === "decorative") {
    return t(language, "graphics.markedDecorative");
  }

  if (graphic.status === "missing-alt") {
    return t(language, "graphics.missingAlt");
  }

  return graphic.name || t(language, "common.noAccessibleName");
}

function getGraphicIssueLabel(graphic: GraphicItem, language: PanelLanguage) {
  if (graphic.status === "missing-alt") {
    return t(language, "graphics.missingAltShort");
  }

  return t(language, "graphics.unnamedShort");
}

function getGraphicProblem(graphic: GraphicItem) {
  if (graphic.problem) {
    return graphic.problem;
  }

  if (graphic.status !== "decorative" && !graphic.name) {
    return "No accessible name found. This is only appropriate when the graphic is decorative or redundant.";
  }

  return null;
}

function TableList({
  tables,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  tables: TableItem[];
  onReveal: (elementId: string, announcement?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  if (tables.length === 0) {
    return <EmptyState title={t(language, "empty.tables")} />;
  }

  return (
    <section aria-labelledby="tables-title">
      <h2 id="tables-title" className="section-title">{t(language, "tables.title")}</h2>
      <div className="tool-explanation">
        <p>{t(language, "tables.explain1")}</p>
      </div>
      <PaginatedList
        items={tables}
        resultsPerPage={resultsPerPage}
        language={language}
        listClassName="structure-list"
        pageIndex={pageIndex}
        onPageIndexChange={onPageIndexChange}
        renderItem={(table, index) => {
          const label = getTableDisplayName(table, index, language);

          return (
            <li key={table.id} className="table-structure-item">
              <button
                type="button"
                className="structure-row table-row"
                onClick={() => onReveal(table.id, t(language, "announce.showTable", { name: label }))}
              >
                <span className="level">{table.role}</span>
                <span className="item-text">{label}</span>
                <span className="row-action">{actionLabel}</span>
                <span className="row-meta">
                  {t(language, "export.field.source")}: <code>{table.source}</code>
                </span>
                <ScopeMeta scope={table.scope} language={language} />
              </button>
              <p className="table-summary">
                <span>{t(language, "tables.rows")}: <strong>{table.rowCount}</strong></span>
                <span>{t(language, "tables.columns")}: <strong>{table.columnCount}</strong></span>
                <span>{t(language, "tables.headers")}: <strong>{table.headerCellCount}</strong></span>
                <span>{t(language, "tables.dataCells")}: <strong>{table.dataCellCount}</strong></span>
              </p>
              {table.cells.length > 0 ? (
                <details className="table-cells">
                  <summary>{t(language, "tables.cells", { count: table.cells.length })}</summary>
                  <ol>
                    {table.cells.map((cell) => (
                      <li key={cell.id}>
                        <button
                          type="button"
                          onClick={() => onReveal(cell.id, t(language, "announce.showTableCell", { name: getTableCellDisplayName(cell, language) }))}
                        >
                          <span className={`table-cell-kind ${isHeaderTableCell(cell) ? "is-header" : "is-data"}`}>
                            {isHeaderTableCell(cell) ? "TH" : "TD"}
                          </span>
                          <span>{getTableCellDisplayName(cell, language)}</span>
                          <span className="row-meta">
                            {t(language, "tables.position", { row: cell.rowIndex, column: cell.columnIndex })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </li>
          );
        }}
      />
      <CopyListButton text={formatTableExport(tables, language)} language={language} />
    </section>
  );
}

function getTableDisplayName(table: TableItem, index: number, language: PanelLanguage) {
  return table.caption || table.name || t(language, "tables.item", { count: index + 1 });
}

function getTableCellDisplayName(cell: TableItem["cells"][number], language: PanelLanguage) {
  return cell.text || t(language, isHeaderTableCell(cell) ? "tables.unnamedHeader" : "tables.unnamedCell");
}

function isHeaderTableCell(cell: TableItem["cells"][number]) {
  return cell.role === "columnheader" || cell.role === "rowheader";
}

function getGraphicTypeLabel(graphic: GraphicItem) {
  return graphic.source.replace(/^role="(.+)"$/, "$1");
}

function getGraphicMetaText(graphic: GraphicItem, language: PanelLanguage) {
  if (graphic.status === "missing-alt") {
    return t(language, "graphics.missingAltAttr");
  }

  return "";
}

function AriaLabelList({
  labels,
  onReveal,
  actionLabel,
  language,
  resultsPerPage,
  pageIndex,
  onPageIndexChange
}: {
  labels: AriaLabelItem[];
  onReveal: (elementId: string, announcement?: string) => void;
  actionLabel: string;
  language: PanelLanguage;
  resultsPerPage: ResultsPerPage;
  pageIndex: number;
  onPageIndexChange: (pageIndex: number) => void;
}) {
  if (labels.length === 0) {
    return <EmptyState title={t(language, "empty.ariaLabels")} />;
  }

  return (
    <section aria-labelledby="aria-labels-title">
      <h2 id="aria-labels-title" className="section-title">{t(language, "aria.title")}</h2>
      <div className="tool-explanation">
        <p>
          {t(language, "aria.explain1")}
        </p>
        <p>
          {t(language, "aria.explain2")}
        </p>
      </div>
      <PaginatedList
        items={labels}
        resultsPerPage={resultsPerPage}
        language={language}
        listClassName="structure-list"
        pageIndex={pageIndex}
        onPageIndexChange={onPageIndexChange}
        renderItem={(label) => (
          <li key={label.id} className={label.problem ? "has-problem" : ""}>
            <button type="button" className="structure-row" onClick={() => onReveal(label.id, t(language, "announce.showAria", { role: label.role, name: label.name ? `: ${label.name}` : "" }))}>
              <span className="level">{label.role}</span>
              <span className="item-text">{label.name || t(language, "common.noAccessibleName")}</span>
              {label.problem ? <span className="issue-badge">{t(language, "common.issue")}</span> : null}
              <span className="row-action">{actionLabel}</span>
              <span className="meta-text row-meta">{label.source}</span>
              <ScopeMeta scope={label.scope} language={language} />
            </button>
            {label.problem ? <p className="problem">{localizeProblem(label.problem, language)}</p> : null}
          </li>
        )}
      />
      <CopyListButton text={formatAriaLabelExport(labels, language)} language={language} />
    </section>
  );
}

function ContrastChecker({
  textColor,
  backgroundColor,
  pickerStatus,
  onTextColorChange,
  onBackgroundColorChange,
  onPickColor,
  language
}: {
  textColor: string;
  backgroundColor: string;
  pickerStatus: string;
  onTextColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onPickColor: (target: ContrastColorTarget) => void;
  language: PanelLanguage;
}) {
  const textColorId = useId();
  const backgroundColorId = useId();
  const statusId = useId();
  const [textHexValue, setTextHexValue] = useState(textColor);
  const [backgroundHexValue, setBackgroundHexValue] = useState(backgroundColor);
  const contrastRatio = getContrastRatio(textColor, backgroundColor);
  const formattedRatio = formatContrastRatio(contrastRatio);
  const results = [
    { key: "normal-aa", label: t(language, "contrast.normalAa"), threshold: 4.5, passes: contrastRatio >= 4.5 },
    { key: "large-aa", label: t(language, "contrast.largeAa"), threshold: 3, passes: contrastRatio >= 3 },
    { key: "normal-aaa", label: t(language, "contrast.normalAaa"), threshold: 7, passes: contrastRatio >= 7 },
    { key: "large-aaa", label: t(language, "contrast.largeAaa"), threshold: 4.5, passes: contrastRatio >= 4.5 }
  ];
  const failedResults = results.filter((result) => !result.passes);

  function handleTextColorChange(color: string) {
    setTextHexValue(color);
  }

  function handleBackgroundColorChange(color: string) {
    setBackgroundHexValue(color);
  }

  function commitTextColor(color: string) {
    const normalized = normalizeColorInput(color);
    setTextHexValue(normalized);
    onTextColorChange(normalized);
  }

  function commitBackgroundColor(color: string) {
    const normalized = normalizeColorInput(color);
    setBackgroundHexValue(normalized);
    onBackgroundColorChange(normalized);
  }

  function handleColorTextKeyDown(event: React.KeyboardEvent<HTMLInputElement>, target: ContrastColorTarget) {
    if (event.key !== "Enter") {
      return;
    }

    if (target === "text") {
      commitTextColor(event.currentTarget.value);
      return;
    }

    commitBackgroundColor(event.currentTarget.value);
  }

  function handleColorTextPaste(event: React.ClipboardEvent<HTMLInputElement>, target: ContrastColorTarget) {
    const pastedValue = event.clipboardData.getData("text");

    if (!pastedValue) {
      return;
    }

    event.preventDefault();

    if (target === "text") {
      commitTextColor(pastedValue);
      return;
    }

    commitBackgroundColor(pastedValue);
  }

  function handleReverseColors() {
    setTextHexValue(backgroundColor);
    setBackgroundHexValue(textColor);
    onTextColorChange(backgroundColor);
    onBackgroundColorChange(textColor);
  }

  useEffect(() => {
    setTextHexValue(textColor);
  }, [textColor]);

  useEffect(() => {
    setBackgroundHexValue(backgroundColor);
  }, [backgroundColor]);

  return (
    <section aria-labelledby="contrast-title">
      <div className="contrast-header">
        <h2 id="contrast-title" className="section-title">{t(language, "contrast.title")}</h2>
        <p>{t(language, "contrast.explain1")}</p>
      </div>

      <div className="contrast-tool">
        <div className="contrast-fields">
          <div className="field color-field">
            <label htmlFor={textColorId}>{t(language, "contrast.textColor")}</label>
            <input
              id={textColorId}
              type="color"
              value={getColorInputValue(textColor)}
              onChange={(event) => {
                setTextHexValue(event.currentTarget.value);
                onTextColorChange(event.currentTarget.value);
              }}
            />
            <input
              className="color-value"
              type="text"
              value={textHexValue}
              aria-label={t(language, "contrast.hexInputLabel", { color: t(language, "contrast.textColor") })}
              inputMode="text"
              spellCheck={false}
              onChange={(event) => handleTextColorChange(event.currentTarget.value)}
              onBlur={(event) => commitTextColor(event.currentTarget.value)}
              onKeyDown={(event) => handleColorTextKeyDown(event, "text")}
              onPaste={(event) => handleColorTextPaste(event, "text")}
            />
            <button type="button" className="secondary-action color-pick-action" onClick={() => onPickColor("text")}>
              <Pipette aria-hidden="true" size={18} />
              {t(language, "contrast.pickText")}
            </button>
          </div>

          <button type="button" className="color-swap-action" onClick={handleReverseColors} aria-label={t(language, "contrast.reverseColors")}>
            <ArrowLeftRight aria-hidden="true" size={18} />
          </button>

          <div className="field color-field">
            <label htmlFor={backgroundColorId}>{t(language, "contrast.backgroundColor")}</label>
            <input
              id={backgroundColorId}
              type="color"
              value={getColorInputValue(backgroundColor)}
              onChange={(event) => {
                setBackgroundHexValue(event.currentTarget.value);
                onBackgroundColorChange(event.currentTarget.value);
              }}
            />
            <input
              className="color-value"
              type="text"
              value={backgroundHexValue}
              aria-label={t(language, "contrast.hexInputLabel", { color: t(language, "contrast.backgroundColor") })}
              inputMode="text"
              spellCheck={false}
              onChange={(event) => handleBackgroundColorChange(event.currentTarget.value)}
              onBlur={(event) => commitBackgroundColor(event.currentTarget.value)}
              onKeyDown={(event) => handleColorTextKeyDown(event, "background")}
              onPaste={(event) => handleColorTextPaste(event, "background")}
            />
            <button type="button" className="secondary-action color-pick-action" onClick={() => onPickColor("background")}>
              <Pipette aria-hidden="true" size={18} />
              {t(language, "contrast.pickBackground")}
            </button>
          </div>
        </div>

        <div className="contrast-preview" style={{ color: textColor, backgroundColor }}>
          <span>"{t(language, "contrast.previewText")}"</span>
        </div>

        <div className="contrast-result" aria-live="polite" aria-atomic="true">
          <p className="contrast-ratio">
            <span>{t(language, "contrast.ratio")}</span>
            <strong>{formattedRatio}:1</strong>
          </p>
          <p className={`contrast-level-summary ${failedResults.length > 0 ? "fails" : "passes"}`}>
            {failedResults.length > 0
              ? t(language, "contrast.failSummary", { levels: failedResults.map((result) => result.label).join(", ") })
              : t(language, "contrast.passSummary")}
          </p>
          <ul className="contrast-checks">
            {results.map((result) => (
              <li key={result.key} className={result.passes ? "passes" : "fails"}>
                <span className="contrast-check__label">{result.label}</span>
                <span className="contrast-check__status">
                  <span aria-hidden="true">{result.passes ? "✓" : "!"}</span>
                  <strong>{t(language, result.passes ? "contrast.pass" : "contrast.fail")}</strong>
                </span>
                <span className="contrast-check__requirement">
                  {t(language, "contrast.requires", { ratio: formatContrastRatio(result.threshold) })}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {pickerStatus ? <p id={statusId} className="sr-only" aria-live="polite">{pickerStatus}</p> : null}
      </div>
    </section>
  );
}

function TextResizeTool({
  simulation,
  language,
  onScaleChange
}: {
  simulation: TextResizeSimulation;
  language: PanelLanguage;
  onScaleChange: (scale: number) => void;
}) {
  const scaleId = useId();
  const presetLabel = t(language, "textResize.presets");

  return (
    <section aria-labelledby="text-resize-title">
      <h2 id="text-resize-title" className="section-title">{t(language, "textResize.title")}</h2>

      <div className="text-resize-tool">
        <div className="text-resize-scale">
          <div className="text-resize-scale__header">
            <label htmlFor={scaleId}>{t(language, "textResize.scale")}</label>
            <strong>{t(language, "textResize.percent", { scale: simulation.scale })}</strong>
          </div>
          <input
            id={scaleId}
            type="range"
            min={TEXT_RESIZE_MIN_SCALE}
            max={TEXT_RESIZE_MAX_SCALE}
            step={TEXT_RESIZE_STEP}
            value={simulation.scale}
            onChange={(event) => onScaleChange(normalizeTextResizeScale(event.currentTarget.value))}
          />
          <div className="text-resize-markers" aria-hidden="true">
            <span>{t(language, "textResize.marker.base")}</span>
            <span className="text-resize-markers__wcag">{t(language, "textResize.marker.wcag")}</span>
            <span>{t(language, "textResize.marker.max")}</span>
          </div>
        </div>

        <div className="text-resize-presets" role="group" aria-label={presetLabel}>
          {TEXT_RESIZE_PRESETS.map((scale) => (
            <button
              key={scale}
              type="button"
              className={`secondary-action text-resize-preset${simulation.scale === scale ? " is-active" : ""}`}
              aria-pressed={simulation.scale === scale}
              onClick={() => onScaleChange(scale)}
            >
              {scale === 200
                ? t(language, "textResize.preset.wcag")
                : t(language, "textResize.preset.percent", { scale })}
            </button>
          ))}
        </div>

        <div className="text-resize-wcag-note">
          <strong>{t(language, "textResize.wcagBadge")}</strong>
          <span>{t(language, "textResize.wcagNote")}</span>
        </div>

        <div className="tool-explanation">
          <p>{t(language, "textResize.explain1")}</p>
          <p>{t(language, "textResize.explain2")}</p>
        </div>

        <section className="text-resize-checklist" aria-labelledby="text-resize-test-title">
          <h3 id="text-resize-test-title">{t(language, "textResize.testTitle")}</h3>
          <ul>
            <li>{t(language, "textResize.test.step200")}</li>
            <li>{t(language, "textResize.test.step400")}</li>
            <li>{t(language, "textResize.test.noBreakage")}</li>
            <li>{t(language, "textResize.test.usable")}</li>
            <li>{t(language, "textResize.test.finalZoom")}</li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function LinearViewInfo({ items, language }: { items: LinearSemanticItem[]; language: PanelLanguage }) {
  return (
    <section aria-labelledby="linear-view-title">
      <h2 id="linear-view-title" className="section-title">{t(language, "linear.title")}</h2>
      <div className="tool-explanation">
        <p>
          {t(language, "linear.explain1")}
        </p>
        <p>
          {t(language, "linear.explain2")}
        </p>
      </div>
      <p className="result-summary">{t(language, "linear.summary", { count: items.length, item: getItemWord(language, items.length) })}</p>
      {items.length > 0 ? <CopyListButton text={formatLinearExport(items, language)} language={language} /> : null}
    </section>
  );
}

function InteractiveBrowserInfo({ items, language }: { items: InteractiveItem[]; language: PanelLanguage }) {
  const count = items.length;

  return (
    <section aria-labelledby="interactive-browser-title">
      <h2 id="interactive-browser-title" className="section-title">{t(language, "interactive.title")}</h2>
      <div className="tool-explanation">
        <p>
          {t(language, "interactive.explain1")}
        </p>
        <p>
          {t(language, "interactive.explain2")}
        </p>
      </div>
      <p className="result-summary">{t(language, "interactive.summary", { count, item: getItemWord(language, count) })}</p>
      {items.length > 0 ? <CopyListButton text={formatInteractiveExport(items, language)} language={language} /> : null}
    </section>
  );
}

function InteractiveHighlightInfo({ items, language }: { items: InteractiveItem[]; language: PanelLanguage }) {
  const count = items.length;

  return (
    <section aria-labelledby="interactive-highlight-title">
      <h2 id="interactive-highlight-title" className="section-title">{t(language, "interactive.highlight.title")}</h2>
      <div className="tool-explanation">
        <p>
          {t(language, "interactive.highlight.explain1")}
        </p>
      </div>
      <p className="result-summary">{t(language, "interactive.highlight.summary", { count, item: getItemWord(language, count) })}</p>
      {items.length > 0 ? <CopyListButton text={formatInteractiveExport(items, language)} language={language} /> : null}
    </section>
  );
}

function formatHeadingExport(headings: HeadingItem[], language: PanelLanguage) {
  return formatExportText(t(language, "headings.title"), headings.map((heading) => {
    const lines = [
      exportField(language, "level", `h${heading.level}`),
      exportField(language, "text", heading.text || t(language, "common.noAccessibleName")),
      exportField(language, "role", heading.role),
      exportField(language, "source", heading.source),
      exportField(language, "scope", heading.scope ?? ""),
      exportField(language, "selector", heading.selector)
    ];

    appendProblem(lines, heading.problem, language);
    return formatExportRecord(`h${heading.level}`, lines);
  }));
}

function formatLandmarkExport(items: LandmarkStructureItem[], language: PanelLanguage) {
  return formatExportText(t(language, "landmarks.title"), items.map((item) => {
    if (item.type === "content") {
      return formatExportRecord(t(language, "landmarks.gap"), [
        exportField(language, "status", t(language, "common.issue")),
      exportField(language, "depth", String(item.depth)),
      exportField(language, "elementCount", String(item.elementIds.length)),
      exportField(language, "scope", item.scope ?? ""),
      ...(item.snippets.length > 0 ? [exportField(language, "content", item.snippets.join("; "))] : []),
        exportField(language, "issue", localizeProblem(item.problem, language))
      ]);
    }

    const lines = [
      exportField(language, "role", item.role),
      exportField(language, "name", item.name || t(language, "common.noAccessibleName")),
      exportField(language, "text", item.label || ""),
      exportField(language, "source", item.source),
      exportField(language, "depth", String(item.depth)),
      exportField(language, "scope", item.scope ?? ""),
      exportField(language, "selector", item.selector)
    ];

    appendProblem(lines, item.problem, language);
    return formatExportRecord(item.label || item.role, lines);
  }));
}

function formatLiveRegionExport(regions: LiveRegionItem[], language: PanelLanguage) {
  return formatExportText(t(language, "live.title"), regions.map((region) => {
    const notes = getLiveRegionBehaviorNotes(region, language).join("; ");
    const lines = [
      exportField(language, "present", t(language, region.present ? "common.on" : "common.off")),
      exportField(language, "politeness", region.politeness),
      exportField(language, "role", region.role),
      exportField(language, "ariaLive", region.ariaLive),
      exportField(language, "ariaAtomic", region.ariaAtomic),
      exportField(language, "ariaRelevant", region.ariaRelevant),
      exportField(language, "ariaBusy", region.ariaBusy),
      exportField(language, "scope", region.scope ?? ""),
      exportField(language, "selector", region.selector),
      exportField(language, "path", region.path),
      exportField(language, "detail", notes),
      exportField(language, "messages", String(region.messages.length))
    ];

    if (region.duplicatePosition) {
      lines.push(exportField(language, "issue", t(language, "live.duplicateProblem")));
    }

    return formatExportRecord(region.label, lines);
  }));
}

function formatGraphicExport(graphics: GraphicItem[], language: PanelLanguage) {
  return formatExportText(t(language, "graphics.title"), graphics.map((graphic) => {
    const lines = [
      exportField(language, "role", graphic.role),
      exportField(language, "name", graphic.name || t(language, "common.noAccessibleName")),
      exportField(language, "status", getGraphicDisplayName(graphic, language)),
      exportField(language, "source", graphic.source),
      exportField(language, "scope", graphic.scope ?? ""),
      exportField(language, "selector", graphic.selector)
    ];

    const metaText = getGraphicMetaText(graphic, language);
    if (metaText) {
      lines.push(exportField(language, "detail", metaText));
    }

    appendProblem(lines, getGraphicProblem(graphic), language);
    return formatExportRecord(getGraphicTypeLabel(graphic), lines);
  }));
}

function formatTableExport(tables: TableItem[], language: PanelLanguage) {
  return formatExportText(t(language, "tables.title"), tables.map((table, index) => {
    const lines = [
      exportField(language, "role", table.role),
      exportField(language, "name", table.name || table.caption || t(language, "common.noAccessibleName")),
      exportField(language, "source", table.source),
      exportField(language, "rows", String(table.rowCount)),
      exportField(language, "columns", String(table.columnCount)),
      exportField(language, "headers", String(table.headerCellCount)),
      exportField(language, "dataCells", String(table.dataCellCount)),
      exportField(language, "scope", table.scope ?? ""),
      exportField(language, "selector", table.selector)
    ];
    const cellLines = table.cells.map((cell) => (
      `${isHeaderTableCell(cell) ? "TH" : "TD"} ${cell.rowIndex},${cell.columnIndex}: ${getTableCellDisplayName(cell, language)}`
    ));

    if (cellLines.length > 0) {
      lines.push(exportField(language, "cells", cellLines.join("; ")));
    }

    return formatExportRecord(getTableDisplayName(table, index, language), lines);
  }));
}

function formatAriaLabelExport(labels: AriaLabelItem[], language: PanelLanguage) {
  return formatExportText(t(language, "aria.title"), labels.map((label) => {
    const lines = [
      exportField(language, "role", label.role),
      exportField(language, "name", label.name || t(language, "common.noAccessibleName")),
      exportField(language, "source", label.source),
      exportField(language, "scope", label.scope ?? ""),
      exportField(language, "selector", label.selector)
    ];

    appendProblem(lines, label.problem, language);
    return formatExportRecord(label.role, lines);
  }));
}

function formatLinearExport(items: LinearSemanticItem[], language: PanelLanguage) {
  return formatExportText(t(language, "linear.title"), items.map((item) => {
    const listPosition = getLinearListPositionText(item);

    return formatExportRecord(listPosition ? `${item.role} ${listPosition}` : item.role, [
      exportField(language, "role", item.role),
      ...(listPosition ? [exportField(language, "position", listPosition)] : []),
      exportField(language, "name", item.name),
      exportField(language, "detail", item.detail),
      exportField(language, "scope", item.scope ?? ""),
      exportField(language, "depth", String(item.depth))
    ]);
  }));
}

function getLinearListPositionText(item: LinearSemanticItem) {
  if (item.role !== "listitem" || !item.listPosition || !item.listSize) {
    return "";
  }

  return `${item.listPosition} out of ${item.listSize}`;
}

function formatInteractiveExport(items: InteractiveItem[], language: PanelLanguage) {
  return formatExportText(t(language, "interactive.title"), items.map((item) => (
    formatExportRecord(item.name || item.role, [
      exportField(language, "role", item.role),
      exportField(language, "name", item.name || t(language, "common.noAccessibleName")),
      exportField(language, "detail", item.detail),
      exportField(language, "exposed", t(language, item.exposed ? "common.on" : "common.off")),
      exportField(language, "scope", item.scope ?? ""),
      exportField(language, "selector", item.selector)
    ])
  )));
}

function getContrastRatio(firstColor: string, secondColor: string) {
  const first = hexToRgb(firstColor);
  const second = hexToRgb(secondColor);

  if (!first || !second) {
    return 1;
  }

  const firstLuminance = getRelativeLuminance(first);
  const secondLuminance = getRelativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance({ r, g, b }: { r: number; g: number; b: number }) {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hexToRgb(value: string) {
  const hex = normalizeColorInput(value);

  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
}

function normalizeColorInput(value: string) {
  return parseHexColor(value) ?? parseRgbColor(value) ?? parseHslColor(value) ?? parseCssColorName(value) ?? "#000000";
}

function getColorInputValue(value: string) {
  return normalizeColorInput(value).toLowerCase();
}

function parseHexColor(value: string) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s+/g, "");
  const shorthand = compact.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);

  if (shorthand) {
    return `#${shorthand.slice(1).map((part) => part.repeat(2)).join("")}`;
  }

  const full = compact.match(/^#?([a-f\d]{6})$/i);
  return full ? `#${full[1]}` : null;
}

function parseRgbColor(value: string) {
  const match = value.trim().match(/^rgba?\((.+)\)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .replace(/\s*\/\s*/g, " ")
    .split(/[,\s]+/)
    .filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const channels = parts.slice(0, 3).map(parseRgbChannel);
  return channels.every((channel) => channel !== null)
    ? rgbToHex(channels[0] as number, channels[1] as number, channels[2] as number)
    : null;
}

function parseRgbChannel(value: string) {
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percent) ? clampColorChannel((percent / 100) * 255) : null;
  }

  const channel = Number.parseFloat(value);
  return Number.isFinite(channel) ? clampColorChannel(channel) : null;
}

function parseHslColor(value: string) {
  const match = value.trim().match(/^hsla?\((.+)\)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .replace(/\s*\/\s*/g, " ")
    .split(/[,\s]+/)
    .filter(Boolean);

  if (parts.length < 3 || !parts[1].endsWith("%") || !parts[2].endsWith("%")) {
    return null;
  }

  const hue = parseHue(parts[0]);
  const saturation = Number.parseFloat(parts[1].slice(0, -1)) / 100;
  const lightness = Number.parseFloat(parts[2].slice(0, -1)) / 100;

  if (![hue, saturation, lightness].every(Number.isFinite)) {
    return null;
  }

  return hslToHex(hue, saturation, lightness);
}

function parseCssColorName(value: string) {
  const name = value.trim().toLowerCase();

  if (!/^[a-z]+$/i.test(name) || name === "transparent" || name === "currentcolor") {
    return null;
  }

  const parser = document.createElement("span");
  parser.style.color = "";
  parser.style.color = name;

  if (!parser.style.color) {
    return null;
  }

  document.body.append(parser);
  const computedColor = getComputedStyle(parser).color;
  parser.remove();

  return parseRgbColor(computedColor);
}

function parseHue(value: string) {
  const hue = Number.parseFloat(value);

  if (!Number.isFinite(hue)) {
    return Number.NaN;
  }

  if (value.endsWith("turn")) {
    return hue * 360;
  }

  if (value.endsWith("rad")) {
    return hue * (180 / Math.PI);
  }

  return hue;
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const clampedSaturation = Math.max(0, Math.min(1, saturation));
  const clampedLightness = Math.max(0, Math.min(1, lightness));
  const chroma = (1 - Math.abs(2 * clampedLightness - 1)) * clampedSaturation;
  const huePrime = normalizedHue / 60;
  const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = clampedLightness - chroma / 2;
  const [red, green, blue] = getHslRgbComponents(huePrime, chroma, secondComponent)
    .map((channel) => clampColorChannel((channel + match) * 255));

  return rgbToHex(red, green, blue);
}

function getHslRgbComponents(huePrime: number, chroma: number, secondComponent: number) {
  if (huePrime < 1) return [chroma, secondComponent, 0];
  if (huePrime < 2) return [secondComponent, chroma, 0];
  if (huePrime < 3) return [0, chroma, secondComponent];
  if (huePrime < 4) return [0, secondComponent, chroma];
  if (huePrime < 5) return [secondComponent, 0, chroma];
  return [chroma, 0, secondComponent];
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0")).join("")}`;
}

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function formatContrastRatio(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatExportText(title: string, records: string[]) {
  return [`# ${title}`, "", ...records.map((record) => `- ${record}`)].join("\n");
}

function formatExportRecord(label: string, lines: string[]) {
  const nonEmptyLines = lines.filter(Boolean);
  return [label || "—", ...nonEmptyLines.map((line) => `  - ${line}`)].join("\n");
}

function formatSnippetList(snippets: string[], language: PanelLanguage) {
  return formatList(language, snippets.map((snippet) => `“${snippet}”`));
}

function exportField(language: PanelLanguage, key: string, value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return "";
  }

  return `${t(language, `export.field.${key}`)}: ${normalizedValue}`;
}

function appendProblem(lines: string[], problem: string | null, language: PanelLanguage) {
  if (problem) {
    lines.push(exportField(language, "issue", localizeProblem(problem, language)));
  }
}

function EmptyState({ title }: { title: string }) {
  return (
    <section className="empty-state" aria-live="polite" aria-atomic="true">
      <p>{title}</p>
    </section>
  );
}

function getDevToolsAnnouncement(announcement: string, language = "en") {
  return t(language, "announce.devtools", {
    announcement: announcement.replace(/\.$/, "")
  });
}

function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME_PREFERENCE;
}

function getLanguageOptionLabel(
  language: { code: string; label: string; englishLabel?: string },
  resolvedLanguage: PanelLanguage
) {
  if (language.code === "system") {
    const systemLabel = t(resolvedLanguage, "common.system");
    return resolvedLanguage === "en" ? systemLabel : `${systemLabel} (System language)`;
  }

  if (resolvedLanguage === "en" || language.code === "en" || !language.englishLabel) {
    return language.label;
  }

  return `${language.label} (${language.englishLabel})`;
}

function normalizeResultsPerPage(value: unknown): ResultsPerPage {
  const numericValue = typeof value === "number" ? value : Number(value);
  return RESULTS_PER_PAGE_OPTIONS.includes(numericValue as ResultsPerPage)
    ? numericValue as ResultsPerPage
    : DEFAULT_RESULTS_PER_PAGE;
}

function normalizeThumbnailSize(value: unknown): ThumbnailSize {
  return THUMBNAIL_SIZE_OPTIONS.includes(value as ThumbnailSize)
    ? value as ThumbnailSize
    : DEFAULT_THUMBNAIL_SIZE;
}

function getFeedbackEmailHref(language: PanelLanguage, theme: ResolvedTheme, pageUrl: string) {
  const context = getFeedbackContext(language, theme, pageUrl);
  const subject = t(language, "feedback.emailSubject");
  const body = t(language, "feedback.emailBody", context);

  return `mailto:support@forlaens.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function getFeedbackContext(language: PanelLanguage, theme: ResolvedTheme, pageUrl: string) {
  const runtime = globalThis.chrome?.runtime;
  const manifest = runtime?.getManifest?.();
  const unknown = t(language, "common.unknown");
  const screenInfo = globalThis.screen
    ? `${globalThis.screen.width} x ${globalThis.screen.height}; ${t(language, "feedback.screenAvailable")} ${globalThis.screen.availWidth} x ${globalThis.screen.availHeight}`
    : unknown;
  const viewportInfo = `${globalThis.innerWidth ?? unknown} x ${globalThis.innerHeight ?? unknown}`;
  const themeLabel = theme === "dark" ? t(language, "settings.theme.dark") : t(language, "settings.theme.light");

  return {
    version: manifest?.version ?? unknown,
    language: globalThis.document?.documentElement?.lang || unknown,
    theme: themeLabel,
    pageUrl: pageUrl || unknown,
    userAgent: globalThis.navigator?.userAgent ?? unknown,
    platform: globalThis.navigator?.platform ?? unknown,
    languages: globalThis.navigator?.languages?.join(", ") || globalThis.navigator?.language || unknown,
    screen: screenInfo,
    viewport: viewportInfo,
    devicePixelRatio: String(globalThis.devicePixelRatio ?? unknown),
    timestamp: new Date().toISOString()
  };
}

function getPanelStatusText(status: string, progress: ScanProgress | null, language: PanelLanguage) {
  if (progress) {
    return getScanProgressTitle(progress, language);
  }

  return localizeStatus(status, language);
}

function localizeStatus(status: string, language: PanelLanguage) {
  const normalized = status.trim().toLowerCase();

  for (const key of STATUS_KEYS) {
    if (normalized === t("en", key).toLowerCase()) {
      return t(language, key);
    }

    for (const supportedLanguage of SUPPORTED_LANGUAGES) {
      if (normalized === t(supportedLanguage.code, key).toLowerCase()) {
        return t(language, key);
      }
    }
  }

  const scanProblemSummary = localizeScanProblemSummaryStatus(status, language);
  if (scanProblemSummary) {
    return scanProblemSummary;
  }

  return status;
}

function localizeScanProblemSummaryStatus(status: string, language: PanelLanguage) {
  const trimmed = status.trim();
  const normalized = trimmed.toLowerCase();

  for (const supportedLanguage of SUPPORTED_LANGUAGES) {
    if (normalized === t(supportedLanguage.code, "scan.progress.problem.one").toLowerCase()) {
      return t(language, "scan.progress.problem.one");
    }

    const count = getTemplateCount(trimmed, t(supportedLanguage.code, "scan.progress.problem.other", { count: "{count}" }));
    if (count !== null) {
      return t(language, "scan.progress.problem.other", { count });
    }
  }

  return "";
}

function getTemplateCount(value: string, template: string) {
  if (!template.includes("{count}")) {
    return null;
  }

  const pattern = template
    .split("{count}")
    .map(escapeRegExp)
    .join("(\\d+)");
  const match = value.match(new RegExp(`^${pattern}$`, "i"));
  return match ? Number(match[1]) : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localizeProblem(problem: string, language: PanelLanguage) {
  const headingJump = problem.match(/^Heading level jumps from h(\d) to h(\d)\.$/);
  if (headingJump) {
    return t(language, "problem.headingJump", { from: headingJump[1], to: headingJump[2] });
  }

  const unnamedLandmarks = problem.match(/^Multiple (.+) landmarks are unnamed\./);
  if (unnamedLandmarks) {
    return t(language, "problem.unnamedLandmarks", { role: unnamedLandmarks[1] });
  }

  if (problem.startsWith("Missing alt attribute.")) {
    return t(language, "problem.missingAlt");
  }

  if (problem.startsWith("No accessible name found.")) {
    return t(language, "problem.unnamedGraphic");
  }

  if (problem.startsWith("Content is outside landmarks.")) {
    return t(language, "problem.outsideLandmark");
  }

  if (problem.startsWith("ARIA naming is present")) {
    return t(language, "problem.ariaNameMissing");
  }

  return problem;
}

function getSystemTheme(): ResolvedTheme {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getLiveRegionCaptionsAnnouncement(enabled: boolean, count: number, language: PanelLanguage) {
  return enabled
    ? t(language, "announce.caption.on", { countText: formatCount(language, count, "count.liveRegion") })
    : t(language, "announce.caption.off");
}

function getTextResizeSimulationAnnouncement(simulation: TextResizeSimulation, language: PanelLanguage) {
  if (!simulation.enabled) {
    return t(language, "announce.textResize.off");
  }

  return simulation.scale === 200
    ? t(language, "announce.textResize.wcag", { scale: simulation.scale })
    : t(language, "announce.textResize.on", { scale: simulation.scale });
}

function getSemanticLinearViewAnnouncement(enabled: boolean, count: number, language: PanelLanguage) {
  return enabled
    ? t(language, "announce.linear.on", { countText: formatCount(language, count, "count.semantic") })
    : t(language, "announce.linear.off");
}

function getInteractiveNavigatorAnnouncement(enabled: boolean, count: number, language: PanelLanguage) {
  return enabled
    ? t(language, "announce.interactive.on", { countText: formatCount(language, count, "count.keyboard") })
    : t(language, "announce.interactive.off");
}

function getInteractiveNavigatorMoveAnnouncement(state: InteractiveNavigatorState, language: PanelLanguage) {
  if (state.count === 0) {
    return t(language, "announce.navigator.none");
  }

  const position = t(language, "announce.navigator.position", { position: state.index + 1, count: state.count });
  const label = state.currentLabel.trim();
  const mainMessage = label ? `${position}: ${label}.` : `${position}.`;

  if (!state.currentHidden) {
    return mainMessage;
  }

  return `${mainMessage} ${t(language, "announce.navigator.hidden")}`;
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<App />);
}
