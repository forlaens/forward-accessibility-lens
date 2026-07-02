export interface HeadingItem {
  id: string;
  level: number;
  role: string;
  text: string;
  source: string;
  selector: string;
  scope?: string;
  problem: string | null;
}

export interface LandmarkItem {
  type?: "landmark";
  id: string;
  role: string;
  name: string;
  label: string;
  source: string;
  depth: number;
  selector: string;
  scope?: string;
  problem: string | null;
}

export interface LandmarkGapItem {
  type: "content";
  id: string;
  label: string;
  depth: number;
  elementIds: string[];
  snippets: string[];
  scope?: string;
  problem: string;
}

export type LandmarkStructureItem = LandmarkItem | LandmarkGapItem;

export interface LiveRegionMessage {
  text: string;
  time: string;
  politeness: string;
}

export interface LiveRegionItem {
  key: string;
  label: string;
  present: boolean;
  politeness: string;
  role: string;
  ariaLive: string;
  ariaAtomic: string;
  ariaRelevant: string;
  ariaBusy: string;
  selector: string;
  path: string;
  scope?: string;
  lastKnownRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  duplicatePosition: boolean;
  messages: LiveRegionMessage[];
}

export interface LinearSemanticItem {
  id: string;
  role: string;
  name: string;
  detail: string;
  depth: number;
  listPosition?: number;
  listSize?: number;
  scope?: string;
}

export interface InteractiveItem {
  id: string;
  role: string;
  name: string;
  detail: string;
  selector: string;
  exposed: boolean;
  scope?: string;
}

export interface GraphicItem {
  id: string;
  role: string;
  name: string;
  status: string;
  source: string;
  thumbnailSrc: string;
  selector: string;
  scope?: string;
  problem: string | null;
}

export interface AriaLabelItem {
  id: string;
  role: string;
  name: string;
  source: string;
  selector: string;
  scope?: string;
  problem: string | null;
}

export interface TableCellItem {
  id: string;
  role: "columnheader" | "rowheader" | "cell" | "gridcell";
  text: string;
  source: string;
  selector: string;
  rowIndex: number;
  columnIndex: number;
  headerScope?: string;
  scope?: string;
}

export interface TableItem {
  id: string;
  role: "table" | "grid" | "treegrid";
  name: string;
  caption: string;
  source: string;
  selector: string;
  rowCount: number;
  columnCount: number;
  headerCellCount: number;
  dataCellCount: number;
  cells: TableCellItem[];
  scope?: string;
}

export interface AccessibilityAnalysis {
  contentVersion?: number;
  headings: HeadingItem[];
  landmarks: LandmarkItem[];
  landmarkStructure?: LandmarkStructureItem[];
  liveRegions?: LiveRegionItem[];
  linearItems?: LinearSemanticItem[];
  interactiveItems?: InteractiveItem[];
  graphics?: GraphicItem[];
  ariaLabels?: AriaLabelItem[];
  tables?: TableItem[];
  updatedAt: string;
  url?: string;
  title?: string;
}

export type ScanProgressPhase = "preparing" | "injecting" | "applyingSettings" | "scanningFrames" | "complete" | "problem";

export interface ScanProgressProblem {
  code: string;
  detail?: string;
  frameId?: number | null;
  frameUrl?: string;
  parentFrameId?: number | null;
  canReveal?: boolean;
}

export interface ScanProgress {
  scanId: number;
  phase: ScanProgressPhase;
  completedFrames: number;
  successfulFrames: number;
  failedFrames: number;
  totalFrames: number | null;
  problems: ScanProgressProblem[];
  includeIframes: boolean;
  includeShadowDom: boolean;
}
