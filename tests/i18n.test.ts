import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  getLanguageOptions,
  normalizeLanguagePreference,
  resolvePluginLanguage,
  t
} from "../src/shared/i18n.js";

const englishDictionarySource = readFileSync("src/shared/i18n.js", "utf8")
  .match(/en: \{([\s\S]*?)\n  \},\n  da:/)?.[1] ?? "";
const ENGLISH_KEYS = [...englishDictionarySource.matchAll(/"([^"]+)":/g)].map((match) => match[1]);
const TEMPLATE_VALUES = {
  from: "1",
  to: "2",
  role: "ROLE",
  version: "VERSION",
  language: "LANGUAGE",
  theme: "THEME",
  pageUrl: "URL",
  userAgent: "AGENT",
  platform: "PLATFORM",
  languages: "LANGUAGES",
  screen: "SCREEN",
  viewport: "VIEWPORT",
  devicePixelRatio: "DPR",
  timestamp: "TIME",
  snippets: "SNIPPETS",
  count: "COUNT",
  items: "ITEMS",
  ratio: "RATIO",
  levels: "LEVELS",
  color: "COLOR",
  start: "START",
  end: "END",
  total: "TOTAL",
  completed: "COMPLETED",
  successful: "SUCCESSFUL",
  failed: "FAILED",
  frame: "FRAME",
  page: "PAGE",
  pages: "PAGES",
  announcement: "ANNOUNCEMENT",
  level: "LEVEL",
  name: "NAME",
  countText: "COUNT_TEXT",
  position: "POSITION",
  row: "ROW",
  column: "COLUMN"
};
const TECHNICAL_TERMS = [
  "common.devtools",
  "export.field.ariaLive",
  "export.field.ariaAtomic",
  "export.field.ariaRelevant",
  "export.field.ariaBusy",
  "textResize.wcagBadge",
  "brand.product"
];
const DEEP_SCAN_FALLBACK_KEYS = [
  "export.field.scope",
  "settings.scan",
  "settings.scanIframes",
  "settings.scanShadowDom"
];
const SCAN_PROGRESS_FALLBACK_KEYS = [
  "scan.progress.preparing",
  "scan.progress.injecting",
  "scan.progress.applyingSettings",
  "scan.progress.page",
  "scan.progress.frames",
  "scan.progress.complete",
  "scan.progress.detail.findingFrames",
  "scan.progress.detail.mainFrameOnly",
  "scan.progress.detail.frames",
  "scan.progress.detail.mainFrame",
  "scan.progress.detail.shadowIncluded",
  "scan.progress.detail.shadowSkipped",
  "scan.progress.problem.one",
  "scan.progress.problem.other",
  "scan.progress.problem.frame",
  "scan.progress.problem.allFramesInjectionFailed",
  "scan.progress.problem.frameInjectionSkipped",
  "scan.progress.problem.frameMessageFailed",
  "scan.progress.problem.frameTimeout",
  "scan.progress.problem.frameAnalysisFailed",
  "scan.progress.problem.allFramesFailed",
  "scan.progress.problem.showFrame",
  "scan.progress.problem.unknown",
  "content.frameNotFound",
  "content.unscannedFrame"
];
const TEXT_RESIZE_FALLBACK_KEYS = [
  "tools.textResize",
  "control.textResize.title",
  "control.textResize.description",
  "textResize.title",
  "textResize.scale",
  "textResize.percent",
  "textResize.presets",
  "textResize.marker.base",
  "textResize.marker.wcag",
  "textResize.marker.max",
  "textResize.preset.percent",
  "textResize.preset.wcag",
  "textResize.wcagNote",
  "textResize.explain1",
  "textResize.explain2",
  "textResize.testTitle",
  "textResize.test.step200",
  "textResize.test.step400",
  "textResize.test.noBreakage",
  "textResize.test.usable",
  "textResize.test.finalZoom",
  "announce.textResize.on",
  "announce.textResize.wcag",
  "announce.textResize.off",
  "content.textResizeBadge",
  "content.textResizeBadgeWcag",
  "content.textResizeBadgeStress"
];
const TABLE_FALLBACK_KEYS = [
  "tools.tables",
  "control.tables.title",
  "control.tables.description",
  "empty.tables",
  "tables.title",
  "tables.explain1",
  "tables.item",
  "tables.rows",
  "tables.columns",
  "tables.headers",
  "tables.dataCells",
  "tables.cells",
  "tables.position",
  "tables.unnamedHeader",
  "tables.unnamedCell",
  "announce.showTable",
  "announce.showTableCell",
  "announce.overlay.tables.on",
  "announce.overlay.tables.off",
  "count.table.one",
  "count.table.other",
  "export.field.rows",
  "export.field.columns",
  "export.field.headers",
  "export.field.dataCells",
  "export.field.cells"
];
const ALLOWED_SAME_AS_ENGLISH: Record<string, string[]> = {
  da: [...TECHNICAL_TERMS, "export.field.status", "export.field.source", "export.field.position", "view.feedback", "status.live", "tools.landmarks"],
  sv: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.text", "export.field.status", "export.field.position", "status.live", "contrast.normalAa", "contrast.normalAaa"],
  no: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.status", "export.field.position", "status.live"],
  fi: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position", "status.live"],
  is: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position"],
  kl: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position", "status.live"],
  de: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.name", "export.field.text", "export.field.status", "export.field.position", "view.feedback", "settings.position", "tools.landmarks"],
  fr: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position", "export.field.messages", "tools.images", "settings.position"],
  es: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position"],
  it: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.position", "view.feedback"],
  pt: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "common.item.one", "export.field.position", "view.feedback"],
  nl: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "common.item.one", "common.item.other", "export.field.status", "export.field.detail", "export.field.position", "view.feedback", "tools.label", "tools.landmarks"],
  pl: [...TECHNICAL_TERMS, ...DEEP_SCAN_FALLBACK_KEYS, ...SCAN_PROGRESS_FALLBACK_KEYS, ...TEXT_RESIZE_FALLBACK_KEYS, ...TABLE_FALLBACK_KEYS, "export.field.status", "export.field.position"]
};

describe("localization", () => {
  it("exposes every language with a bundled dictionary", () => {
    const expectedLanguages = ["en", "da", "sv", "no", "fi", "is", "kl", "de", "fr", "es", "it", "pt", "nl", "pl"];

    expect(SUPPORTED_LANGUAGES.map((language) => language.code)).toEqual(expectedLanguages);
    expect(getLanguageOptions().map((language) => language.code)).toEqual(["system", ...expectedLanguages]);
  });

  it("resolves supported and unsupported browser languages", () => {
    expect(normalizeLanguagePreference("sv")).toBe("sv");
    expect(normalizeLanguagePreference("tr")).toBe("system");
    expect(resolvePluginLanguage("system", ["sv-SE", "de-DE"])).toBe("sv");
    expect(resolvePluginLanguage("system", ["nb-NO", "de-DE"])).toBe("no");
    expect(resolvePluginLanguage("system", ["tr-TR", "de-DE"])).toBe("de");
    expect(resolvePluginLanguage("system", ["tr-TR"])).toBe("en");
    expect(resolvePluginLanguage("system", ["da-DK", "en-US"])).toBe("da");
  });

  it("has Danish text for every English localization key", () => {
    for (const key of ENGLISH_KEYS) {
      expect(t("da", key), key).not.toBe(key);
    }
  });

  it("only keeps deliberate English or identical terms in localized languages", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      if (language.code === "en") {
        continue;
      }

      const sameAsEnglish = ENGLISH_KEYS.filter((key) => (
        t(language.code, key, TEMPLATE_VALUES) === t("en", key, TEMPLATE_VALUES)
      ));

      expect(sameAsEnglish.toSorted(), language.code).toEqual(ALLOWED_SAME_AS_ENGLISH[language.code].toSorted());
    }
  });

  it("keeps recent Danish contrast labels localized", () => {
    expect(t("da", "contrast.reverseColors")).toBe("Ombyt tekst- og baggrundsfarve");
    expect(t("da", "contrast.largeAa")).toBe("Stor tekst og grafik (AA)");
    expect(t("da", "contrast.explain1")).toBe("Vælg tekst- og baggrundsfarver fra siden, eller indstil dem manuelt.");
  });

  it("uses the correct accessibility term for landmarks in English and Danish", () => {
    expect(t("en", "tools.landmarks")).toBe("Landmarks");
    expect(t("da", "tools.landmarks")).toBe("Landmarks");
  });
});
