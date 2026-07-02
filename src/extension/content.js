import { analyzeAccessibility, collectInteractiveItems, collectLinearSemantics, findElementByIdDeep, isExposedToAccessibilityTree, queryElementsDeep, withAccessibilityAnalysisCache } from "../shared/a11y-tree.js";
import {
  DEFAULT_LIVE_REGION_CAPTION_SETTINGS,
  normalizeLiveRegionCaptionSettings
} from "../shared/live-region-caption-settings.js";
import { CONTENT_VERSION } from "../shared/content-version.js";
import { getNavigatorLanguages, resolvePluginLanguage, t } from "../shared/i18n.js";

const LIVE_REGION_SELECTOR = [
  "[aria-live='assertive' i]",
  "[aria-live='polite' i]",
  "[role='alert' i]",
  "[role='log' i]",
  "[role='status' i]",
  "output"
].join(",");
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
const TEXT_RESIZE_SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "iframe",
  "frame",
  "object",
  "embed",
  "br",
  "wbr"
].join(",");

globalThis.__a11yToolsHighlightSettings ??= {
  dashedBorders: false,
  labelPlacement: "inside"
};
globalThis.__a11yToolsScanSettings ??= DEFAULT_SCAN_SETTINGS;
globalThis.__a11yToolsTextResizeSimulation ??= DEFAULT_TEXT_RESIZE_SIMULATION;

if (globalThis.__a11yToolsContentVersion === CONTENT_VERSION) {
  clearLegacyRevealOutlines();
  sendExistingAnalysis();
} else {
  globalThis.__a11yToolsContentVersion = CONTENT_VERSION;
  clearLegacyRevealOutlines();

  let lastPayload = "";
  let scheduled = false;
  let lastUrl = location.href;
  let scanSettings = normalizeScanSettings(globalThis.__a11yToolsScanSettings);
  let liveRegionCaptionsEnabled = false;
  let liveRegionCaptionSettings = DEFAULT_LIVE_REGION_CAPTION_SETTINGS;
  let liveRegionObserver = null;
  const liveRegionShadowRoots = new WeakSet();
  const analysisShadowRoots = new WeakSet();
  let liveRegionBaseline = new WeakMap();
  let liveRegionCaptionTimer = 0;
  let liveRegionMarkerRequestId = 0;
  let liveRegionMarkerTimer = 0;
  let activeLiveRegionMarker = null;
  let liveRegionMarkerUpdateScheduled = false;
  const liveRegionRecords = new Map();
  let liveRegionUpdateScheduled = false;
  let pageStructureOverlay = {
    headings: false,
    landmarks: false,
    graphics: false,
    ariaLabels: false,
    tables: false
  };
  let pageStructureOverlayScheduled = false;
  let semanticLinearViewEnabled = false;
  let semanticLinearViewScheduled = false;
  let textResizeSimulation = normalizeTextResizeSimulation(globalThis.__a11yToolsTextResizeSimulation);
  const textResizeOriginalInlineStyles = new Map();
  let interactiveNavigator = {
    enabled: false,
    index: 0
  };
  let interactiveNavigatorScheduled = false;
  let forcedInteractiveFocusElement = null;
  let highlightSettings = {
    dashedBorders: false,
    labelPlacement: "inside"
  };
  let pluginLanguage = resolvePluginLanguage("system", getNavigatorLanguages());
  globalThis.__a11yToolsPluginLanguage = pluginLanguage;

  globalThis.__a11yToolsSyncLiveRegions = syncLiveRegionRegistry;
  globalThis.__a11yToolsGetLiveRegionRecords = getLiveRegionRecords;

  function sendAnalysis({ force = false, scanId = null } = {}) {
    scheduled = false;

    let analysis;
    try {
      analysis = getAnalysis();
    } catch (error) {
      if (Number.isInteger(scanId)) {
        sendRuntimeMessage({
          type: "A11Y_TOOLS_SCAN_FRAME_ERROR",
          scanId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    const payload = JSON.stringify({
      url: analysis.url,
      headings: analysis.headings,
      landmarks: analysis.landmarks,
      landmarkStructure: analysis.landmarkStructure,
      liveRegions: analysis.liveRegions,
      linearItems: analysis.linearItems,
      interactiveItems: analysis.interactiveItems,
      graphics: analysis.graphics,
      ariaLabels: analysis.ariaLabels,
      tables: analysis.tables
    });

    if (!force && payload === lastPayload) {
      if (isPageStructureOverlayEnabled()) {
        schedulePageStructureOverlayRender(analysis);
      }
      if (semanticLinearViewEnabled) {
        scheduleSemanticLinearViewRender(analysis);
      }
      if (interactiveNavigator.enabled) {
        scheduleInteractiveNavigatorRender(analysis);
      }
      return;
    }

    lastPayload = payload;
    if (isPageStructureOverlayEnabled()) {
      schedulePageStructureOverlayRender(analysis);
    }
    if (semanticLinearViewEnabled) {
      scheduleSemanticLinearViewRender(analysis);
    }
    if (interactiveNavigator.enabled) {
      scheduleInteractiveNavigatorRender(analysis);
    }
    sendRuntimeMessage({
      type: "A11Y_TOOLS_ANALYSIS",
      analysis,
      scanId: Number.isInteger(scanId) ? scanId : null
    });
  }

  function scheduleAnalysis() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => sendAnalysis());
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A11Y_TOOLS_REQUEST_ANALYSIS") {
      const scanId = Number.isInteger(message.scanId) ? message.scanId : null;
      requestAnimationFrame(() => sendAnalysis({ force: true, scanId }));
    }

    if (message?.type === "A11Y_TOOLS_REVEAL_ELEMENT") {
      revealElement(message.elementId);
    }

    if (message?.type === "A11Y_TOOLS_REVEAL_FRAME") {
      revealFrameElement(message.frameUrl);
    }

    if (message?.type === "A11Y_TOOLS_REVEAL_LIVE_REGION") {
      revealLiveRegion(message.key);
    }

    if (message?.type === "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS") {
      updateLiveRegionCaptionSettings(message.settings);
      setLiveRegionCaptionsEnabled(Boolean(message.enabled));
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
      pluginLanguage = resolvePluginLanguage(message.language, getNavigatorLanguages());
      globalThis.__a11yToolsPluginLanguage = pluginLanguage;
      updateLocalizedOverlays();
    }

    if (message?.type === "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY") {
      setPageStructureOverlay(message.overlay ?? message);
    }

    if (message?.type === "A11Y_TOOLS_SET_SEMANTIC_LINEAR_VIEW") {
      setSemanticLinearViewEnabled(Boolean(message.enabled));
    }

    if (message?.type === "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION") {
      setTextResizeSimulation(message.textResizeSimulation ?? message);
    }

    if (message?.type === "A11Y_TOOLS_SET_INTERACTIVE_NAVIGATOR") {
      setInteractiveNavigatorEnabled(Boolean(message.enabled), message.index);
    }

    if (message?.type === "A11Y_TOOLS_MOVE_INTERACTIVE_NAVIGATOR") {
      moveInteractiveNavigator(message.direction === "previous" ? -1 : 1);
    }
  });

  window.addEventListener("popstate", () => {
    handlePossibleUrlChange();
  });

  window.addEventListener("resize", () => {
    if (isPageStructureOverlayEnabled()) {
      schedulePageStructureOverlayRender();
    }
    if (semanticLinearViewEnabled) {
      scheduleSemanticLinearViewRender();
    }
    if (textResizeSimulation.enabled) {
      renderTextResizeBadge();
    }
    if (interactiveNavigator.enabled) {
      scheduleInteractiveNavigatorRender();
    }
    scheduleRevealHighlightUpdate();
    scheduleLiveRegionMarkerUpdate();
  });

  window.addEventListener("scroll", () => {
    if (isPageStructureOverlayEnabled()) {
      schedulePageStructureOverlayRender();
    }
    if (interactiveNavigator.enabled) {
      scheduleInteractiveNavigatorRender();
    }
    scheduleRevealHighlightUpdate();
    scheduleLiveRegionMarkerUpdate();
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!interactiveNavigator.enabled) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveInteractiveNavigator(1);
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveInteractiveNavigator(-1);
    }

    if (event.key === "Tab") {
      event.preventDefault();
      moveInteractiveNavigator(event.shiftKey ? -1 : 1);
    }
  }, true);

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    handlePossibleUrlChange();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    handlePossibleUrlChange();
    return result;
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnOverlayMutation)) {
      return;
    }

    observeAnalysisShadowRoots();
    observeLiveRegionShadowRoots();
    scheduleAnalysis();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "aria-hidden",
      "aria-label",
      "aria-labelledby",
      "aria-level",
      "hidden",
      "id",
      "role",
      "style"
    ],
    childList: true,
    characterData: true,
    subtree: true
  });
  observeAnalysisShadowRoots();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startLiveRegionObserver();
      syncLiveRegionRegistry();
      scheduleLiveRegionsUpdate();
      scheduleAnalysis();
    }, { once: true });
  } else {
    startLiveRegionObserver();
    syncLiveRegionRegistry();
    scheduleLiveRegionsUpdate();
    scheduleAnalysis();
  }

  function handlePossibleUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastPayload = "";
      if (liveRegionCaptionsEnabled) {
        ensureLiveRegionCaptionOverlay();
        startLiveRegionObserver();
      }
      syncLiveRegionRegistry();
      scheduleLiveRegionsUpdate();
      scheduleAnalysis();
    }
  }

  function setLiveRegionCaptionsEnabled(enabled) {
    liveRegionCaptionsEnabled = enabled;

    if (enabled) {
      ensureLiveRegionCaptionOverlay();
      resetLiveRegionBaselines();
      startLiveRegionObserver();
      return;
    }

    removeLiveRegionCaptionOverlay();
  }

  function updateLiveRegionCaptionSettings(settings) {
    liveRegionCaptionSettings = normalizeLiveRegionCaptionSettings({
      ...liveRegionCaptionSettings,
      ...settings
    });

    applyLiveRegionCaptionSettings();
  }

  function updateHighlightSettings(settings) {
    const labelPlacement = normalizeHighlightLabelPlacement(settings?.labelPlacement);
    highlightSettings = {
      dashedBorders: Boolean(settings?.dashedBorders),
      labelPlacement
    };
    globalThis.__a11yToolsHighlightSettings = highlightSettings;

    if (isPageStructureOverlayEnabled()) {
      schedulePageStructureOverlayRender();
    }
    if (interactiveNavigator.enabled) {
      scheduleInteractiveNavigatorRender();
    }
  }

  function updateScanSettings(settings) {
    scanSettings = normalizeScanSettings({
      ...scanSettings,
      ...settings
    });
    globalThis.__a11yToolsScanSettings = scanSettings;

    observeAnalysisShadowRoots();
    observeLiveRegionShadowRoots();
    syncLiveRegionRegistry();
    scheduleLiveRegionsUpdate();
    scheduleAnalysis();
  }

  function updateLocalizedOverlays() {
    const captionOverlay = document.getElementById("a11y-tools-live-region-captions");
    if (captionOverlay) {
      captionOverlay.setAttribute("aria-label", t(pluginLanguage, "content.captionLabel"));
      const closeButton = captionOverlay.querySelector(".a11y-tools-live-region-captions__close");
      if (closeButton) {
        closeButton.setAttribute("aria-label", t(pluginLanguage, "content.closeCaption"));
        closeButton.textContent = "X";
      }
    }

    if (semanticLinearViewEnabled) {
      scheduleSemanticLinearViewRender();
    }
    if (interactiveNavigator.enabled) {
      scheduleInteractiveNavigatorRender();
    }
    if (isPageStructureOverlayEnabled()) {
      schedulePageStructureOverlayRender();
    }
  }

  function startLiveRegionObserver() {
    if (liveRegionObserver) {
      return;
    }

    liveRegionObserver = new MutationObserver(handleLiveRegionMutations);

    liveRegionObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-atomic", "aria-busy", "aria-hidden", "aria-live", "aria-relevant", "hidden", "role", "style"],
      childList: true,
      characterData: true,
      subtree: true
    });
    observeLiveRegionShadowRoots();
  }

  function stopLiveRegionObserver() {
    liveRegionObserver?.disconnect();
    liveRegionObserver = null;
    liveRegionBaseline = new WeakMap();
  }

  function observeAnalysisShadowRoots() {
    if (!scanSettings.includeShadowDom) {
      return;
    }

    for (const host of queryElementsDeep(document, "*", { includeShadowDom: true })) {
      if (!host.shadowRoot || analysisShadowRoots.has(host.shadowRoot)) {
        continue;
      }

      observer.observe(host.shadowRoot, {
        attributes: true,
        attributeFilter: [
          "aria-hidden",
          "aria-label",
          "aria-labelledby",
          "aria-level",
          "hidden",
          "id",
          "role",
          "style"
        ],
        childList: true,
        characterData: true,
        subtree: true
      });
      analysisShadowRoots.add(host.shadowRoot);
    }
  }

  function observeLiveRegionShadowRoots() {
    if (!liveRegionObserver || !scanSettings.includeShadowDom) {
      return;
    }

    for (const host of queryElementsDeep(document, "*", { includeShadowDom: true })) {
      if (!host.shadowRoot || liveRegionShadowRoots.has(host.shadowRoot)) {
        continue;
      }

      liveRegionObserver.observe(host.shadowRoot, {
        attributes: true,
        attributeFilter: ["aria-atomic", "aria-busy", "aria-hidden", "aria-live", "aria-relevant", "hidden", "role", "style"],
        childList: true,
        characterData: true,
        subtree: true
      });
      liveRegionShadowRoots.add(host.shadowRoot);
    }
  }

  function resetLiveRegionBaselines() {
    liveRegionBaseline = new WeakMap();

    for (const region of getLiveRegions()) {
      liveRegionBaseline.set(region, getReadableRegionText(region));
    }
  }

  function handleLiveRegionMutations(mutations) {
    let shouldSync = false;

    for (const mutation of mutations) {
      if (isOwnOverlayMutation(mutation.target)) {
        continue;
      }

      shouldSync = true;
      handleLiveRegionMutation(mutation);
    }

    if (shouldSync) {
      syncLiveRegionRegistry();
      scheduleLiveRegionsUpdate();
    }
  }

  function handleLiveRegionMutation(mutation) {
    if (mutation.type === "attributes") {
      handleLiveRegionAttributeMutation(mutation);
      return;
    }

    const region = getContainingLiveRegion(mutation.target);

    if (region) {
      announceLiveRegionChange(region, mutation.target);
      return;
    }

    if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        if (isLiveRegion(node)) {
          handleAddedLiveRegion(node);
        }

        for (const addedRegion of queryElementsDeep(node, LIVE_REGION_SELECTOR, { includeShadowDom: scanSettings.includeShadowDom })) {
          handleAddedLiveRegion(addedRegion);
        }
      }
    }
  }

  function handleLiveRegionAttributeMutation(mutation) {
    const target = mutation.target;

    if (!(target instanceof Element)) {
      return;
    }

    const region = getContainingLiveRegion(target) ?? (isLiveRegion(target) ? target : null);

    if (region && isExposedToAccessibilityTree(region)) {
      liveRegionBaseline.set(region, getReadableRegionText(region));
    }
  }

  function handleAddedLiveRegion(region) {
    if (!isLiveRegion(region) || !isExposedToAccessibilityTree(region)) {
      return;
    }

    if (shouldAnnounceInitialLiveRegion(region)) {
      liveRegionBaseline.set(region, "");
      announceLiveRegionChange(region, region);
      return;
    }

    liveRegionBaseline.set(region, getReadableRegionText(region));
  }

  function announceLiveRegionChange(region, changedTarget) {
    if (!isLiveRegion(region) || !isExposedToAccessibilityTree(region)) {
      return;
    }

    const previous = liveRegionBaseline.get(region) ?? "";
    const current = getReadableRegionText(region);

    liveRegionBaseline.set(region, current);

    if (!current || current === previous) {
      return;
    }

    const atomic = region.getAttribute("aria-atomic") === "true";
    const candidate = atomic ? current : getReadableChangeText(changedTarget);
    const message = normalizeWhitespace(candidate) || current;

    if (message && message !== previous) {
      recordLiveRegionMessage(region, message);
      if (liveRegionCaptionsEnabled) {
        showLiveRegionCaption(message, getLiveRegionPoliteness(region));
      }
    }
  }

  function getLiveRegions() {
    return queryElementsDeep(document, LIVE_REGION_SELECTOR, { includeShadowDom: scanSettings.includeShadowDom })
      .filter((element) => isLiveRegion(element) && isExposedToAccessibilityTree(element));
  }

  function syncLiveRegionRegistry() {
    for (const record of liveRegionRecords.values()) {
      record.present = false;
      record.duplicatePosition = false;
    }

    const currentRegions = getLiveRegions();
    const recordsByPosition = new Map();

    for (const region of currentRegions) {
      const key = getLiveRegionKey(region);
      const record = liveRegionRecords.get(key) ?? createLiveRegionRecord(region, key);

      updateLiveRegionRecord(record, region);
      record.present = true;
      liveRegionRecords.set(key, record);

      const positionKey = getLiveRegionPositionKey(region);
      const records = recordsByPosition.get(positionKey) ?? [];
      records.push(record);
      recordsByPosition.set(positionKey, records);

      if (!liveRegionBaseline.has(region)) {
        liveRegionBaseline.set(region, getReadableRegionText(region));
      }
    }

    for (const records of recordsByPosition.values()) {
      if (records.length > 1) {
        for (const record of records) {
          record.duplicatePosition = true;
        }
      }
    }
  }

  function scheduleLiveRegionsUpdate() {
    if (liveRegionUpdateScheduled) {
      return;
    }

    liveRegionUpdateScheduled = true;
    requestAnimationFrame(() => {
      liveRegionUpdateScheduled = false;
      sendRuntimeMessage({
        type: "A11Y_TOOLS_LIVE_REGIONS_UPDATE",
        liveRegions: getLiveRegionRecords()
      });
    });
  }

  function createLiveRegionRecord(region, key) {
    return {
      key,
      label: getLiveRegionLabel(region),
      present: true,
      politeness: getLiveRegionPoliteness(region),
      role: getLiveRegionRole(region),
      ariaLive: getEffectiveAriaLive(region),
      ariaAtomic: getEffectiveAriaAtomic(region),
      ariaRelevant: region.getAttribute("aria-relevant") ?? "additions text",
      ariaBusy: region.getAttribute("aria-busy") ?? "false",
      selector: getLiveRegionSelector(region),
      path: getLiveRegionPath(region),
      lastKnownRect: getDocumentRect(region),
      duplicatePosition: false,
      messages: []
    };
  }

  function updateLiveRegionRecord(record, region) {
    record.label = getLiveRegionLabel(region);
    record.politeness = getLiveRegionPoliteness(region);
    record.role = getLiveRegionRole(region);
    record.ariaLive = getEffectiveAriaLive(region);
    record.ariaAtomic = getEffectiveAriaAtomic(region);
    record.ariaRelevant = region.getAttribute("aria-relevant") ?? "additions text";
    record.ariaBusy = region.getAttribute("aria-busy") ?? "false";
    record.selector = getLiveRegionSelector(region);
    record.path = getLiveRegionPath(region);
    record.lastKnownRect = getDocumentRect(region);
  }

  function recordLiveRegionMessage(region, message) {
    const key = getLiveRegionKey(region);
    const record = liveRegionRecords.get(key) ?? createLiveRegionRecord(region, key);
    const previous = record.messages[0];

    if (previous?.text === message) {
      return;
    }

    updateLiveRegionRecord(record, region);
    record.present = true;
    record.messages.unshift({
      text: message,
      time: new Date().toISOString(),
      politeness: getLiveRegionPoliteness(region)
    });
    record.messages = record.messages.slice(0, 30);
    liveRegionRecords.set(key, record);
    scheduleLiveRegionsUpdate();
  }

  function getLiveRegionRecords() {
    return Array.from(liveRegionRecords.values())
      .sort((first, second) => Number(second.present) - Number(first.present) || first.path.localeCompare(second.path));
  }

  function getLiveRegionKey(region) {
    return `${getLiveRegionPath(region)}|${getLiveRegionRole(region)}|${getEffectiveAriaLive(region)}`;
  }

  function getLiveRegionPositionKey(region) {
    return `${getParentPath(region)}|${getLiveRegionRole(region)}|${getEffectiveAriaLive(region)}`;
  }

  function getLiveRegionPath(region) {
    const parts = [];

    for (let current = region; current && current !== document.documentElement; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children ?? []).filter((sibling) => sibling.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }

    return parts.join(">");
  }

  function getParentPath(region) {
    return region.parentElement ? getLiveRegionPath(region.parentElement) : "";
  }

  function getLiveRegionLabel(region) {
    const role = getLiveRegionRole(region) || "live region";
    const ariaLive = getEffectiveAriaLive(region);
    const id = region.id ? `#${region.id}` : "";
    return `${role}${id ? ` ${id}` : ""} (${ariaLive})`;
  }

  function getLiveRegionSelector(region) {
    return region.id ? `#${CSS.escape(region.id)}` : getLiveRegionPath(region);
  }

  function getContainingLiveRegion(target) {
    const element = target instanceof Element ? target : target.parentElement;

    for (let current = getClosestComposedElement(element, LIVE_REGION_SELECTOR); current; current = getClosestComposedElement(getComposedParentElement(current), LIVE_REGION_SELECTOR)) {
      if (isLiveRegion(current)) {
        return current;
      }
    }

    return null;
  }

  function isLiveRegion(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const ariaLive = element.getAttribute("aria-live")?.trim().toLowerCase();
    const role = getLiveRegionRole(element);

    if (ariaLive === "off") {
      return role === "alert";
    }

    return Boolean(
      ariaLive === "assertive" ||
      ariaLive === "polite" ||
      role === "alert" ||
      role === "log" ||
      role === "status"
    );
  }

  function getLiveRegionPoliteness(region) {
    const ariaLive = region.getAttribute("aria-live")?.trim().toLowerCase();
    const role = getLiveRegionRole(region);

    if (ariaLive === "assertive" || role === "alert") {
      return "Assertive";
    }

    return "Polite";
  }

  function getLocalizedLiveRegionPoliteness(politeness) {
    return politeness === "Assertive"
      ? t(pluginLanguage, "content.politeness.assertive")
      : t(pluginLanguage, "content.politeness.polite");
  }

  function getImplicitAriaLive(region) {
    const role = getLiveRegionRole(region);

    if (role === "alert") {
      return "assertive";
    }

    if (role === "log" || role === "status") {
      return "polite";
    }

    if (role === "timer" || role === "marquee") {
      return "off";
    }

    return "polite";
  }

  function getEffectiveAriaLive(region) {
    return region.getAttribute("aria-live")?.trim().toLowerCase() || getImplicitAriaLive(region);
  }

  function getImplicitAriaAtomic(region) {
    const role = getLiveRegionRole(region);
    return role === "alert" || role === "status" ? "true" : "false";
  }

  function getEffectiveAriaAtomic(region) {
    return region.getAttribute("aria-atomic")?.trim().toLowerCase() || getImplicitAriaAtomic(region);
  }

  function getLiveRegionRole(region) {
    const explicitRole = region.getAttribute("role")?.trim().toLowerCase();
    if (explicitRole) {
      return explicitRole;
    }

    return region.tagName.toLowerCase() === "output" ? "status" : "";
  }

  function shouldAnnounceInitialLiveRegion(region) {
    return getLiveRegionRole(region) === "alert";
  }

  function getReadableRegionText(region) {
    if (!isExposedToAccessibilityTree(region)) {
      return "";
    }

    return normalizeWhitespace(region.textContent ?? "");
  }

  function getReadableChangeText(target) {
    if (target instanceof Text) {
      return target.textContent ?? "";
    }

    if (target instanceof Element) {
      if (!isExposedToAccessibilityTree(target)) {
        return "";
      }

      return target.textContent ?? "";
    }

    return "";
  }

  function ensureLiveRegionCaptionOverlay() {
    if (document.getElementById("a11y-tools-live-region-captions")) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "a11y-tools-live-region-captions";
    overlay.setAttribute("role", "group");
    overlay.setAttribute("aria-label", t(pluginLanguage, "content.captionLabel"));
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="a11y-tools-live-region-captions__header">
        <div class="a11y-tools-live-region-captions__label"></div>
        <button class="a11y-tools-live-region-captions__close" type="button" aria-label="${escapeHtml(t(pluginLanguage, "content.closeCaption"))}">X</button>
      </div>
      <div class="a11y-tools-live-region-captions__message"></div>
    `;

    const style = document.createElement("style");
    style.id = "a11y-tools-live-region-captions-style";
    style.textContent = `
      #a11y-tools-live-region-captions {
        position: fixed;
        left: 50%;
        bottom: var(--a11y-tools-caption-bottom, 32px);
        top: var(--a11y-tools-caption-top, auto);
        z-index: 2147483647;
        width: min(760px, calc(100vw - 32px));
        transform: translateX(-50%);
        padding: 14px 18px;
        border: 2px solid var(--a11y-tools-caption-text-color, #ffffff);
        border-radius: 8px;
        background: var(--a11y-tools-caption-background, rgba(10, 15, 25, 0.94));
        color: var(--a11y-tools-caption-text-color, #ffffff);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
        pointer-events: auto;
      }

      #a11y-tools-live-region-captions[hidden] {
        display: none;
      }

      .a11y-tools-live-region-captions__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 4px;
      }

      .a11y-tools-live-region-captions__label {
        color: var(--a11y-tools-caption-accent-color, #9ee7dd);
        font-size: 12px;
        font-weight: 800;
        line-height: 1.5;
      }

      .a11y-tools-live-region-captions__close {
        flex: 0 0 auto;
        border: 2px solid var(--a11y-tools-caption-text-color, #ffffff);
        border-radius: 6px;
        background: transparent;
        color: var(--a11y-tools-caption-text-color, #ffffff);
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        inline-size: 32px;
        block-size: 32px;
        line-height: 1;
        padding: 0;
      }

      .a11y-tools-live-region-captions__close:focus-visible {
        outline: 3px solid var(--a11y-tools-caption-accent-color, #9ee7dd);
        outline-offset: 2px;
      }

      .a11y-tools-live-region-captions__message {
        color: var(--a11y-tools-caption-text-color, #ffffff);
        font-size: var(--a11y-tools-caption-font-size, 20px);
        font-weight: 700;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
    `;

    document.documentElement.append(style, overlay);
    applyLiveRegionCaptionSettings();

    overlay.querySelector(".a11y-tools-live-region-captions__close")?.addEventListener("click", () => {
      window.clearTimeout(liveRegionCaptionTimer);
      overlay.hidden = true;
    });
  }

  function removeLiveRegionCaptionOverlay() {
    window.clearTimeout(liveRegionCaptionTimer);
    document.getElementById("a11y-tools-live-region-captions")?.remove();
    document.getElementById("a11y-tools-live-region-captions-style")?.remove();
  }

  function applyLiveRegionCaptionSettings() {
    const overlay = document.getElementById("a11y-tools-live-region-captions");

    if (!overlay) {
      return;
    }

    const rgb = hexToRgb(liveRegionCaptionSettings.backgroundColor);
    const opacity = liveRegionCaptionSettings.backgroundOpacity / 100;
    const fontSizeBySetting = {
      small: "16px",
      medium: "20px",
      large: "26px",
      "extra-large": "34px"
    };

    overlay.style.setProperty("--a11y-tools-caption-background", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
    overlay.style.setProperty("--a11y-tools-caption-text-color", liveRegionCaptionSettings.textColor);
    overlay.style.setProperty("--a11y-tools-caption-font-size", fontSizeBySetting[liveRegionCaptionSettings.textSize] ?? "20px");
    overlay.style.setProperty("--a11y-tools-caption-accent-color", getReadableAccentColor(liveRegionCaptionSettings.textColor));
    overlay.style.setProperty("--a11y-tools-caption-top", liveRegionCaptionSettings.position === "top" ? "32px" : "auto");
    overlay.style.setProperty("--a11y-tools-caption-bottom", liveRegionCaptionSettings.position === "bottom" ? "32px" : "auto");
  }

  function showLiveRegionCaption(message, politeness) {
    ensureLiveRegionCaptionOverlay();

    const overlay = document.getElementById("a11y-tools-live-region-captions");
    const label = overlay?.querySelector(".a11y-tools-live-region-captions__label");
    const messageNode = overlay?.querySelector(".a11y-tools-live-region-captions__message");

    if (!overlay || !label || !messageNode) {
      return;
    }

    label.textContent = `${getLocalizedLiveRegionPoliteness(politeness)} ${t(pluginLanguage, "content.liveRegion")}`;
    messageNode.textContent = message;
    overlay.hidden = false;

    window.clearTimeout(liveRegionCaptionTimer);

    if (liveRegionCaptionSettings.autoHide) {
      liveRegionCaptionTimer = window.setTimeout(() => {
        overlay.hidden = true;
      }, liveRegionCaptionSettings.autoHideSeconds * 1000);
    }
  }

  function revealLiveRegion(key) {
    const region = getLiveRegions().find((candidate) => getLiveRegionKey(candidate) === key);

    if (region) {
      addLiveRegionMarker(region, false);
      return;
    }

    const record = liveRegionRecords.get(key);
    if (record) {
      addRemovedLiveRegionMarker(record);
      return;
    }

    showPageStatusMessage(t(pluginLanguage, "content.removedNoPosition"));
  }

  function addLiveRegionMarker(region, removed) {
    const label = removed ? t(pluginLanguage, "content.removedLiveRegion") : t(pluginLanguage, "content.liveRegion");
    const scrollTarget = getRevealScrollElement(region);
    const requestId = ++liveRegionMarkerRequestId;

    removeLiveRegionMarker();

    scrollTarget.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "nearest"
    });

    afterScrollLayoutSettles(scrollTarget, () => {
      if (requestId !== liveRegionMarkerRequestId) {
        return;
      }

      const ownRect = region.getBoundingClientRect();

      if (hasVisibleRevealRect(ownRect) && addMarkerAtRect(ownRect, label)) {
        activeLiveRegionMarker = {
          sourceElement: region,
          type: "box",
          label,
          requestId
        };
        return;
      }

      const descendantTarget = getVisibleDescendantRevealTarget(region);

      if (descendantTarget && addMarkerAtRect(descendantTarget.rect, `${label}: ${t(pluginLanguage, "content.visibleContents")}`)) {
        activeLiveRegionMarker = {
          sourceElement: descendantTarget.element,
          type: "box",
          label: `${label}: ${t(pluginLanguage, "content.visibleContents")}`,
          requestId
        };
        return;
      }

      const approximateRect = getApproximateLiveRegionRect(region);

      if (approximateRect && addPointMarkerAtRect(approximateRect, label)) {
        activeLiveRegionMarker = {
          sourceElement: region,
          type: "point",
          label,
          requestId
        };
        return;
      }

      showPageStatusMessage(t(pluginLanguage, "content.noVisibleBox"));
    });
  }

  function addRemovedLiveRegionMarker(record) {
    const candidate = document.querySelector(record.path);

    if (candidate instanceof Element) {
      addLiveRegionMarker(candidate, true);
      return;
    }

    if (record.lastKnownRect) {
      scrollToDocumentRect(record.lastKnownRect);
      requestAnimationFrame(() => {
        const viewportRect = documentRectToViewportRect(record.lastKnownRect);

        if (!addMarkerAtRect(viewportRect, t(pluginLanguage, "content.removedWasHere"))) {
          showPageStatusMessage(t(pluginLanguage, "content.removedOutside"));
        }
      });
      return;
    }

    showPageStatusMessage(t(pluginLanguage, "content.removedNoPosition"));
  }

  function addMarkerAtRect(rect, label) {
    if (!hasVisibleRevealRect(rect)) {
      return false;
    }

    activeLiveRegionMarker = null;
    document.getElementById("a11y-tools-live-region-marker")?.remove();
    document.getElementById("a11y-tools-page-status")?.remove();

    const marker = document.createElement("div");
    marker.id = "a11y-tools-live-region-marker";
    marker.textContent = label;
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = `
      position: fixed;
      left: ${Math.max(8, rect.left)}px;
      top: ${Math.max(8, rect.top)}px;
      min-width: ${Math.max(36, rect.width)}px;
      min-height: ${Math.max(28, rect.height)}px;
      z-index: 2147483646;
      border: 4px solid #004a99;
      background: rgba(234, 243, 255, 0.35);
      color: #001b3d;
      font: 800 13px/1.5 ui-sans-serif, system-ui, sans-serif;
      padding: 4px 8px;
      pointer-events: none;
    `;

    document.documentElement.append(marker);
    window.clearTimeout(liveRegionMarkerTimer);
    liveRegionMarkerTimer = window.setTimeout(removeLiveRegionMarker, 4500);
    return true;
  }

  function addPointMarkerAtRect(rect, label) {
    const left = clamp(rect.left + rect.width / 2, 16, window.innerWidth - 16);
    const top = clamp(rect.top + rect.height / 2, 16, window.innerHeight - 16);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return false;
    }

    document.getElementById("a11y-tools-live-region-marker")?.remove();
    document.getElementById("a11y-tools-page-status")?.remove();

    const marker = document.createElement("div");
    marker.id = "a11y-tools-live-region-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      z-index: 2147483646;
      width: 0;
      height: 0;
      pointer-events: none;
      font: 800 13px/1.5 ui-sans-serif, system-ui, sans-serif;
    `;

    const pin = document.createElement("div");
    pin.style.cssText = `
      position: absolute;
      left: -14px;
      top: -14px;
      box-sizing: border-box;
      width: 28px;
      height: 28px;
      border: 4px ${getHighlightBorderStyle()} #004a99;
      border-radius: 999px;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.95), 0 8px 24px rgba(0, 0, 0, 0.35);
    `;

    const dot = document.createElement("div");
    dot.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: 8px;
      height: 8px;
      transform: translate(-50%, -50%);
      border-radius: 999px;
      background: #004a99;
    `;

    const labelNode = document.createElement("div");
    labelNode.textContent = label;
    labelNode.style.cssText = `
      position: absolute;
      left: 18px;
      top: -16px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 6px 8px;
      border: 2px ${getHighlightBorderStyle()} #ffffff;
      border-radius: 4px;
      background: #004a99;
      color: #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      overflow-wrap: break-word;
    `;

    pin.append(dot);
    marker.append(pin, labelNode);
    document.documentElement.append(marker);
    clampPointMarkerLabel(marker, labelNode);
    window.clearTimeout(liveRegionMarkerTimer);
    liveRegionMarkerTimer = window.setTimeout(removeLiveRegionMarker, 4500);
    return true;
  }

  function updatePointMarkerAtRect(marker, rect) {
    if (!hasViewportPosition(rect)) {
      removeLiveRegionMarker();
      return false;
    }

    const left = rect.left + rect.width / 2;
    const top = rect.top + rect.height / 2;

    if (left < 0 || left > window.innerWidth || top < 0 || top > window.innerHeight) {
      removeLiveRegionMarker();
      return false;
    }

    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;

    const labelNode = marker.lastElementChild;
    if (labelNode) {
      labelNode.style.left = "18px";
      labelNode.style.top = "-16px";
      clampPointMarkerLabel(marker, labelNode);
    }

    return true;
  }

  function updateBoxMarkerAtRect(marker, rect) {
    if (!hasVisibleRevealRect(rect)) {
      removeLiveRegionMarker();
      return false;
    }

    marker.style.left = `${Math.max(8, rect.left)}px`;
    marker.style.top = `${Math.max(8, rect.top)}px`;
    marker.style.minWidth = `${Math.max(36, rect.width)}px`;
    marker.style.minHeight = `${Math.max(28, rect.height)}px`;
    return true;
  }

  function scheduleLiveRegionMarkerUpdate() {
    if (!activeLiveRegionMarker || liveRegionMarkerUpdateScheduled) {
      return;
    }

    liveRegionMarkerUpdateScheduled = true;
    requestAnimationFrame(() => {
      liveRegionMarkerUpdateScheduled = false;

      if (!activeLiveRegionMarker || activeLiveRegionMarker.requestId !== liveRegionMarkerRequestId) {
        return;
      }

      const marker = document.getElementById("a11y-tools-live-region-marker");
      if (!marker || !document.documentElement.contains(activeLiveRegionMarker.sourceElement)) {
        removeLiveRegionMarker();
        return;
      }

      if (activeLiveRegionMarker.type === "box") {
        updateBoxMarkerAtRect(marker, activeLiveRegionMarker.sourceElement.getBoundingClientRect());
        return;
      }

      const rect = getApproximateLiveRegionRect(activeLiveRegionMarker.sourceElement);

      if (!rect) {
        removeLiveRegionMarker();
        return;
      }

      updatePointMarkerAtRect(marker, rect);
    });
  }

  function removeLiveRegionMarker() {
    activeLiveRegionMarker = null;
    window.clearTimeout(liveRegionMarkerTimer);
    document.getElementById("a11y-tools-live-region-marker")?.remove();
    document.getElementById("a11y-tools-page-status")?.remove();
  }

  function clampPointMarkerLabel(marker, labelNode) {
    const viewportPadding = 8;
    const markerRect = marker.getBoundingClientRect();
    const labelRect = labelNode.getBoundingClientRect();
    const maxLeft = Math.max(viewportPadding, window.innerWidth - labelRect.width - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - labelRect.height - viewportPadding);
    const clampedLeft = Math.max(viewportPadding, Math.min(labelRect.left, maxLeft));
    const clampedTop = Math.max(viewportPadding, Math.min(labelRect.top, maxTop));

    labelNode.style.left = `${clampedLeft - markerRect.left}px`;
    labelNode.style.top = `${clampedTop - markerRect.top}px`;
  }

  function getApproximateLiveRegionRect(region) {
    const rects = [
      region.getBoundingClientRect(),
      ...Array.from(region.getClientRects())
    ];
    const usableRect = rects.find((rect) => hasViewportPosition(rect));

    if (usableRect) {
      return toPointRect(usableRect);
    }

    return measureElementInsertionPoint(region);
  }

  function measureElementInsertionPoint(element) {
    const parent = element.parentNode;

    if (!parent) {
      return null;
    }

    const probe = document.createElement("span");
    probe.id = "a11y-tools-live-region-position-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `
      display: inline-block;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
    `;

    parent.insertBefore(probe, element);
    const rect = probe.getBoundingClientRect();
    probe.remove();

    return hasViewportPosition(rect) ? toPointRect(rect) : null;
  }

  function hasViewportPosition(rect) {
    return Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function toPointRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + Math.max(1, rect.width),
      bottom: rect.top + Math.max(1, rect.height),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
  }

  function showPageStatusMessage(message) {
    document.getElementById("a11y-tools-live-region-marker")?.remove();
    document.getElementById("a11y-tools-page-status")?.remove();

    const status = document.createElement("div");
    status.id = "a11y-tools-page-status";
    status.textContent = message;
    status.setAttribute("aria-hidden", "true");
    status.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 2147483646;
      width: min(520px, calc(100vw - 32px));
      transform: translateX(-50%);
      border: 3px solid #004a99;
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
      font: 800 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      padding: 12px 14px;
      pointer-events: none;
    `;

    document.documentElement.append(status);
    window.setTimeout(() => status.remove(), 4500);
  }

  function getDocumentRect(element) {
    const rect = element.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  function scrollToDocumentRect(rect) {
    const left = Math.max(0, rect.x + rect.width / 2 - window.innerWidth / 2);
    const top = Math.max(0, rect.y + rect.height / 2 - window.innerHeight / 2);

    window.scrollTo({
      left,
      top,
      behavior: "auto"
    });
  }

  function documentRectToViewportRect(rect) {
    return {
      left: rect.x - window.scrollX,
      top: rect.y - window.scrollY,
      right: rect.x - window.scrollX + rect.width,
      bottom: rect.y - window.scrollY + rect.height,
      width: rect.width,
      height: rect.height
    };
  }

  function isOwnOverlayMutation(target) {
    if (target instanceof MutationRecord) {
      const nodes = [...target.addedNodes, ...target.removedNodes];

      if (nodes.length > 0 && nodes.every(isOwnOverlayNode)) {
        return true;
      }

      return isOwnOverlayNode(target.target);
    }

    return isOwnOverlayNode(target);
  }

  function isOwnOverlayNode(node) {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest?.("#a11y-tools-live-region-captions,#a11y-tools-live-region-marker,#a11y-tools-live-region-position-probe,#a11y-tools-page-status,#a11y-tools-live-region-captions-style,#a11y-tools-page-structure-overlay,#a11y-tools-page-structure-overlay-style,#a11y-tools-linear-view,#a11y-tools-linear-view-style,#a11y-tools-interactive-navigator,#a11y-tools-interactive-navigator-style,#a11y-tools-text-resize-badge,#a11y-tools-reveal-highlight"));
  }

  function setPageStructureOverlay(overlay) {
    pageStructureOverlay = normalizePageStructureOverlay(overlay);

    if (pageStructureOverlay.interactive && interactiveNavigator.enabled) {
      setInteractiveNavigatorEnabled(false);
    }

    if (!isPageStructureOverlayEnabled()) {
      removePageStructureOverlay();
      return;
    }

    schedulePageStructureOverlayRender(getAnalysis());
  }

  function schedulePageStructureOverlayRender(analysis = null) {
    if (pageStructureOverlayScheduled) {
      return;
    }

    pageStructureOverlayScheduled = true;
    requestAnimationFrame(() => {
      pageStructureOverlayScheduled = false;
      renderPageStructureOverlay(analysis ?? getAnalysis());
    });
  }

  function renderPageStructureOverlay(analysis) {
    if (!isPageStructureOverlayEnabled()) {
      return;
    }

    removePageStructureOverlay();

    const overlay = document.createElement("div");
    overlay.id = "a11y-tools-page-structure-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const style = document.createElement("style");
    style.id = "a11y-tools-page-structure-overlay-style";
    style.textContent = `
      #a11y-tools-page-structure-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        pointer-events: none;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .a11y-tools-page-structure-overlay__markers,
      .a11y-tools-page-structure-overlay__labels {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      .a11y-tools-page-structure-overlay__markers {
        z-index: 1;
      }

      .a11y-tools-page-structure-overlay__labels {
        z-index: 2;
      }

      .a11y-tools-page-structure-marker {
        position: fixed;
        min-width: 48px;
        min-height: 28px;
        background: rgba(234, 243, 255, 0.2);
        --a11y-tools-marker-color: #005fcc;
        --a11y-tools-highlight-border-style: ${getHighlightBorderStyle()};
      }

      .a11y-tools-page-structure-marker--landmark {
        --a11y-tools-marker-color: #0b5d56;
        background: rgba(226, 255, 250, 0.2);
      }

      .a11y-tools-page-structure-marker--graphic {
        --a11y-tools-marker-color: #7a3b00;
        background: rgba(255, 244, 230, 0.2);
      }

      .a11y-tools-page-structure-marker--graphic-small {
        min-width: 0;
        min-height: 0;
      }

	      .a11y-tools-page-structure-marker--aria-label {
	        --a11y-tools-marker-color: #5a2d82;
	        background: rgba(246, 239, 255, 0.2);
	      }

	      .a11y-tools-page-structure-marker--interactive {
	        --a11y-tools-marker-color: #005fcc;
	        background: rgba(234, 243, 255, 0.2);
	      }

      .a11y-tools-page-structure-marker--outside-landmark {
        --a11y-tools-marker-color: #8a4a00;
        background: rgba(255, 248, 230, 0.22);
      }

      .a11y-tools-page-structure-marker--table {
        --a11y-tools-marker-color: #10546b;
        background: rgba(226, 250, 255, 0.18);
      }

      .a11y-tools-page-structure-marker--table-header {
        --a11y-tools-marker-color: #8b1f4d;
        background: rgba(255, 232, 243, 0.22);
      }

      .a11y-tools-page-structure-marker--table-cell {
        --a11y-tools-marker-color: #4f5f00;
        background: rgba(250, 255, 214, 0.2);
      }

      .a11y-tools-page-structure-marker--inset {
        outline: 3px var(--a11y-tools-highlight-border-style) var(--a11y-tools-marker-color);
        outline-offset: ${getHighlightBorderStyle() === "dashed" ? "-5px" : "-9px"};
        box-shadow: ${getPageStructureInsetBoxShadow()};
      }

      .a11y-tools-page-structure-marker--outside {
        border: 3px var(--a11y-tools-highlight-border-style) var(--a11y-tools-marker-color);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95), 0 8px 20px rgba(0, 0, 0, 0.25);
      }

      .a11y-tools-page-structure-marker__label {
        --a11y-tools-marker-color: #005fcc;
        --a11y-tools-highlight-border-style: ${getHighlightBorderStyle()};
        display: inline-block;
        box-sizing: border-box;
        position: fixed;
        z-index: 2;
        padding: 4px 8px;
        border: 2px var(--a11y-tools-highlight-border-style) #ffffff;
        border-radius: 4px;
        background: var(--a11y-tools-marker-color);
        color: #ffffff;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.35;
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: auto;
        white-space: normal;
        inline-size: max-content;
        max-inline-size: min(340px, calc(100vw - 24px));
      }

      .a11y-tools-page-structure-marker__label--landmark {
        --a11y-tools-marker-color: #0b5d56;
      }

      .a11y-tools-page-structure-marker__label--graphic {
        --a11y-tools-marker-color: #7a3b00;
        max-inline-size: min(260px, calc(100vw - 24px));
      }

      .a11y-tools-page-structure-marker__label--aria-label {
        --a11y-tools-marker-color: #5a2d82;
      }

      .a11y-tools-page-structure-marker__label--outside-landmark {
        --a11y-tools-marker-color: #8a4a00;
        border-style: dashed;
      }

      .a11y-tools-page-structure-marker__label--table {
        --a11y-tools-marker-color: #10546b;
      }

      .a11y-tools-page-structure-marker__label--table-header {
        --a11y-tools-marker-color: #8b1f4d;
        padding: 3px 6px;
        font-size: 12px;
      }

      .a11y-tools-page-structure-marker__label--table-cell {
        --a11y-tools-marker-color: #4f5f00;
        padding: 3px 6px;
        font-size: 12px;
      }

      .a11y-tools-page-structure-marker--outside .a11y-tools-page-structure-marker__label {
        margin: -3px 0 0 -3px;
      }

      .a11y-tools-page-structure-marker--inset .a11y-tools-page-structure-marker__label {
        margin: 9px 0 0 9px;
      }

      .a11y-tools-page-structure-marker--outside-landmark.a11y-tools-page-structure-marker--inset {
        outline-style: dashed;
        outline-offset: -5px;
        box-shadow: inset 0 0 0 5px rgba(255, 255, 255, 0.92), 0 0 0 2px rgba(255, 255, 255, 0.95);
      }

      .a11y-tools-page-structure-marker--outside-landmark.a11y-tools-page-structure-marker--outside {
        border-style: dashed;
      }
    `;

    document.documentElement.append(style, overlay);
    const markerLayer = document.createElement("div");
    markerLayer.className = "a11y-tools-page-structure-overlay__markers";
    const labelLayer = document.createElement("div");
    labelLayer.className = "a11y-tools-page-structure-overlay__labels";
    overlay.append(markerLayer, labelLayer);
    const placedLabelRects = [];

    if (pageStructureOverlay.headings) {
      for (const heading of analysis.headings ?? []) {
        const element = findElementByIdDeep(document, heading.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (!element) {
          continue;
        }

        addPageStructureMarker(overlay, element, `H${heading.level}`, "heading", placedLabelRects);
      }
    }

    if (pageStructureOverlay.landmarks) {
      const landmarkStructure = Array.isArray(analysis.landmarkStructure) && analysis.landmarkStructure.length > 0
        ? analysis.landmarkStructure
        : (analysis.landmarks ?? []).map((landmark) => ({ ...landmark, type: "landmark" }));

      for (const landmark of landmarkStructure) {
        if (landmark.type === "content") {
          addOutsideLandmarkPageStructureMarker(overlay, landmark, placedLabelRects);
          continue;
        }

        const element = findElementByIdDeep(document, landmark.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (!element) {
          continue;
        }

        addPageStructureMarker(overlay, element, getLandmarkOverlayLabel(landmark), "landmark", placedLabelRects);
      }
    }

    if (pageStructureOverlay.graphics) {
      for (const graphic of analysis.graphics ?? []) {
        const element = findElementByIdDeep(document, graphic.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (!element) {
          continue;
        }

        addPageStructureMarker(overlay, element, getGraphicOverlayLabel(graphic), "graphic", placedLabelRects);
      }
    }

    if (pageStructureOverlay.ariaLabels) {
      for (const item of analysis.ariaLabels ?? []) {
        const element = findElementByIdDeep(document, item.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (!element) {
          continue;
        }

        addPageStructureMarker(overlay, element, `${item.source}: ${item.name || "unnamed"}`, "aria-label", placedLabelRects);
      }
    }

    if (pageStructureOverlay.interactive) {
      for (const [index, item] of (analysis.interactiveItems ?? []).entries()) {
        const element = findElementByIdDeep(document, item.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (!element || !item.exposed) {
          continue;
        }

        addPageStructureMarker(overlay, element, `${index + 1}: ${item.role || "item"}`, "interactive", placedLabelRects);
      }
    }

    if (pageStructureOverlay.tables) {
      for (const [index, table] of (analysis.tables ?? []).entries()) {
        const element = findElementByIdDeep(document, table.id, { includeShadowDom: scanSettings.includeShadowDom });
        if (element) {
          addPageStructureMarker(overlay, element, getTableOverlayLabel(table, index), "table", placedLabelRects);
        }

        for (const cell of table.cells ?? []) {
          const cellElement = findElementByIdDeep(document, cell.id, { includeShadowDom: scanSettings.includeShadowDom });
          if (!cellElement) {
            continue;
          }

          addPageStructureMarker(overlay, cellElement, getTableCellOverlayLabel(cell), isTableHeaderCell(cell) ? "table-header" : "table-cell", placedLabelRects);
        }
      }
    }

    if (markerLayer.childElementCount === 0) {
      removePageStructureOverlay();
      return;
    }
  }

  function addPageStructureMarker(overlay, element, label, type, placedLabelRects = []) {
    const rect = element.getBoundingClientRect();

    if (!hasUsableRect(rect)) {
      return;
    }

    addPageStructureMarkerAtRect(overlay, rect, label, type, placedLabelRects);
  }

  function addOutsideLandmarkPageStructureMarker(overlay, item, placedLabelRects = []) {
    const rects = (item.elementIds ?? [])
      .map((id) => findElementByIdDeep(document, id, { includeShadowDom: scanSettings.includeShadowDom }))
      .filter(Boolean)
      .map((element) => element.getBoundingClientRect())
      .filter(hasUsableRect);

    if (rects.length === 0) {
      return;
    }

    addPageStructureMarkerAtRect(overlay, getBoundingRectUnion(rects), t(pluginLanguage, "landmarks.gap"), "outside-landmark", placedLabelRects);
  }

  function addPageStructureMarkerAtRect(overlay, rect, label, type, placedLabelRects = []) {
    const markerLayer = overlay.querySelector(".a11y-tools-page-structure-overlay__markers") ?? overlay;
    const labelLayer = overlay.querySelector(".a11y-tools-page-structure-overlay__labels") ?? overlay;
    const marker = document.createElement("div");
    const isGraphic = type === "graphic";
    const isSmallGraphic = isGraphic && (rect.width < 44 || rect.height < 44);
    const useInsetBorder = !isSmallGraphic && rect.width >= 96 && rect.height >= 56;
    marker.className = [
      "a11y-tools-page-structure-marker",
      `a11y-tools-page-structure-marker--${type}`,
      isSmallGraphic ? "a11y-tools-page-structure-marker--graphic-small" : "",
      useInsetBorder ? "a11y-tools-page-structure-marker--inset" : "a11y-tools-page-structure-marker--outside"
    ].filter(Boolean).join(" ");

    if (useInsetBorder) {
      const left = clamp(rect.left, 0, window.innerWidth - 24);
      const top = clamp(rect.top, 0, window.innerHeight - 24);
      const right = clamp(rect.right, left + 48, window.innerWidth);
      const bottom = clamp(rect.bottom, top + 28, window.innerHeight);

      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
      marker.style.width = `${right - left}px`;
      marker.style.height = `${bottom - top}px`;
    } else {
      marker.style.left = `${clamp(rect.left, 8, window.innerWidth - 24)}px`;
      marker.style.top = `${clamp(rect.top, 8, window.innerHeight - 24)}px`;
      marker.style.width = `${Math.max(isSmallGraphic ? 18 : 48, Math.min(rect.width, window.innerWidth - 16))}px`;
      marker.style.height = `${Math.max(isSmallGraphic ? 18 : 28, Math.min(rect.height, window.innerHeight - 16))}px`;
    }

    const labelNode = document.createElement("span");
    labelNode.className = `a11y-tools-page-structure-marker__label a11y-tools-page-structure-marker__label--${type}`;
    labelNode.textContent = label;
    markerLayer.append(marker);
    labelLayer.append(labelNode);
    clampPageStructureLabel(marker, labelNode, getPageStructureMarkerLabelPlacement(type, isSmallGraphic, useInsetBorder), placedLabelRects);
  }

  function getPageStructureMarkerLabelPlacement(type, isSmallGraphic, useInsetBorder) {
    const placement = isSmallGraphic ? getSmallMarkerLabelPlacement() : getHighlightLabelPlacement();

    if (type === "table-header" || type === "table-cell") {
      return "inside";
    }

    if ((type === "landmark" || type === "outside-landmark") && useInsetBorder) {
      return "inside";
    }

    return placement;
  }

  function clampPageStructureLabel(marker, labelNode, placement, placedLabelRects = []) {
    const viewportPadding = 8;

    labelNode.style.left = "";
    labelNode.style.top = "";
    labelNode.style.margin = "0";
    labelNode.style.maxWidth = "";
    labelNode.style.minWidth = "";
    labelNode.style.textAlign = "";
    labelNode.style.width = "max-content";
    labelNode.style.position = "fixed";
    labelNode.style.whiteSpace = "";

    if (placement === "inside" && canFitLabelInsideMarker(marker, labelNode, viewportPadding)) {
      positionInsidePageStructureMarker(marker, labelNode, viewportPadding, placedLabelRects);
      return;
    }

    labelNode.style.left = "0";
    labelNode.style.top = "0";
    labelNode.style.minWidth = `${getReadableLabelMinWidth()}px`;
    labelNode.style.maxWidth = `${getReadableLabelMaxWidth(viewportPadding)}px`;

    const markerRect = marker.getBoundingClientRect();
    const measuredRect = labelNode.getBoundingClientRect();
    const labelWidth = Math.min(measuredRect.width, window.innerWidth - viewportPadding * 2);
    const labelHeight = Math.min(measuredRect.height, window.innerHeight - viewportPadding * 2);
    const gap = 8;
    const position = findReadableLabelPosition(markerRect, labelWidth, labelHeight, placement === "inside" ? getBestOutsideLabelPlacement(markerRect, labelWidth) : placement, gap, viewportPadding, placedLabelRects);

    applyLabelPosition(labelNode, markerRect, position.viewportLeft, position.viewportTop);
    placedLabelRects.push({ left: position.viewportLeft, top: position.viewportTop, right: position.viewportLeft + labelWidth, bottom: position.viewportTop + labelHeight });
  }

  function positionInsidePageStructureMarker(marker, labelNode, viewportPadding, placedLabelRects = []) {
    const markerRect = marker.getBoundingClientRect();
    const inset = marker.classList.contains("a11y-tools-page-structure-marker--inset") ? 9 : 0;
    const viewportMaxWidth = Math.max(96, window.innerWidth - viewportPadding * 2);
    const insideMaxWidth = Math.max(96, markerRect.width - inset * 2);
    const preferredMaxWidth = Math.min(340, Math.max(insideMaxWidth, viewportMaxWidth * 0.5));

    labelNode.style.maxWidth = `${Math.min(preferredMaxWidth, viewportMaxWidth)}px`;
    labelNode.style.minWidth = "";
    labelNode.style.width = "max-content";
    labelNode.style.left = "0";
    labelNode.style.top = "0";

    const markerCenter = markerRect.left + markerRect.width / 2;
    const shouldRightAlign = markerCenter > window.innerWidth / 2;
    const availableRightAlignedWidth = Math.max(96, markerRect.right - viewportPadding - inset);
    const availableLeftAlignedWidth = Math.max(96, window.innerWidth - markerRect.left - viewportPadding - inset);

    if (shouldRightAlign) {
      labelNode.style.maxWidth = `${Math.min(340, availableRightAlignedWidth)}px`;
    } else {
      labelNode.style.maxWidth = `${Math.min(340, availableLeftAlignedWidth)}px`;
    }

    const measuredRect = labelNode.getBoundingClientRect();
    const width = Math.min(measuredRect.width, window.innerWidth - viewportPadding * 2);
    const height = Math.min(measuredRect.height, window.innerHeight - viewportPadding * 2);
    const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - height - viewportPadding);
    const preferredLeft = shouldRightAlign
      ? markerRect.right - inset - width
      : markerRect.left + inset;
    const preferredTop = markerRect.top + inset;
    const viewportLeft = clamp(preferredLeft, viewportPadding, maxLeft);
    const viewportTop = clamp(preferredTop, viewportPadding, maxTop);

    labelNode.style.textAlign = shouldRightAlign ? "right" : "left";
    applyLabelPosition(labelNode, markerRect, viewportLeft, viewportTop);
    placedLabelRects.push({ left: viewportLeft, top: viewportTop, right: viewportLeft + width, bottom: viewportTop + height });
  }

  function getPreferredLabelPosition(markerRect, labelWidth, labelHeight, placement, gap) {
    if (placement === "below") {
      return {
        viewportLeft: markerRect.left,
        viewportTop: markerRect.bottom + gap
      };
    }

    if (placement === "left") {
      return {
        viewportLeft: markerRect.left - labelWidth - gap,
        viewportTop: markerRect.top
      };
    }

    if (placement === "right") {
      return {
        viewportLeft: markerRect.right + gap,
        viewportTop: markerRect.top
      };
    }

    return {
      viewportLeft: markerRect.left,
      viewportTop: markerRect.top - labelHeight - gap
    };
  }

  function canFitLabelInsideMarker(marker, labelNode, viewportPadding) {
    const markerRect = marker.getBoundingClientRect();
    const compactTableLabel = labelNode.classList.contains("a11y-tools-page-structure-marker__label--table-header") ||
      labelNode.classList.contains("a11y-tools-page-structure-marker__label--table-cell");

    if (compactTableLabel && (markerRect.width < 32 || markerRect.height < 22)) {
      return false;
    }

    if (!compactTableLabel && (markerRect.width < 180 || markerRect.height < 44)) {
      return false;
    }

    const inset = marker.classList.contains("a11y-tools-page-structure-marker--inset") ? 9 : 0;
    labelNode.style.maxWidth = compactTableLabel
      ? `${Math.min(80, Math.max(32, markerRect.width - inset * 2))}px`
      : `${Math.min(300, Math.max(160, markerRect.width - inset * 2))}px`;
    labelNode.style.minWidth = "";
    labelNode.style.width = "max-content";
    const labelRect = labelNode.getBoundingClientRect();

    return labelRect.width <= markerRect.width - inset * 2 && labelRect.height <= markerRect.height - inset * 2;
  }

  function getReadableLabelMinWidth() {
    return Math.min(176, Math.max(96, window.innerWidth - 16));
  }

  function getReadableLabelMaxWidth(viewportPadding) {
    return Math.min(340, Math.max(getReadableLabelMinWidth(), window.innerWidth - viewportPadding * 2));
  }

  function getBestOutsideLabelPlacement(markerRect, labelWidth) {
    const spaceRight = window.innerWidth - markerRect.right;
    const spaceLeft = markerRect.left;

    if (spaceRight >= labelWidth + 16 || spaceRight >= spaceLeft) {
      return "right";
    }

    return "left";
  }

  function findReadableLabelPosition(markerRect, labelWidth, labelHeight, preferredPlacement, gap, viewportPadding, placedLabelRects) {
    const placements = uniquePlacements([preferredPlacement, "above", "below", "right", "left"]);
    let fallback = null;

    for (const placement of placements) {
      const preferred = getPreferredLabelPosition(markerRect, labelWidth, labelHeight, placement, gap);
      const candidate = clampLabelPosition(preferred.viewportLeft, preferred.viewportTop, labelWidth, labelHeight, viewportPadding);
      const rect = {
        left: candidate.viewportLeft,
        top: candidate.viewportTop,
        right: candidate.viewportLeft + labelWidth,
        bottom: candidate.viewportTop + labelHeight
      };

      if (!fallback) {
        fallback = candidate;
      }

      if (!placedLabelRects.some((placed) => rectsOverlap(rect, placed))) {
        return candidate;
      }
    }

    return fallback ?? clampLabelPosition(markerRect.left, markerRect.top, labelWidth, labelHeight, viewportPadding);
  }

  function uniquePlacements(placements) {
    return placements.filter((placement, index) => placement && placements.indexOf(placement) === index);
  }

  function clampLabelPosition(viewportLeft, viewportTop, labelWidth, labelHeight, viewportPadding) {
    const maxLeft = Math.max(viewportPadding, window.innerWidth - labelWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - labelHeight - viewportPadding);

    return {
      viewportLeft: clamp(viewportLeft, viewportPadding, maxLeft),
      viewportTop: clamp(viewportTop, viewportPadding, maxTop)
    };
  }

  function rectsOverlap(first, second) {
    return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  }

  function applyLabelPosition(labelNode, markerRect, viewportLeft, viewportTop) {
    labelNode.style.position = "fixed";
    labelNode.style.left = `${viewportLeft}px`;
    labelNode.style.top = `${viewportTop}px`;
  }

  function getGraphicOverlayLabel(graphic) {
    if (graphic.status === "decorative") {
      return `${graphic.source.toUpperCase()} decorative`;
    }

    if (graphic.status === "missing-alt") {
      return `${graphic.source.toUpperCase()} missing alt`;
    }

    return `${graphic.source.toUpperCase()} ${graphic.name || "unnamed"}`;
  }

  function getLandmarkOverlayLabel(landmark) {
    if (landmark.name) {
      return `${landmark.role}: ${landmark.name}`;
    }

    if (landmark.problem) {
      return `${landmark.role}: unnamed`;
    }

    return landmark.role;
  }

  function getTableOverlayLabel(table, index) {
    return table.caption || table.name || `${table.role || "table"} ${index + 1}`;
  }

  function getTableCellOverlayLabel(cell) {
    return isTableHeaderCell(cell) ? "TH" : "TD";
  }

  function isTableHeaderCell(cell) {
    return cell.role === "columnheader" || cell.role === "rowheader";
  }

  function removePageStructureOverlay() {
    document.getElementById("a11y-tools-page-structure-overlay")?.remove();
    document.getElementById("a11y-tools-page-structure-overlay-style")?.remove();
  }

  function hasUsableRect(rect) {
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function isPageStructureOverlayEnabled() {
    return pageStructureOverlay.headings || pageStructureOverlay.landmarks || pageStructureOverlay.graphics || pageStructureOverlay.ariaLabels || pageStructureOverlay.interactive || pageStructureOverlay.tables;
  }

  function normalizePageStructureOverlay(value) {
    return {
      headings: Boolean(value?.headings ?? value?.enabled),
      landmarks: Boolean(value?.landmarks ?? value?.enabled),
      graphics: Boolean(value?.graphics ?? value?.enabled),
      ariaLabels: Boolean(value?.ariaLabels ?? value?.enabled),
      interactive: Boolean(value?.interactive),
      tables: Boolean(value?.tables)
    };
  }

  function setSemanticLinearViewEnabled(enabled) {
    semanticLinearViewEnabled = enabled;

    if (!enabled) {
      removeSemanticLinearView();
      return;
    }

    setPageStructureOverlay({});
    scheduleSemanticLinearViewRender(getAnalysis());
  }

  function scheduleSemanticLinearViewRender(analysis = null) {
    if (semanticLinearViewScheduled) {
      return;
    }

    semanticLinearViewScheduled = true;
    requestAnimationFrame(() => {
      semanticLinearViewScheduled = false;
      renderSemanticLinearView(analysis ?? getAnalysis());
    });
  }

  function renderSemanticLinearView(analysis) {
    if (!semanticLinearViewEnabled) {
      return;
    }

    removeSemanticLinearView();

    const style = document.createElement("style");
    style.id = "a11y-tools-linear-view-style";
    style.textContent = `
      #a11y-tools-linear-view {
        position: fixed;
        inset: 0;
        z-index: 2147483644;
        overflow: auto;
        background: #ffffff;
        color: #000000;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 16px;
        line-height: 1.5;
        padding: 24px;
      }

      #a11y-tools-linear-view * {
        background: transparent;
        color: #000000;
      }

      #a11y-tools-linear-view h1 {
        margin: 0 0 16px;
        font: inherit;
        font-size: 20px;
        font-weight: 800;
      }

      #a11y-tools-linear-view p {
        max-width: 78ch;
        margin: 0 0 18px;
      }

      #a11y-tools-linear-view ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      #a11y-tools-linear-view ol ol {
        margin-left: 18px;
      }

      .a11y-tools-linear-view__row {
        padding: 8px 0;
        border-top: 1px solid #000000;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      #a11y-tools-linear-view > ol > li:last-child > .a11y-tools-linear-view__row {
        border-bottom: 1px solid #000000;
      }

      .a11y-tools-linear-view__role {
        font-weight: 800;
        text-transform: uppercase;
      }

      .a11y-tools-linear-view__detail {
        font-style: italic;
      }
    `;

    const overlay = document.createElement("div");
    overlay.id = "a11y-tools-linear-view";
    overlay.setAttribute("role", "document");
    overlay.setAttribute("aria-label", t(pluginLanguage, "content.linearLabel"));
    overlay.setAttribute("lang", pluginLanguage);

    const title = document.createElement("h1");
    title.textContent = t(pluginLanguage, "content.linearHeading");
    overlay.append(title);

    const description = document.createElement("p");
    description.textContent = t(pluginLanguage, "content.linearDescription");
    overlay.append(description);

    const list = document.createElement("ol");
    const items = analysis.linearItems ?? collectLinearSemantics(document, { includeShadowDom: scanSettings.includeShadowDom });

    if (items.length === 0) {
      const item = document.createElement("li");
      item.textContent = t(pluginLanguage, "content.noSemantic");
      list.append(item);
    } else {
      appendNestedSemanticLinearViewItems(list, items);
    }

    overlay.append(list);
    document.documentElement.append(style, overlay);
  }

  function appendNestedSemanticLinearViewItems(rootList, items) {
    const stack = [{
      depth: 0,
      list: rootList,
      lastItem: null
    }];

    for (const item of items) {
      const targetDepth = Math.max(0, Math.min(Number(item.depth) || 0, 8));

      while (stack.at(-1).depth > targetDepth) {
        stack.pop();
      }

      while (stack.at(-1).depth < targetDepth) {
        const parent = stack.at(-1);

        if (!parent.lastItem) {
          break;
        }

        const nestedList = document.createElement("ol");
        parent.lastItem.append(nestedList);
        stack.push({
          depth: parent.depth + 1,
          list: nestedList,
          lastItem: null
        });
      }

      const parent = stack.at(-1);
      const row = createSemanticLinearViewItem(item);
      parent.list.append(row);
      parent.lastItem = row;
    }
  }

  function createSemanticLinearViewItem(item) {
    const row = document.createElement("li");
    const content = document.createElement("div");
    content.className = "a11y-tools-linear-view__row";

    const role = document.createElement("span");
    role.className = "a11y-tools-linear-view__role";
    role.textContent = item.role;
    content.append(role);

    if (item.role === "listitem" && Number.isFinite(item.listPosition) && Number.isFinite(item.listSize)) {
      const position = document.createElement("span");
      position.className = "a11y-tools-linear-view__detail";
      position.textContent = ` ${item.listPosition} out of ${item.listSize}`;
      content.append(position);
    }

    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "a11y-tools-linear-view__detail";
      detail.textContent = ` ${item.detail}`;
      content.append(detail);
    }

    if (item.name) {
      const name = document.createElement("span");
      name.textContent = `: ${item.name}`;
      content.append(name);
    }

    row.append(content);
    return row;
  }

  function removeSemanticLinearView() {
    document.getElementById("a11y-tools-linear-view")?.remove();
    document.getElementById("a11y-tools-linear-view-style")?.remove();
  }

  function setTextResizeSimulation(settings) {
    textResizeSimulation = normalizeTextResizeSimulation(settings);
    globalThis.__a11yToolsTextResizeSimulation = textResizeSimulation;

    restoreTextResizeSimulation();

    if (!textResizeSimulation.enabled) {
      return;
    }

    applyTextResizeSimulation();
    renderTextResizeBadge();
  }

  function applyTextResizeSimulation() {
    const factor = textResizeSimulation.scale / 100;
    const targets = getTextResizeTargets();
    const measurements = [];

    for (const element of targets) {
      const computedFontSize = Number.parseFloat(getComputedStyle(element).fontSize);

      if (!Number.isFinite(computedFontSize) || computedFontSize <= 0) {
        continue;
      }

      const record = {
        fontSize: element.style.getPropertyValue("font-size"),
        priority: element.style.getPropertyPriority("font-size"),
        baseFontSize: computedFontSize
      };
      textResizeOriginalInlineStyles.set(element, record);
      measurements.push({ element, baseFontSize: computedFontSize });
    }

    document.documentElement.classList.add("a11y-tools-text-resize-simulation");
    document.documentElement.style.setProperty("--a11y-tools-text-resize-scale", String(textResizeSimulation.scale));

    for (const measurement of measurements) {
      measurement.element.style.setProperty("font-size", `${roundFontSize(measurement.baseFontSize * factor)}px`, "important");
    }
  }

  function getTextResizeTargets() {
    if (!document.body) {
      return [];
    }

    return Array.from(queryElementsDeep(document, "body, body *", { includeShadowDom: scanSettings.includeShadowDom }))
      .filter((element) => element instanceof HTMLElement && isTextResizeTarget(element));
  }

  function isTextResizeTarget(element) {
    return !isOwnOverlayNode(element) && !element.matches(TEXT_RESIZE_SKIP_SELECTOR);
  }

  function restoreTextResizeSimulation() {
    removeTextResizeBadge();
    document.documentElement.classList.remove("a11y-tools-text-resize-simulation");
    document.documentElement.style.removeProperty("--a11y-tools-text-resize-scale");

    for (const [element, record] of textResizeOriginalInlineStyles.entries()) {
      if (record.fontSize) {
        element.style.setProperty("font-size", record.fontSize, record.priority);
      } else {
        element.style.removeProperty("font-size");
      }
    }

    textResizeOriginalInlineStyles.clear();
  }

  function renderTextResizeBadge() {
    removeTextResizeBadge();

    if (!textResizeSimulation.enabled) {
      return;
    }

    const badge = document.createElement("div");
    badge.id = "a11y-tools-text-resize-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = getTextResizeBadgeText();
    badge.style.cssText = `
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      max-width: min(360px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 3px solid #ffffff;
      border-radius: 8px;
      background: #010c25;
      color: #ffffff;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
      font: 800 14px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
      overflow-wrap: anywhere;
    `;
    document.documentElement.append(badge);
  }

  function getTextResizeBadgeText() {
    if (textResizeSimulation.scale === 200) {
      return t(pluginLanguage, "content.textResizeBadgeWcag", { scale: textResizeSimulation.scale });
    }

    if (textResizeSimulation.scale > 200) {
      return t(pluginLanguage, "content.textResizeBadgeStress", { scale: textResizeSimulation.scale });
    }

    return t(pluginLanguage, "content.textResizeBadge", { scale: textResizeSimulation.scale });
  }

  function removeTextResizeBadge() {
    document.getElementById("a11y-tools-text-resize-badge")?.remove();
  }

  function roundFontSize(value) {
    return Math.round(value * 100) / 100;
  }

  function setInteractiveNavigatorEnabled(enabled, requestedIndex = 0) {
    interactiveNavigator = {
      enabled,
      index: Number.isInteger(requestedIndex) ? Math.max(0, requestedIndex) : interactiveNavigator.index
    };

    if (!enabled) {
      removeInteractiveNavigator();
      sendInteractiveNavigatorState();
      return;
    }

    setPageStructureOverlay({});
    scheduleInteractiveNavigatorRender(getAnalysis());
  }

  function moveInteractiveNavigator(delta) {
    if (!interactiveNavigator.enabled) {
      return;
    }

    const items = collectInteractiveItems(document, { includeShadowDom: scanSettings.includeShadowDom });
    if (items.length === 0) {
      interactiveNavigator.index = 0;
      renderInteractiveNavigator({ interactiveItems: items });
      return;
    }

    interactiveNavigator.index = (interactiveNavigator.index + delta + items.length) % items.length;
    renderInteractiveNavigator({ interactiveItems: items });
  }

  function scheduleInteractiveNavigatorRender(analysis = null) {
    if (interactiveNavigatorScheduled) {
      return;
    }

    interactiveNavigatorScheduled = true;
    requestAnimationFrame(() => {
      interactiveNavigatorScheduled = false;
      renderInteractiveNavigator(analysis ?? getAnalysis());
    });
  }

  function renderInteractiveNavigator(analysis) {
    if (!interactiveNavigator.enabled) {
      return;
    }

    const items = analysis.interactiveItems ?? collectInteractiveItems(document, { includeShadowDom: scanSettings.includeShadowDom });
    interactiveNavigator.index = items.length > 0 ? Math.min(interactiveNavigator.index, items.length - 1) : 0;
    clearForcedInteractiveFocusElement();

    const overlay = ensureInteractiveNavigatorOverlay();
    overlay.replaceChildren();

    if (items.length === 0) {
      addInteractiveNavigatorMessage(overlay, t(pluginLanguage, "content.noInteractive"));
      sendInteractiveNavigatorState(items);
      return;
    }

    const item = items[interactiveNavigator.index];
    const element = findElementByIdDeep(document, item.id, { includeShadowDom: scanSettings.includeShadowDom });

    if (!element || !item.exposed) {
      addInteractiveNavigatorMessage(overlay, item.exposed ? t(pluginLanguage, "content.unavailableInteractive") : t(pluginLanguage, "content.hiddenInteractive"));
      sendInteractiveNavigatorState(items);
      return;
    }

    focusInteractiveElement(element);

    const rect = element.getBoundingClientRect();
    if (!hasUsableRect(rect)) {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    }

    requestAnimationFrame(() => {
      const nextOverlay = ensureInteractiveNavigatorOverlay();
      nextOverlay.replaceChildren();
      const currentRect = element.getBoundingClientRect();

      if (!hasUsableRect(currentRect)) {
        forceInteractiveFocusElementVisible(element);
        requestAnimationFrame(() => {
          const forcedOverlay = ensureInteractiveNavigatorOverlay();
          forcedOverlay.replaceChildren();
          const forcedRect = element.getBoundingClientRect();

          if (!hasUsableRect(forcedRect)) {
            addInteractiveNavigatorMessage(forcedOverlay, t(pluginLanguage, "content.outsideInteractive"));
          } else {
            addInteractiveNavigatorSpotlight(forcedOverlay, forcedRect, item, items.length, true);
          }

          sendInteractiveNavigatorState(items);
        });
        return;
      } else {
        addInteractiveNavigatorSpotlight(nextOverlay, currentRect, item, items.length);
      }

      sendInteractiveNavigatorState(items);
    });
  }

  function ensureInteractiveNavigatorOverlay() {
    let style = document.getElementById("a11y-tools-interactive-navigator-style");

    if (!style) {
      style = document.createElement("style");
      style.id = "a11y-tools-interactive-navigator-style";
      style.textContent = `
        #a11y-tools-interactive-navigator {
          position: fixed;
          inset: 0;
          z-index: 2147483643;
          pointer-events: none;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .a11y-tools-interactive-navigator__shade {
          position: fixed;
          background: #000000;
          opacity: 0.9;
        }

        .a11y-tools-interactive-navigator__target {
          position: fixed;
          border: 4px ${getHighlightBorderStyle()} #005fcc;
          box-shadow:
            0 0 0 4px #ffffff,
            0 12px 36px rgba(0, 0, 0, 0.5);
        }

        .a11y-tools-interactive-navigator__label,
        .a11y-tools-interactive-navigator__message {
          position: fixed;
          max-width: min(520px, calc(100vw - 32px));
          border: 3px solid #ffffff;
          background: #000000;
          color: #ffffff;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.5;
          padding: 10px 12px;
        }

        .a11y-tools-interactive-navigator__message {
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
        }

        .a11y-tools-force-focus-visible {
          position: fixed !important;
          inset: auto !important;
          left: 16px !important;
          top: 16px !important;
          z-index: 2147483642 !important;
          display: inline-block !important;
          width: auto !important;
          height: auto !important;
          min-width: 0 !important;
          min-height: 0 !important;
          max-width: min(520px, calc(100vw - 32px)) !important;
          margin: 0 !important;
          padding: 10px 12px !important;
          clip: auto !important;
          clip-path: none !important;
          opacity: 1 !important;
          overflow: visible !important;
          transform: none !important;
          visibility: visible !important;
          border: 3px solid #ffffff !important;
          border-radius: 4px !important;
          background: #ffffff !important;
          color: #000000 !important;
          box-shadow: 0 0 0 6px #005fcc, 0 12px 36px rgba(0, 0, 0, 0.5) !important;
          font: 800 16px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        }
      `;
      document.documentElement.append(style);
    }

    let overlay = document.getElementById("a11y-tools-interactive-navigator");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "a11y-tools-interactive-navigator";
      overlay.setAttribute("aria-hidden", "true");
      document.documentElement.append(overlay);
    }

    return overlay;
  }

  function addInteractiveNavigatorSpotlight(overlay, rect, item, count, simulated = false) {
    const left = clamp(rect.left, 0, window.innerWidth);
    const top = clamp(rect.top, 0, window.innerHeight);
    const right = clamp(rect.right, left, window.innerWidth);
    const bottom = clamp(rect.bottom, top, window.innerHeight);

    addShade(overlay, 0, 0, window.innerWidth, top);
    addShade(overlay, 0, bottom, window.innerWidth, window.innerHeight - bottom);
    addShade(overlay, 0, top, left, bottom - top);
    addShade(overlay, right, top, window.innerWidth - right, bottom - top);

    const target = document.createElement("div");
    target.className = "a11y-tools-interactive-navigator__target";
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.width = `${Math.max(1, right - left)}px`;
    target.style.height = `${Math.max(1, bottom - top)}px`;
    overlay.append(target);

    const label = document.createElement("div");
    label.className = "a11y-tools-interactive-navigator__label";
    label.textContent = `${interactiveNavigator.index + 1} / ${count}: ${simulated ? `${t(pluginLanguage, "content.simulatedFocus")}, ` : ""}${getInteractiveNavigatorItemLabel(item)}`;
    label.style.left = `${clamp(left, 16, Math.max(16, window.innerWidth - 280))}px`;
    label.style.top = `${bottom + 16 < window.innerHeight ? bottom + 16 : Math.max(16, top - 72)}px`;
    overlay.append(label);
  }

  function addInteractiveNavigatorMessage(overlay, message) {
    addShade(overlay, 0, 0, window.innerWidth, window.innerHeight);
    const node = document.createElement("div");
    node.className = "a11y-tools-interactive-navigator__message";
    node.textContent = message;
    overlay.append(node);
  }

  function addShade(overlay, left, top, width, height) {
    if (width <= 0 || height <= 0) {
      return;
    }

    const shade = document.createElement("div");
    shade.className = "a11y-tools-interactive-navigator__shade";
    shade.style.left = `${left}px`;
    shade.style.top = `${top}px`;
    shade.style.width = `${width}px`;
    shade.style.height = `${height}px`;
    overlay.append(shade);
  }

  function focusInteractiveElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  function forceInteractiveFocusElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    forcedInteractiveFocusElement = element;
    element.classList.add("a11y-tools-force-focus-visible");
    focusInteractiveElement(element);
  }

  function clearForcedInteractiveFocusElement() {
    forcedInteractiveFocusElement?.classList?.remove("a11y-tools-force-focus-visible");
    forcedInteractiveFocusElement = null;
  }

  function sendInteractiveNavigatorState(items = collectInteractiveItems(document, { includeShadowDom: scanSettings.includeShadowDom })) {
    const current = items[interactiveNavigator.index];
    sendRuntimeMessage({
      type: "A11Y_TOOLS_INTERACTIVE_NAVIGATOR_STATE",
      state: {
        enabled: interactiveNavigator.enabled,
        index: interactiveNavigator.index,
        count: items.length,
        currentHidden: Boolean(current && !current.exposed),
        currentLabel: current ? getInteractiveNavigatorItemLabel(current) : ""
      }
    });
  }

  function getInteractiveNavigatorItemLabel(item) {
    return [item.role, item.detail, item.name].filter(Boolean).join(", ");
  }

  function removeInteractiveNavigator() {
    clearForcedInteractiveFocusElement();
    document.getElementById("a11y-tools-interactive-navigator")?.remove();
    document.getElementById("a11y-tools-interactive-navigator-style")?.remove();
  }
}

function sendExistingAnalysis() {
  try {
    sendRuntimeMessage({
      type: "A11Y_TOOLS_ANALYSIS",
      analysis: getAnalysis()
    });
  } catch (error) {
    sendRuntimeMessage({
      type: "A11Y_TOOLS_SCAN_FRAME_ERROR",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function getAnalysis() {
  const analysisOptions = getContentAnalysisOptions();

  return withAccessibilityAnalysisCache(() => {
    if (globalThis.__a11yToolsContentVersion === CONTENT_VERSION) {
      // Keep live region state in sync when the panel requests a fresh scan.
      // This is intentionally cheap for normal pages and prevents stale panel data.
      try {
        // syncLiveRegionRegistry is scoped inside the installed branch; this guard
        // only runs in the active content-script instance where it exists.
        globalThis.__a11yToolsSyncLiveRegions?.();
      } catch {
        // Ignore sync failures and still return the structural analysis.
      }
    }

    return {
      ...analyzeAccessibility(document, analysisOptions),
      contentVersion: CONTENT_VERSION,
      liveRegions: globalThis.__a11yToolsGetLiveRegionRecords?.() ?? [],
      linearItems: collectLinearSemantics(document, analysisOptions),
      interactiveItems: collectInteractiveItems(document, analysisOptions),
      url: location.href,
      title: document.title
    };
  }, analysisOptions);
}

function sendRuntimeMessage(message) {
  try {
    if (!chrome?.runtime?.id) {
      return;
    }

    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Existing page scripts can outlive a reloaded unpacked extension. In that
    // state Chrome throws "Extension context invalidated" synchronously.
  }
}

function normalizeScanSettings(settings = {}) {
  return {
    includeIframes: settings.includeIframes !== false,
    includeShadowDom: settings.includeShadowDom !== false
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

function getContentAnalysisOptions() {
  return {
    includeShadowDom: normalizeScanSettings(globalThis.__a11yToolsScanSettings).includeShadowDom
  };
}

function getComposedParentElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  if (element.parentElement) {
    return element.parentElement;
  }

  const root = element.getRootNode?.();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    return root.host;
  }

  return null;
}

function getClosestComposedElement(element, selector) {
  for (let current = element; current; current = getComposedParentElement(current)) {
    if (current.matches?.(selector)) {
      return current;
    }
  }

  return null;
}

function normalizeWhitespace(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function ensureElementId(element) {
  if (!element.id) {
    element.id = `a11y-tools-${Math.random().toString(36).slice(2, 10)}`;
  }

  return element.id;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function getReadableAccentColor(textColor) {
  return textColor.toLowerCase() === "#ffffff" ? "#9ee7dd" : textColor;
}

let revealHighlightTimer = 0;
let revealRequestId = 0;
let activeRevealHighlight = null;
let revealHighlightUpdateScheduled = false;

function revealElement(elementId) {
  if (typeof elementId !== "string" || elementId.trim() === "") {
    return;
  }

  const element = findElementByIdDeep(document, elementId, getContentAnalysisOptions());

  if (!element) {
    showGlobalPageStatusMessage(t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.itemGone"));
    return;
  }

  revealNode(element);
}

function revealFrameElement(frameUrl) {
  const frame = findFrameElement(frameUrl);

  if (!frame) {
    showGlobalPageStatusMessage(t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.frameNotFound"));
    return;
  }

  revealNode(frame, t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.unscannedFrame"));
}

function revealNode(element, label = "") {
  const scrollTarget = getRevealScrollElement(element);
  scrollTarget.scrollIntoView({
    behavior: "auto",
    block: "center",
    inline: "nearest"
  });

  const requestId = ++revealRequestId;
  window.clearTimeout(revealHighlightTimer);
  removeRevealHighlight();

  afterScrollLayoutSettles(scrollTarget, () => {
    if (requestId !== revealRequestId) {
      return;
    }

    const target = getVisibleRevealTarget(element);

    if (!target) {
      showGlobalPageStatusMessage(t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.noVisibleBox"));
      return;
    }

    addRevealHighlight(target.rect, label || target.note);
    activeRevealHighlight = {
      sourceElement: element,
      requestId
    };

    revealHighlightTimer = window.setTimeout(removeRevealHighlight, 2200);
  });
}

function findFrameElement(frameUrl) {
  const frames = Array.from(queryElementsDeep(document, "iframe,frame", getContentAnalysisOptions()));
  const normalizedTarget = normalizeFrameMatchUrl(frameUrl);

  if (normalizedTarget) {
    const exactMatch = frames.find((frame) => normalizeFrameMatchUrl(frame.src || frame.getAttribute("src") || "") === normalizedTarget);

    if (exactMatch) {
      return exactMatch;
    }
  }

  if (!frameUrl || frameUrl === "about:blank") {
    return frames.find((frame) => !frame.getAttribute("src") || normalizeFrameMatchUrl(frame.getAttribute("src") || "") === "about:blank") ?? null;
  }

  return frames.length === 1 ? frames[0] : null;
}

function normalizeFrameMatchUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  try {
    return new URL(value, location.href).href;
  } catch {
    return value;
  }
}

function afterScrollLayoutSettles(element, callback) {
  const maxFrames = 12;
  let frame = 0;
  let stableFrames = 0;
  let lastSignature = "";

  const check = () => {
    const signature = getRevealScrollSignature(element);

    if (signature === lastSignature) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
      lastSignature = signature;
    }

    frame += 1;

    if (stableFrames >= 2 || frame >= maxFrames) {
      callback();
      return;
    }

    requestAnimationFrame(check);
  };

  requestAnimationFrame(check);
}

function getRevealScrollSignature(element) {
  const parts = [`window:${Math.round(window.scrollX)},${Math.round(window.scrollY)}`];

  for (const scroller of getScrollableAncestors(element)) {
    parts.push(`${scroller.tagName}:${Math.round(scroller.scrollLeft)},${Math.round(scroller.scrollTop)}`);
  }

  return parts.join("|");
}

function getScrollableAncestors(element) {
  const ancestors = [];

  for (let current = getComposedParentElement(element); current && current !== document.documentElement; current = getComposedParentElement(current)) {
    const style = getComputedStyle(current);
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;

    if (/(auto|scroll|overlay)/.test(overflow) && (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth)) {
      ancestors.push(current);
    }
  }

  return ancestors;
}

function addRevealHighlight(rect, label) {
  const marker = document.createElement("div");
  let labelNode = null;
  marker.id = "a11y-tools-reveal-highlight";
  marker.setAttribute("aria-hidden", "true");
  marker.style.position = "fixed";
  marker.style.border = `4px ${getHighlightBorderStyle()} #005fcc`;
  marker.style.boxShadow = "0 0 0 3px #ffffff, 0 8px 24px rgba(0, 0, 0, 0.35)";
  marker.style.pointerEvents = "none";
  marker.style.zIndex = "2147483646";

  if (label) {
    labelNode = document.createElement("div");
    labelNode.textContent = label;
    labelNode.style.cssText = `
      position: absolute;
      left: 0;
      top: calc(100% + 8px);
      max-width: min(420px, calc(100vw - 32px));
      padding: 6px 8px;
      border: 2px ${getHighlightBorderStyle()} #ffffff;
      border-radius: 4px;
      background: #005fcc;
      color: #ffffff;
      font: 800 13px/1.4 ui-sans-serif, system-ui, sans-serif;
    `;
    marker.append(labelNode);
  }

  document.documentElement.append(marker);
  updateRevealHighlightMarker(marker, rect);

  if (labelNode) {
    clampRevealHighlightLabel(marker, labelNode);
  }
}

function updateRevealHighlightMarker(marker, rect) {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);

  marker.style.left = `${left}px`;
  marker.style.top = `${top}px`;
  marker.style.width = `${Math.max(1, Math.min(rect.width, window.innerWidth - left))}px`;
  marker.style.height = `${Math.max(1, Math.min(rect.height, window.innerHeight - top))}px`;

  const labelNode = marker.firstElementChild;
  if (labelNode) {
    labelNode.style.left = "0";
    labelNode.style.top = "calc(100% + 8px)";
    clampRevealHighlightLabel(marker, labelNode);
  }
}

function scheduleRevealHighlightUpdate() {
  if (!activeRevealHighlight || revealHighlightUpdateScheduled) {
    return;
  }

  revealHighlightUpdateScheduled = true;
  requestAnimationFrame(() => {
    revealHighlightUpdateScheduled = false;

    if (!activeRevealHighlight || activeRevealHighlight.requestId !== revealRequestId) {
      return;
    }

    const marker = document.getElementById("a11y-tools-reveal-highlight");
    const target = getVisibleRevealTarget(activeRevealHighlight.sourceElement);

    if (!marker || !target) {
      return;
    }

    updateRevealHighlightMarker(marker, target.rect);
  });
}

function clampRevealHighlightLabel(marker, labelNode) {
  const viewportPadding = 8;
  const markerRect = marker.getBoundingClientRect();
  const labelRect = labelNode.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - labelRect.width - viewportPadding);
  const maxTop = Math.max(viewportPadding, window.innerHeight - labelRect.height - viewportPadding);
  const clampedLeft = Math.max(viewportPadding, Math.min(labelRect.left, maxLeft));
  const clampedTop = Math.max(viewportPadding, Math.min(labelRect.top, maxTop));

  labelNode.style.left = `${clampedLeft - markerRect.left}px`;
  labelNode.style.top = `${clampedTop - markerRect.top}px`;
}

function removeRevealHighlight() {
  activeRevealHighlight = null;
  document.getElementById("a11y-tools-reveal-highlight")?.remove();
  document.getElementById("a11y-tools-page-status")?.remove();
}

function getHighlightBorderStyle() {
  return globalThis.__a11yToolsHighlightSettings?.dashedBorders ? "dashed" : "solid";
}

function getPageStructureInsetBoxShadow() {
  if (getHighlightBorderStyle() === "dashed") {
    return "inset 0 0 0 5px rgba(255, 255, 255, 0.95), 0 8px 20px rgba(0, 0, 0, 0.25)";
  }

  return [
    "inset 0 0 0 5px #ffffff",
    "inset 0 0 0 9px var(--a11y-tools-marker-color)",
    "inset 0 0 0 12px rgba(255, 255, 255, 0.95)",
    "0 8px 20px rgba(0, 0, 0, 0.25)"
  ].join(", ");
}

function getHighlightLabelPlacement() {
  return normalizeHighlightLabelPlacement(globalThis.__a11yToolsHighlightSettings?.labelPlacement);
}

function getSmallMarkerLabelPlacement() {
  const placement = getHighlightLabelPlacement();
  return placement === "inside" ? "right" : placement;
}

function normalizeHighlightLabelPlacement(value) {
  if (value === "outside") {
    return "above";
  }

  return value === "inside" || value === "above" || value === "below" || value === "left" || value === "right"
    ? value
    : "inside";
}

function clearLegacyRevealOutlines() {
  for (const element of document.querySelectorAll("[style]")) {
    const outline = element.style?.outline;

    if (outline === "4px solid rgb(0, 95, 204)" || outline === "4px solid #005fcc") {
      element.style.outline = "";
      element.style.outlineOffset = "";
    }
  }
}

function hasVisibleRevealRect(rect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
}

function hasRevealBox(rect) {
  return rect.width > 0 && rect.height > 0;
}

function getRevealScrollElement(element) {
  if (hasRevealBox(element.getBoundingClientRect())) {
    return element;
  }

  const descendantTarget = getVisibleDescendantRevealTarget(element);
  if (descendantTarget?.element) {
    return descendantTarget.element;
  }

  for (let current = getComposedParentElement(element); current && current !== document.body && current !== document.documentElement; current = getComposedParentElement(current)) {
    if (hasRevealBox(current.getBoundingClientRect())) {
      return current;
    }
  }

  return element;
}

function getVisibleRevealTarget(element) {
  const ownRect = element.getBoundingClientRect();

  if (hasVisibleRevealRect(ownRect)) {
    return { rect: ownRect, note: "", element };
  }

  const descendantTarget = getVisibleDescendantRevealTarget(element);

  if (descendantTarget) {
    return {
      rect: descendantTarget.rect,
      note: t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.visibleContents"),
      element: descendantTarget.element
    };
  }

  for (let current = getComposedParentElement(element); current && current !== document.body && current !== document.documentElement; current = getComposedParentElement(current)) {
    const rect = current.getBoundingClientRect();

    if (hasVisibleRevealRect(rect)) {
      return { rect, note: t(globalThis.__a11yToolsPluginLanguage ?? "en", "content.nearestVisible"), element: current };
    }
  }

  return null;
}

function getVisibleDescendantRevealTarget(element) {
  const rects = [];
  let firstElement = null;

  for (const descendant of queryElementsDeep(element, "*", getContentAnalysisOptions())) {
    if (isOwnOverlayNode(descendant)) {
      continue;
    }

    const rect = descendant.getBoundingClientRect();

    if (!hasVisibleRevealRect(rect)) {
      continue;
    }

    firstElement ??= descendant;
    rects.push(rect);

    if (rects.length >= 50) {
      break;
    }
  }

  if (rects.length === 0) {
    return null;
  }

  return {
    rect: getBoundingRectUnion(rects),
    element: firstElement
  };
}

function getBoundingRectUnion(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function showGlobalPageStatusMessage(message) {
  removeRevealHighlight();

  const status = document.createElement("div");
  status.id = "a11y-tools-page-status";
  status.textContent = message;
  status.setAttribute("aria-hidden", "true");
  status.style.cssText = `
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 2147483646;
    width: min(520px, calc(100vw - 32px));
    transform: translateX(-50%);
    border: 3px ${getHighlightBorderStyle()} #004a99;
    border-radius: 8px;
    background: #ffffff;
    color: #111827;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
    font: 800 14px/1.5 ui-sans-serif, system-ui, sans-serif;
    padding: 12px 14px;
    pointer-events: none;
  `;

  document.documentElement.append(status);
  revealHighlightTimer = window.setTimeout(removeRevealHighlight, 4500);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
