import {
  DEFAULT_LIVE_REGION_CAPTION_SETTINGS,
  normalizeLiveRegionCaptionSettings
} from "../shared/live-region-caption-settings.js";
import { CONTENT_VERSION } from "../shared/content-version.js";
import {
  getPageKey,
  getPageScopedValue,
  migratePageScopedValue
} from "./page-state.js";

const LIVE_REGION_CAPTION_SETTINGS_KEY = "liveRegionCaptionSettings";
const HIGHLIGHT_SETTINGS_KEY = "highlightSettings";
const SCAN_SETTINGS_KEY = "scanSettings";
const DEFAULT_HIGHLIGHT_SETTINGS = {
  dashedBorders: false,
  labelPlacement: "inside"
};
const DEFAULT_SCAN_SETTINGS = {
  includeIframes: true,
  includeShadowDom: true
};
const DEFAULT_TEXT_RESIZE_SIMULATION = {
  enabled: false,
  scale: 200
};
const TEXT_RESIZE_MIN_SCALE = 100;
const TEXT_RESIZE_MAX_SCALE = 400;
const TEXT_RESIZE_STEP = 25;
const FRAME_SCOPED_ID_PREFIX = "a11y-frame:";
const SCAN_FRAME_TIMEOUT_MS = 8000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const latestAnalysisByTab = new Map();
const latestFrameAnalysesByTab = new Map();
const latestLiveRegionsByTab = new Map();
const knownFrameIdsByTab = new Map();
const scanProgressByTab = new Map();
const liveRegionCaptionsByTab = new Map();
const pageStructureOverlayByPage = new Map();
const semanticLinearViewByPage = new Map();
const textResizeSimulationByPage = new Map();
const interactiveNavigatorByPage = new Map();
const panelPorts = new Set();
const devtoolsPortsByTab = new Map();
let liveRegionCaptionSettings = DEFAULT_LIVE_REGION_CAPTION_SETTINGS;
let highlightSettings = DEFAULT_HIGHLIGHT_SETTINGS;
let scanSettings = DEFAULT_SCAN_SETTINGS;
let activePluginLanguage = "system";
let nextScanId = 1;
const DEFAULT_PAGE_STRUCTURE_OVERLAY = {
  headings: false,
  landmarks: false,
  graphics: false,
  ariaLabels: false,
  interactive: false,
  tables: false
};

loadLiveRegionCaptionSettings();
loadHighlightSettings();
loadScanSettings();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "A11Y_TOOLS_ANALYSIS" && sender.tab?.id) {
    if (message.analysis?.contentVersion !== CONTENT_VERSION) {
      return;
    }

    const url = sender.tab.url ?? message.analysis?.url ?? "";
    storeFrameAnalysis(sender.tab.id, url, sender.frameId, message.analysis, message.scanId);
    return;
  }

  if (message?.type === "A11Y_TOOLS_SCAN_FRAME_ERROR" && sender.tab?.id) {
    const url = sender.tab.url ?? "";
    markFrameScanProblem(sender.tab.id, url, sender.frameId, message.scanId, "frameAnalysisFailed", message.error);
    return;
  }

  if (message?.type === "A11Y_TOOLS_LIVE_REGIONS_UPDATE" && sender.tab?.id) {
    const url = sender.tab.url ?? "";
    updateFrameLiveRegions(sender.tab.id, url, sender.frameId, message.liveRegions ?? []);
    return;
  }

  if (message?.type === "A11Y_TOOLS_REQUEST_ACTIVE_TAB") {
    requestActiveTabAnalysis();
  }

  if (message?.type === "A11Y_TOOLS_REVEAL_ELEMENT") {
    revealElementInActiveTab(message.elementId);
  }

  if (message?.type === "A11Y_TOOLS_REVEAL_FRAME") {
    revealFrameInActiveTab(message.frameId);
  }

  if (message?.type === "A11Y_TOOLS_INSPECT_ELEMENT") {
    inspectElementInActiveDevTools(message.elementId);
  }

  if (message?.type === "A11Y_TOOLS_INSPECT_SELECTOR") {
    inspectSelectorInActiveDevTools(message.selector);
  }

  if (message?.type === "A11Y_TOOLS_REVEAL_LIVE_REGION") {
    revealLiveRegionInActiveTab(message.key);
  }

  if (message?.type === "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS") {
    setLiveRegionCaptionsForActiveTab(Boolean(message.enabled));
  }

  if (message?.type === "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY") {
    setPageStructureOverlayForActiveTab(normalizePageStructureOverlay(message.overlay ?? message));
  }

  if (message?.type === "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW") {
    setSemanticLinearViewForActiveTab(Boolean(message.enabled));
  }

  if (message?.type === "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION") {
    setTextResizeSimulationForActiveTab(normalizeTextResizeSimulation(message.textResizeSimulation ?? message));
  }

  if (message?.type === "A11Y_TOOLS_SET_INTERACTIVE_NAVIGATOR") {
    setInteractiveNavigatorForActiveTab(Boolean(message.enabled));
  }

  if (message?.type === "A11Y_TOOLS_MOVE_INTERACTIVE_NAVIGATOR") {
    moveInteractiveNavigatorForActiveTab(message.direction === "previous" ? "previous" : "next");
  }

  if (message?.type === "A11Y_TOOLS_INTERACTIVE_NAVIGATOR_STATE" && sender.tab?.id) {
    if (normalizeFrameId(sender.frameId) !== 0) {
      return;
    }

    const url = sender.tab.url ?? "";
    const state = normalizeInteractiveNavigatorState(message.state);
    interactiveNavigatorByPage.set(getPageKey(sender.tab.id, url), state);
    sendInteractiveNavigatorState(sender.tab.id, url, state);
    return;
  }

  if (message?.type === "A11Y_TOOLS_REQUEST_LIVE_REGION_CAPTION_SETTINGS") {
    sendLiveRegionCaptionSettings();
  }

  if (message?.type === "A11Y_TOOLS_REQUEST_HIGHLIGHT_SETTINGS") {
    sendHighlightSettings();
  }

  if (message?.type === "A11Y_TOOLS_REQUEST_SCAN_SETTINGS") {
    sendScanSettings();
  }

  if (message?.type === "A11Y_TOOLS_UPDATE_LIVE_REGION_CAPTION_SETTINGS") {
    updateLiveRegionCaptionSettings(message.settings);
  }

  if (message?.type === "A11Y_TOOLS_UPDATE_HIGHLIGHT_SETTINGS") {
    updateHighlightSettings(message.highlightSettings);
  }

  if (message?.type === "A11Y_TOOLS_UPDATE_SCAN_SETTINGS") {
    updateScanSettings(message.scanSettings);
  }

  if (message?.type === "A11Y_TOOLS_UPDATE_LANGUAGE") {
    activePluginLanguage = typeof message.language === "string" ? message.language : "system";
    updateActiveTabLanguage(activePluginLanguage);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "a11y-tools-panel") {
    panelPorts.add(port);
    port.onDisconnect.addListener(() => {
      panelPorts.delete(port);
    });
    return;
  }

  if (port.name !== "a11y-tools-devtools") {
    return;
  }

  let tabId = null;

  port.onMessage.addListener((message) => {
    if (message?.type !== "A11Y_TOOLS_DEVTOOLS_OPEN" || !Number.isInteger(message.tabId)) {
      return;
    }

    tabId = message.tabId;
    const ports = devtoolsPortsByTab.get(tabId) ?? new Set();
    ports.add(port);
    devtoolsPortsByTab.set(tabId, ports);
    sendDevToolsState(tabId, true);
  });

  port.onDisconnect.addListener(() => {
    if (!Number.isInteger(tabId)) {
      return;
    }

    const ports = devtoolsPortsByTab.get(tabId);
    ports?.delete(port);

    if (!ports || ports.size === 0) {
      devtoolsPortsByTab.delete(tabId);
      sendDevToolsState(tabId, false);
    }
  });
});

chrome.tabs.onActivated.addListener(() => {
  if (!shouldRefreshActiveTabAnalysis()) {
    return;
  }

  requestActiveTabAnalysis({ clearFirst: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || tab.status === "loading") {
    latestAnalysisByTab.delete(tabId);
    latestFrameAnalysesByTab.delete(tabId);
    latestLiveRegionsByTab.delete(tabId);
    knownFrameIdsByTab.delete(tabId);
    clearScanProgress(tabId);
    removePageScopedState(tabId);
    notifyActiveTabContext(tab);
    return;
  }

  if (changeInfo.url) {
    latestAnalysisByTab.delete(tabId);
    latestFrameAnalysesByTab.delete(tabId);
    latestLiveRegionsByTab.delete(tabId);
    knownFrameIdsByTab.delete(tabId);
    clearScanProgress(tabId);
    migratePageScopedState(tabId, tab.url ?? changeInfo.url);
    notifyActiveTabContext(tab);

    if (tab.active && tab.status !== "loading" && shouldRefreshActiveTabAnalysis()) {
      requestActiveTabAnalysis({ clearFirst: true });
    }
  }

  if (tab.active && changeInfo.status === "complete" && shouldRefreshActiveTabAnalysis()) {
    requestActiveTabAnalysis({ clearFirst: true });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  latestAnalysisByTab.delete(tabId);
  latestFrameAnalysesByTab.delete(tabId);
  latestLiveRegionsByTab.delete(tabId);
  knownFrameIdsByTab.delete(tabId);
  clearScanProgress(tabId);
  liveRegionCaptionsByTab.delete(tabId);
  removePageScopedState(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE && shouldRefreshActiveTabAnalysis()) {
    requestActiveTabAnalysis({ clearFirst: true });
  }
});

function shouldRefreshActiveTabAnalysis() {
  return panelPorts.size > 0;
}

function sendPanelUpdate(tabId, url, analysis, scanId = null) {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_PANEL_UPDATE",
    tabId,
    url,
    analysis,
    scanId
  }).catch(() => {});
}

function sendLiveRegionsUpdate(tabId, url, liveRegions) {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_LIVE_REGIONS_UPDATE",
    tabId,
    url,
    liveRegions
  }).catch(() => {});
}

function storeFrameAnalysis(tabId, tabUrl, rawFrameId, analysis, scanId = null) {
  const frameId = normalizeFrameId(rawFrameId);
  const frames = latestFrameAnalysesByTab.get(tabId) ?? new Map();

  frames.set(frameId, {
    frameId,
    tabUrl,
    frameUrl: analysis.url ?? "",
    analysis
  });
  latestFrameAnalysesByTab.set(tabId, frames);
  rememberFrameId(tabId, frameId);

  const aggregate = aggregateFrameAnalyses(frames);
  latestAnalysisByTab.set(tabId, {
    analysis: aggregate,
    url: tabUrl
  });
  latestLiveRegionsByTab.set(tabId, {
    liveRegions: aggregate.liveRegions ?? [],
    url: tabUrl
  });

  markFrameScanComplete(tabId, tabUrl, frameId, scanId);
  sendPanelUpdate(tabId, tabUrl, aggregate, scanId);
  sendLiveRegionsUpdate(tabId, tabUrl, aggregate.liveRegions ?? []);
}

function updateFrameLiveRegions(tabId, tabUrl, rawFrameId, liveRegions) {
  const frameId = normalizeFrameId(rawFrameId);
  const frames = latestFrameAnalysesByTab.get(tabId);
  const frame = frames?.get(frameId);

  rememberFrameId(tabId, frameId);

  if (!frame) {
    const scopedLiveRegions = frameId === 0
      ? liveRegions
      : liveRegions.map((item) => scopeLiveRegionItem(item, frameId, `iframe: ${item.selector || `Frame ${frameId}`}`));
    latestLiveRegionsByTab.set(tabId, {
      liveRegions: scopedLiveRegions,
      url: tabUrl
    });
    sendLiveRegionsUpdate(tabId, tabUrl, scopedLiveRegions);
    return;
  }

  frame.analysis = {
    ...frame.analysis,
    liveRegions
  };
  frames.set(frameId, frame);
  const aggregate = aggregateFrameAnalyses(frames);

  latestAnalysisByTab.set(tabId, {
    analysis: aggregate,
    url: tabUrl
  });
  latestLiveRegionsByTab.set(tabId, {
    liveRegions: aggregate.liveRegions ?? [],
    url: tabUrl
  });
  sendLiveRegionsUpdate(tabId, tabUrl, aggregate.liveRegions ?? []);
}

function aggregateFrameAnalyses(frames) {
  const orderedFrames = Array.from(frames.values()).sort((first, second) => {
    if (first.frameId === 0) return -1;
    if (second.frameId === 0) return 1;
    return first.frameId - second.frameId;
  });
  const main = orderedFrames.find((frame) => frame.frameId === 0)?.analysis ?? orderedFrames[0]?.analysis ?? {};
  const aggregate = {
    ...main,
    headings: [],
    landmarks: [],
    landmarkStructure: [],
    liveRegions: [],
    linearItems: [],
    interactiveItems: [],
    graphics: [],
    ariaLabels: [],
    tables: [],
    updatedAt: new Date().toISOString()
  };

  for (const frame of orderedFrames) {
    const scope = getFrameScope(frame);
    const scoped = frame.frameId === 0
      ? frame.analysis
      : scopeFrameAnalysis(frame.analysis, frame.frameId, scope);

    aggregate.headings.push(...(scoped.headings ?? []));
    aggregate.landmarks.push(...(scoped.landmarks ?? []));
    aggregate.landmarkStructure.push(...(scoped.landmarkStructure ?? []));
    aggregate.liveRegions.push(...(scoped.liveRegions ?? []));
    aggregate.linearItems.push(...(scoped.linearItems ?? []));
    aggregate.interactiveItems.push(...(scoped.interactiveItems ?? []));
    aggregate.graphics.push(...(scoped.graphics ?? []));
    aggregate.ariaLabels.push(...(scoped.ariaLabels ?? []));
    aggregate.tables.push(...(scoped.tables ?? []));
  }

  return aggregate;
}

function scopeFrameAnalysis(analysis, frameId, scope) {
  return {
    ...analysis,
    headings: (analysis.headings ?? []).map((item) => scopeElementItem(item, frameId, scope)),
    landmarks: (analysis.landmarks ?? []).map((item) => scopeElementItem(item, frameId, scope)),
    landmarkStructure: (analysis.landmarkStructure ?? []).map((item) => scopeLandmarkStructureItem(item, frameId, scope)),
    liveRegions: (analysis.liveRegions ?? []).map((item) => scopeLiveRegionItem(item, frameId, scope)),
    linearItems: (analysis.linearItems ?? []).map((item) => ({ ...item, id: scopeElementId(frameId, item.id), scope })),
    interactiveItems: (analysis.interactiveItems ?? []).map((item) => scopeElementItem(item, frameId, scope)),
    graphics: (analysis.graphics ?? []).map((item) => scopeElementItem(item, frameId, scope)),
    ariaLabels: (analysis.ariaLabels ?? []).map((item) => scopeElementItem(item, frameId, scope)),
    tables: (analysis.tables ?? []).map((item) => scopeTableItem(item, frameId, scope))
  };
}

function scopeElementItem(item, frameId, scope) {
  return {
    ...item,
    id: scopeElementId(frameId, item.id),
    scope
  };
}

function scopeLandmarkStructureItem(item, frameId, scope) {
  if (item.type === "content") {
    return {
      ...item,
      id: scopeElementId(frameId, item.id),
      elementIds: (item.elementIds ?? []).map((id) => scopeElementId(frameId, id)),
      scope
    };
  }

  return scopeElementItem(item, frameId, scope);
}

function scopeTableItem(item, frameId, scope) {
  return {
    ...scopeElementItem(item, frameId, scope),
    cells: (item.cells ?? []).map((cell) => scopeElementItem(cell, frameId, scope))
  };
}

function scopeLiveRegionItem(item, frameId, scope) {
  return {
    ...item,
    key: scopeElementId(frameId, item.key),
    scope
  };
}

function getFrameScope(frame) {
  const label = frame.analysis?.title?.trim() || frame.frameUrl || `Frame ${frame.frameId}`;
  return `iframe: ${label}`;
}

function normalizeFrameId(frameId) {
  return Number.isInteger(frameId) ? frameId : 0;
}

function scopeElementId(frameId, id) {
  return `${FRAME_SCOPED_ID_PREFIX}${frameId}:${encodeURIComponent(id ?? "")}`;
}

function parseScopedElementId(id) {
  if (typeof id !== "string" || !id.startsWith(FRAME_SCOPED_ID_PREFIX)) {
    return {
      frameId: 0,
      id
    };
  }

  const rest = id.slice(FRAME_SCOPED_ID_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex < 0) {
    return {
      frameId: 0,
      id
    };
  }

  const frameId = Number(rest.slice(0, separatorIndex));
  const encodedId = rest.slice(separatorIndex + 1);

  try {
    return {
      frameId: Number.isInteger(frameId) ? frameId : 0,
      id: decodeURIComponent(encodedId)
    };
  } catch {
    return {
      frameId: Number.isInteger(frameId) ? frameId : 0,
      id: encodedId
    };
  }
}

function rememberFrameId(tabId, frameId) {
  const frameIds = knownFrameIdsByTab.get(tabId) ?? new Set([0]);
  frameIds.add(frameId);
  knownFrameIdsByTab.set(tabId, frameIds);
}

function rememberInjectedFrames(tabId, injectionResults = []) {
  const frameIds = knownFrameIdsByTab.get(tabId) ?? new Set([0]);

  for (const result of injectionResults) {
    if (Number.isInteger(result.frameId)) {
      frameIds.add(result.frameId);
    }
  }

  knownFrameIdsByTab.set(tabId, frameIds);
}

function getKnownFrameIds(tabId) {
  return Array.from(knownFrameIdsByTab.get(tabId) ?? new Set([0]));
}

function startScanProgress(tabId, url) {
  clearScanProgress(tabId);

  const progress = {
    scanId: nextScanId++,
    tabId,
    url,
    phase: "preparing",
    totalFrames: null,
    expectedFrameIds: new Set(),
    completedFrameIds: new Set(),
    failedFrameIds: new Set(),
    frameDetails: new Map(),
    problems: [],
    timeoutId: 0
  };

  scanProgressByTab.set(tabId, progress);
  sendScanProgress(progress);
  return progress;
}

function setScanProgressFrameDetails(progress, frameDetails) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  progress.frameDetails = new Map(
    frameDetails
      .filter((frame) => Number.isInteger(frame.frameId))
      .map((frame) => [frame.frameId, {
        frameId: frame.frameId,
        parentFrameId: Number.isInteger(frame.parentFrameId) ? frame.parentFrameId : null,
        url: typeof frame.url === "string" ? frame.url : ""
      }])
  );

  if (progress.frameDetails.size > 0) {
    setScanProgressFrames(progress, Array.from(progress.frameDetails.keys()));
  }
}

function setScanProgressPhase(progress, phase) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  progress.phase = phase;
  sendScanProgress(progress);
}

function setScanProgressFrames(progress, frameIds) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  progress.expectedFrameIds = new Set([
    ...progress.expectedFrameIds,
    ...(frameIds.length ? frameIds : [0])
  ]);
  progress.totalFrames = progress.expectedFrameIds.size;
  sendScanProgress(progress);
}

function addScanProblem(progress, code, detail = "", frameId = null) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  const frameInfo = Number.isInteger(frameId) ? progress.frameDetails.get(frameId) : null;
  const problem = {
    code,
    detail,
    frameId: Number.isInteger(frameId) ? frameId : null,
    frameUrl: frameInfo?.url ?? "",
    parentFrameId: Number.isInteger(frameInfo?.parentFrameId) ? frameInfo.parentFrameId : null,
    canReveal: Number.isInteger(frameInfo?.parentFrameId) && frameInfo.parentFrameId >= 0
  };
  const signature = `${problem.code}:${problem.frameId ?? ""}:${problem.detail}`;

  if (!progress.problems.some((item) => `${item.code}:${item.frameId ?? ""}:${item.detail}` === signature)) {
    progress.problems.push(problem);
  }
}

function markFramesMissingInjection(progress, injectedFrameIds) {
  if (!progress || progress.frameDetails.size === 0) {
    return;
  }

  const injected = new Set(injectedFrameIds);

  for (const frameId of progress.frameDetails.keys()) {
    if (frameId === 0 || injected.has(frameId) || progress.failedFrameIds.has(frameId)) {
      continue;
    }

    progress.failedFrameIds.add(frameId);
    addScanProblem(progress, "frameInjectionSkipped", "", frameId);
  }

  finishScanProgressIfReady(progress);
}

function markFrameScanComplete(tabId, url, rawFrameId, scanId = null) {
  const progress = getMatchingScanProgress(tabId, url, scanId);
  if (!progress) {
    return;
  }

  const frameId = normalizeFrameId(rawFrameId);
  progress.completedFrameIds.add(frameId);
  progress.failedFrameIds.delete(frameId);
  finishScanProgressIfReady(progress);
}

function markFrameScanProblem(tabId, url, rawFrameId, scanId, code, detail = "") {
  const progress = getMatchingScanProgress(tabId, url, scanId);
  if (!progress) {
    return;
  }

  const frameId = normalizeFrameId(rawFrameId);
  progress.failedFrameIds.add(frameId);
  addScanProblem(progress, code, detail, frameId);
  finishScanProgressIfReady(progress);
}

function markRejectedScanRequests(progress, results) {
  if (!progress) {
    return;
  }

  for (const result of results) {
    if (result.status === "rejected") {
      progress.failedFrameIds.add(result.frameId);
      addScanProblem(progress, "frameMessageFailed", "", result.frameId);
    }
  }

  finishScanProgressIfReady(progress);
}

function scheduleScanProgressTimeout(progress) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  clearTimeout(progress.timeoutId);
  progress.timeoutId = setTimeout(() => {
    if (scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
      return;
    }

    for (const frameId of progress.expectedFrameIds) {
      if (!progress.completedFrameIds.has(frameId) && !progress.failedFrameIds.has(frameId)) {
        progress.failedFrameIds.add(frameId);
        addScanProblem(progress, "frameTimeout", "", frameId);
      }
    }

    finishScanProgressIfReady(progress);
  }, SCAN_FRAME_TIMEOUT_MS);
}

function finishScanProgressIfReady(progress) {
  if (!progress || scanProgressByTab.get(progress.tabId)?.scanId !== progress.scanId) {
    return;
  }

  const expectedCount = progress.expectedFrameIds.size;
  const finishedCount = progress.completedFrameIds.size + progress.failedFrameIds.size;

  if (expectedCount > 0 && finishedCount >= expectedCount) {
    clearTimeout(progress.timeoutId);
    progress.phase = progress.failedFrameIds.size === expectedCount ? "problem" : "complete";
    sendScanProgress(progress);
    return;
  }

  progress.phase = "scanningFrames";
  sendScanProgress(progress);
}

function getMatchingScanProgress(tabId, url, scanId = null) {
  const progress = scanProgressByTab.get(tabId);
  if (!progress) {
    return null;
  }

  if (Number.isInteger(scanId) && progress.scanId !== scanId) {
    return null;
  }

  if (url && progress.url && progress.url !== url) {
    return null;
  }

  return progress;
}

function clearScanProgress(tabId) {
  const progress = scanProgressByTab.get(tabId);
  if (progress?.timeoutId) {
    clearTimeout(progress.timeoutId);
  }
  scanProgressByTab.delete(tabId);
}

function sendScanProgress(progress) {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_SCAN_PROGRESS",
    tabId: progress.tabId,
    url: progress.url,
    progress: {
      scanId: progress.scanId,
      phase: progress.phase,
      completedFrames: progress.completedFrameIds.size + progress.failedFrameIds.size,
      successfulFrames: progress.completedFrameIds.size,
      failedFrames: progress.failedFrameIds.size,
      totalFrames: progress.totalFrames,
      problems: progress.problems.slice(-5),
      includeIframes: scanSettings.includeIframes,
      includeShadowDom: scanSettings.includeShadowDom
    }
  }).catch(() => {});
}

async function requestActiveTabAnalysis({ clearFirst = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  notifyActiveTabContext(tab);

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  const progress = startScanProgress(tab.id, url);
  setScanProgressFrameDetails(progress, await getTabFrameDetails(tab.id));

  const cached = latestAnalysisByTab.get(tab.id);
  if (cached && cached.url === url && cached.analysis?.contentVersion === CONTENT_VERSION) {
    sendPanelUpdate(tab.id, cached.url, cached.analysis);
  }

  const cachedLiveRegions = latestLiveRegionsByTab.get(tab.id);
  if (cachedLiveRegions && cachedLiveRegions.url === url) {
    sendLiveRegionsUpdate(tab.id, cachedLiveRegions.url, cachedLiveRegions.liveRegions);
  }

  latestFrameAnalysesByTab.delete(tab.id);
  latestAnalysisByTab.delete(tab.id);
  latestLiveRegionsByTab.delete(tab.id);
  knownFrameIdsByTab.set(tab.id, new Set([0]));

  try {
    setScanProgressPhase(progress, "injecting");
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: scanSettings.includeIframes },
      files: ["content.js"]
    });
    rememberInjectedFrames(tab.id, injectionResults);
    const injectedFrameIds = getKnownFrameIds(tab.id);
    markFramesMissingInjection(progress, injectedFrameIds);
    await requestAnalysisFromFrames(tab, injectedFrameIds, progress);
  } catch {
    addScanProblem(progress, "allFramesInjectionFailed");
    try {
      setScanProgressPhase(progress, "injecting");
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      rememberInjectedFrames(tab.id, injectionResults);
      markFramesMissingInjection(progress, [0]);
      await requestAnalysisFromFrames(tab, [0], progress);
    } catch {
      setScanProgressFrames(progress, [0]);
      markFramesMissingInjection(progress, []);
      markFrameScanProblem(tab.id, url, 0, progress.scanId, "allFramesFailed");
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }
}

async function requestAnalysisFromFrames(tab, frameIds, progress) {
  const scanFrameIds = frameIds.length ? frameIds : [0];

  setScanProgressFrames(progress, scanFrameIds);
  setScanProgressPhase(progress, "applyingSettings");
  await applyPageStateToTab(tab, scanFrameIds);

  setScanProgressPhase(progress, "scanningFrames");
  const results = await sendMessageToFrames(tab.id, {
    type: "A11Y_TOOLS_REQUEST_ANALYSIS",
    scanId: progress.scanId
  }, scanFrameIds);

  markRejectedScanRequests(progress, results);
  scheduleScanProgressTimeout(progress);
}

async function getTabFrameDetails(tabId) {
  try {
    const frames = await chrome.webNavigation?.getAllFrames?.({ tabId });
    return Array.isArray(frames) ? frames : [];
  } catch {
    return [];
  }
}

function notifyActiveTabContext(tab) {
  if (!tab?.id) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_ACTIVE_TAB",
    tabId: tab.id,
    url: tab.url ?? "",
    liveRegionCaptionsEnabled: getLiveRegionCaptionsEnabled(tab.id),
    pageStructureOverlay: getPageStructureOverlay(tab.id, tab.url ?? ""),
    semanticLinearViewEnabled: getSemanticLinearViewEnabled(tab.id, tab.url ?? ""),
    textResizeSimulation: getTextResizeSimulation(tab.id, tab.url ?? ""),
    interactiveNavigator: getInteractiveNavigatorState(tab.id, tab.url ?? ""),
    devtoolsOpen: isDevToolsOpen(tab.id),
    liveRegionCaptionSettings,
    scanSettings,
    status: "Scanning page"
  }).catch(() => {});
}

function sendDevToolsState(tabId, open) {
  chrome.tabs.get(tabId, (tab) => {
    chrome.runtime.sendMessage({
      type: "A11Y_TOOLS_DEVTOOLS_STATE",
      tabId,
      url: tab?.url ?? "",
      open
    }).catch(() => {});
  });
}

function sendPanelStatus(status, tabId = null, url = "") {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_PANEL_STATUS",
    tabId,
    url,
    status
  }).catch(() => {});
}

async function applyPageStateToTab(tab, frameIds = getKnownFrameIds(tab.id)) {
  if (!tab?.id) {
    return;
  }

  const url = tab.url ?? "";
  const messages = [
    {
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled: getLiveRegionCaptionsEnabled(tab.id),
      settings: liveRegionCaptionSettings
    },
    {
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: getPageStructureOverlay(tab.id, url)
    },
    {
      type: "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW",
      enabled: getSemanticLinearViewEnabled(tab.id, url)
    },
    {
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: getTextResizeSimulation(tab.id, url)
    },
    {
      type: "A11Y_TOOLS_SET_INTERACTIVE_NAVIGATOR",
      enabled: getInteractiveNavigatorState(tab.id, url).enabled
    },
    {
      type: "A11Y_TOOLS_UPDATE_HIGHLIGHT_SETTINGS",
      highlightSettings
    },
    {
      type: "A11Y_TOOLS_UPDATE_SCAN_SETTINGS",
      scanSettings
    },
    {
      type: "A11Y_TOOLS_UPDATE_LANGUAGE",
      language: activePluginLanguage
    }
  ];

  for (const message of messages) {
    await sendMessageToFrames(tab.id, message, frameIds);
  }
}

async function sendMessageToFrames(tabId, message, frameIds = getKnownFrameIds(tabId)) {
  const results = await Promise.allSettled(
    frameIds.map((frameId) => chrome.tabs.sendMessage(tabId, message, { frameId }))
  );
  const framedResults = results.map((result, index) => ({
    ...result,
    frameId: frameIds[index]
  }));

  if (framedResults.every((result) => result.status === "rejected")) {
    throw new Error("No content script frames accepted the message.");
  }

  return framedResults;
}

async function revealElementInActiveTab(elementId) {
  if (typeof elementId !== "string" || elementId.trim() === "") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  const target = parseScopedElementId(elementId);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "A11Y_TOOLS_REVEAL_ELEMENT",
      elementId: target.id
    }, { frameId: target.frameId });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [target.frameId] },
        files: ["content.js"]
      });
      rememberFrameId(tab.id, target.frameId);
      await applyPageStateToTab(tab, [target.frameId]);
      await chrome.tabs.sendMessage(tab.id, {
        type: "A11Y_TOOLS_REVEAL_ELEMENT",
        elementId: target.id
      }, { frameId: target.frameId });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }
}

async function revealFrameInActiveTab(frameId) {
  if (!Number.isInteger(frameId)) {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  const frame = await getFrameDetailForReveal(tab.id, frameId);
  if (!frame || !Number.isInteger(frame.parentFrameId) || frame.parentFrameId < 0) {
    sendPanelStatus("The iframe could not be found on the page", tab.id, url);
    return;
  }

  const message = {
    type: "A11Y_TOOLS_REVEAL_FRAME",
    frameUrl: frame.url ?? ""
  };

  try {
    await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.parentFrameId });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frame.parentFrameId] },
        files: ["content.js"]
      });
      rememberFrameId(tab.id, frame.parentFrameId);
      await applyPageStateToTab(tab, [frame.parentFrameId]);
      await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.parentFrameId });
    } catch {
      sendPanelStatus("The iframe could not be highlighted on the page", tab.id, url);
    }
  }
}

async function getFrameDetailForReveal(tabId, frameId) {
  const progress = scanProgressByTab.get(tabId);
  const cached = progress?.frameDetails?.get(frameId);

  if (cached) {
    return cached;
  }

  const frames = await getTabFrameDetails(tabId);
  const frame = frames.find((item) => item.frameId === frameId);

  return frame
    ? {
        frameId: frame.frameId,
        parentFrameId: Number.isInteger(frame.parentFrameId) ? frame.parentFrameId : null,
        url: typeof frame.url === "string" ? frame.url : ""
      }
    : null;
}

async function inspectElementInActiveDevTools(elementId) {
  if (typeof elementId !== "string" || elementId.trim() === "") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const ports = devtoolsPortsByTab.get(tab.id);

  if (!ports?.size || elementId.startsWith(FRAME_SCOPED_ID_PREFIX)) {
    revealElementInActiveTab(elementId);
    return;
  }

  for (const port of ports) {
    port.postMessage({
      type: "A11Y_TOOLS_DEVTOOLS_INSPECT_ELEMENT",
      elementId
    });
  }
}

async function inspectSelectorInActiveDevTools(selector) {
  if (typeof selector !== "string" || selector.trim() === "") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const ports = devtoolsPortsByTab.get(tab.id);

  if (!ports?.size) {
    return;
  }

  for (const port of ports) {
    port.postMessage({
      type: "A11Y_TOOLS_DEVTOOLS_INSPECT_SELECTOR",
      selector
    });
  }
}

async function revealLiveRegionInActiveTab(key) {
  if (typeof key !== "string" || key.trim() === "") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  const target = parseScopedElementId(key);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "A11Y_TOOLS_REVEAL_LIVE_REGION",
      key: target.id
    }, { frameId: target.frameId });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [target.frameId] },
        files: ["content.js"]
      });
      rememberFrameId(tab.id, target.frameId);
      await applyPageStateToTab(tab, [target.frameId]);
      await chrome.tabs.sendMessage(tab.id, {
        type: "A11Y_TOOLS_REVEAL_LIVE_REGION",
        key: target.id
      }, { frameId: target.frameId });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }
}

async function setLiveRegionCaptionsForActiveTab(enabled) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  liveRegionCaptionsByTab.set(tab.id, enabled);

  try {
    await sendMessageToFrames(tab.id, {
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled,
      settings: liveRegionCaptionSettings
    });
  } catch {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: scanSettings.includeIframes },
        files: ["content.js"]
      });
      rememberInjectedFrames(tab.id, injectionResults);
      await sendMessageToFrames(tab.id, {
        type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
        enabled,
        settings: liveRegionCaptionSettings
      });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }

  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_LIVE_REGION_CAPTIONS_STATE",
    tabId: tab.id,
    url,
    enabled,
    liveRegionCaptionSettings
  }).catch(() => {});
}

function getLiveRegionCaptionsEnabled(tabId) {
  return liveRegionCaptionsByTab.get(tabId) ?? false;
}

async function setPageStructureOverlayForActiveTab(overlay) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  const normalizedOverlay = normalizePageStructureOverlay(overlay);

  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  pageStructureOverlayByPage.set(getPageKey(tab.id, url), normalizedOverlay);

  if (normalizedOverlay.interactive) {
    interactiveNavigatorByPage.set(getPageKey(tab.id, url), normalizeInteractiveNavigatorState({
      ...getInteractiveNavigatorState(tab.id, url),
      enabled: false,
      index: 0
    }));
  }

  try {
    await sendMessageToFrames(tab.id, {
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: normalizedOverlay
    });
  } catch {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: scanSettings.includeIframes },
        files: ["content.js"]
      });
      rememberInjectedFrames(tab.id, injectionResults);
      await sendMessageToFrames(tab.id, {
        type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
        overlay: normalizedOverlay
      });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }

  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_PAGE_STRUCTURE_OVERLAY_STATE",
    tabId: tab.id,
    url,
    pageStructureOverlay: normalizedOverlay
  }).catch(() => {});
}

function getPageStructureOverlay(tabId, url) {
  return normalizePageStructureOverlay(getPageScopedValue(pageStructureOverlayByPage, tabId, url, undefined));
}

async function setSemanticLinearViewForActiveTab(enabled) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  if (enabled) {
    await setPageStructureOverlayForActiveTab({});
  }

  semanticLinearViewByPage.set(getPageKey(tab.id, url), enabled);

  try {
    await sendMessageToFrames(tab.id, {
      type: "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW",
      enabled
    });
  } catch {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: scanSettings.includeIframes },
        files: ["content.js"]
      });
      rememberInjectedFrames(tab.id, injectionResults);
      await sendMessageToFrames(tab.id, {
        type: "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW",
        enabled
      });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }

  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_SEMANTIC_LINEAR_VIEW_STATE",
    tabId: tab.id,
    url,
    enabled
  }).catch(() => {});
}

function getSemanticLinearViewEnabled(tabId, url) {
  return getPageScopedValue(semanticLinearViewByPage, tabId, url, false);
}

async function setTextResizeSimulationForActiveTab(simulation) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  const normalizedSimulation = normalizeTextResizeSimulation(simulation);
  textResizeSimulationByPage.set(getPageKey(tab.id, url), normalizedSimulation);

  try {
    await sendMessageToFrames(tab.id, {
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: normalizedSimulation
    });
  } catch {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: scanSettings.includeIframes },
        files: ["content.js"]
      });
      rememberInjectedFrames(tab.id, injectionResults);
      await sendMessageToFrames(tab.id, {
        type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
        textResizeSimulation: normalizedSimulation
      });
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    }
  }

  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_TEXT_RESIZE_SIMULATION_STATE",
    tabId: tab.id,
    url,
    textResizeSimulation: normalizedSimulation
  }).catch(() => {});
}

function getTextResizeSimulation(tabId, url) {
  return normalizeTextResizeSimulation(getPageScopedValue(textResizeSimulationByPage, tabId, url, undefined));
}

async function setInteractiveNavigatorForActiveTab(enabled) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  if (enabled) {
    await setPageStructureOverlayForActiveTab({});
  }

  const previous = getInteractiveNavigatorState(tab.id, url);
  const state = normalizeInteractiveNavigatorState({
    ...previous,
    enabled,
    index: enabled ? previous.index : 0
  });
  interactiveNavigatorByPage.set(getPageKey(tab.id, url), state);

  await sendInteractiveNavigatorCommand(tab.id, url, {
    type: "A11Y_TOOLS_SET_INTERACTIVE_NAVIGATOR",
    enabled,
    index: state.index
  });
  sendInteractiveNavigatorState(tab.id, url, state);
}

async function moveInteractiveNavigatorForActiveTab(direction) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    sendPanelStatus("No active page found");
    return;
  }

  const url = tab.url ?? "";
  if (!canInspectUrl(url)) {
    sendPanelStatus(getUnavailablePageStatus(url), tab.id, url);
    return;
  }

  await sendInteractiveNavigatorCommand(tab.id, url, {
    type: "A11Y_TOOLS_MOVE_INTERACTIVE_NAVIGATOR",
    direction
  });
}

async function sendInteractiveNavigatorCommand(tabId, url, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      sendPanelStatus(getUnavailablePageStatus(url), tabId, url);
    }
  }
}

function sendInteractiveNavigatorState(tabId, url, state) {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_INTERACTIVE_NAVIGATOR_STATE",
    tabId,
    url,
    state
  }).catch(() => {});
}

function getInteractiveNavigatorState(tabId, url) {
  return normalizeInteractiveNavigatorState(getPageScopedValue(interactiveNavigatorByPage, tabId, url, undefined));
}

function normalizeInteractiveNavigatorState(value = {}) {
  return {
    enabled: Boolean(value.enabled),
    index: Number.isInteger(value.index) ? value.index : 0,
    count: Number.isInteger(value.count) ? value.count : 0,
    currentHidden: Boolean(value.currentHidden),
    currentLabel: typeof value.currentLabel === "string" ? value.currentLabel : ""
  };
}

function normalizeTextResizeSimulation(value = {}) {
  return {
    enabled: Boolean(value.enabled),
    scale: normalizeTextResizeScale(value.scale)
  };
}

function normalizeTextResizeScale(value) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_TEXT_RESIZE_SIMULATION.scale;
  }

  const steppedValue = Math.round(numericValue / TEXT_RESIZE_STEP) * TEXT_RESIZE_STEP;
  return Math.max(TEXT_RESIZE_MIN_SCALE, Math.min(TEXT_RESIZE_MAX_SCALE, steppedValue));
}

function normalizePageStructureOverlay(value) {
  return {
    headings: Boolean(value?.headings ?? value?.enabled ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.headings),
    landmarks: Boolean(value?.landmarks ?? value?.enabled ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.landmarks),
    graphics: Boolean(value?.graphics ?? value?.enabled ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.graphics),
    ariaLabels: Boolean(value?.ariaLabels ?? value?.enabled ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.ariaLabels),
    interactive: Boolean(value?.interactive ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.interactive),
    tables: Boolean(value?.tables ?? DEFAULT_PAGE_STRUCTURE_OVERLAY.tables)
  };
}

function canInspectUrl(url) {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function getUnavailablePageStatus(url) {
  if (!url || url === "about:blank" || /^chrome:\/\/newtab\/?$/i.test(url)) {
    return "Open a web page to inspect it";
  }

  return "This page cannot be inspected";
}

function migratePageScopedState(tabId, url) {
  migratePageScopedValue(pageStructureOverlayByPage, tabId, url);
  migratePageScopedValue(semanticLinearViewByPage, tabId, url);
  migratePageScopedValue(textResizeSimulationByPage, tabId, url);
  migratePageScopedValue(interactiveNavigatorByPage, tabId, url);
}

function removePageScopedState(tabId) {
  const prefix = `${tabId}:`;

  for (const key of pageStructureOverlayByPage.keys()) {
    if (key.startsWith(prefix)) {
      pageStructureOverlayByPage.delete(key);
    }
  }

  for (const key of semanticLinearViewByPage.keys()) {
    if (key.startsWith(prefix)) {
      semanticLinearViewByPage.delete(key);
    }
  }

  for (const key of textResizeSimulationByPage.keys()) {
    if (key.startsWith(prefix)) {
      textResizeSimulationByPage.delete(key);
    }
  }

  for (const key of interactiveNavigatorByPage.keys()) {
    if (key.startsWith(prefix)) {
      interactiveNavigatorByPage.delete(key);
    }
  }

  devtoolsPortsByTab.delete(tabId);
}

function isDevToolsOpen(tabId) {
  return Boolean(devtoolsPortsByTab.get(tabId)?.size);
}

async function loadLiveRegionCaptionSettings() {
  const stored = await chrome.storage.local.get(LIVE_REGION_CAPTION_SETTINGS_KEY).catch(() => ({}));
  liveRegionCaptionSettings = normalizeLiveRegionCaptionSettings(
    stored[LIVE_REGION_CAPTION_SETTINGS_KEY] ?? DEFAULT_LIVE_REGION_CAPTION_SETTINGS
  );
}

async function updateLiveRegionCaptionSettings(settings) {
  liveRegionCaptionSettings = normalizeLiveRegionCaptionSettings({
    ...liveRegionCaptionSettings,
    ...settings
  });

  await chrome.storage.local.set({
    [LIVE_REGION_CAPTION_SETTINGS_KEY]: liveRegionCaptionSettings
  }).catch(() => {});

  sendLiveRegionCaptionSettings();
  updateActiveTabCaptionSettings();
}

function sendLiveRegionCaptionSettings() {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_LIVE_REGION_CAPTION_SETTINGS",
    settings: liveRegionCaptionSettings
  }).catch(() => {});
}

async function updateActiveTabCaptionSettings() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    return;
  }

  await sendMessageToFrames(tab.id, {
    type: "A11Y_TOOLS_UPDATE_LIVE_REGION_CAPTION_SETTINGS",
    settings: liveRegionCaptionSettings
  }).catch(() => {});
}

async function loadHighlightSettings() {
  const stored = await chrome.storage.local.get(HIGHLIGHT_SETTINGS_KEY).catch(() => ({}));
  highlightSettings = normalizeHighlightSettings(stored[HIGHLIGHT_SETTINGS_KEY] ?? DEFAULT_HIGHLIGHT_SETTINGS);
}

async function updateHighlightSettings(settings) {
  highlightSettings = normalizeHighlightSettings({
    ...highlightSettings,
    ...settings
  });

  await chrome.storage.local.set({
    [HIGHLIGHT_SETTINGS_KEY]: highlightSettings
  }).catch(() => {});

  sendHighlightSettings();
  updateActiveTabHighlightSettings();
}

function sendHighlightSettings() {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_HIGHLIGHT_SETTINGS",
    highlightSettings
  }).catch(() => {});
}

async function updateActiveTabHighlightSettings() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    return;
  }

  await sendMessageToFrames(tab.id, {
    type: "A11Y_TOOLS_UPDATE_HIGHLIGHT_SETTINGS",
    highlightSettings
  }).catch(() => {});
}

async function loadScanSettings() {
  const stored = await chrome.storage.local.get(SCAN_SETTINGS_KEY).catch(() => ({}));
  scanSettings = normalizeScanSettings(stored[SCAN_SETTINGS_KEY] ?? DEFAULT_SCAN_SETTINGS);
}

async function updateScanSettings(settings) {
  scanSettings = normalizeScanSettings({
    ...scanSettings,
    ...settings
  });

  await chrome.storage.local.set({
    [SCAN_SETTINGS_KEY]: scanSettings
  }).catch(() => {});

  sendScanSettings();
  updateActiveTabScanSettings();
  requestActiveTabAnalysis({ clearFirst: true });
}

function sendScanSettings() {
  chrome.runtime.sendMessage({
    type: "A11Y_TOOLS_SCAN_SETTINGS",
    scanSettings
  }).catch(() => {});
}

async function updateActiveTabScanSettings() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    return;
  }

  await sendMessageToFrames(tab.id, {
    type: "A11Y_TOOLS_UPDATE_SCAN_SETTINGS",
    scanSettings
  }).catch(() => {});
}

async function updateActiveTabLanguage(language) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id) {
    return;
  }

  await sendMessageToFrames(tab.id, {
    type: "A11Y_TOOLS_UPDATE_LANGUAGE",
    language
  }).catch(() => {});
}

function normalizeHighlightSettings(value = {}) {
  const placement = value.labelPlacement;

  return {
    dashedBorders: Boolean(value.dashedBorders),
    labelPlacement: placement === "inside" || placement === "above" || placement === "below" || placement === "left" || placement === "right" || placement === "outside"
      ? placement === "outside" ? "above" : placement
      : DEFAULT_HIGHLIGHT_SETTINGS.labelPlacement
  };
}

function normalizeScanSettings(value = {}) {
  return {
    includeIframes: value.includeIframes !== false,
    includeShadowDom: value.includeShadowDom !== false
  };
}
