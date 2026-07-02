const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role]";
const LANDMARK_SELECTOR = [
  "aside",
  "footer",
  "form",
  "header",
  "main",
  "nav",
  "section",
  "[role]"
].join(",");
const GRAPHIC_SELECTOR = [
  "img",
  "svg",
  "figure",
  "input[type='image' i]",
  "[role]"
].join(",");
const ARIA_LABEL_SELECTOR = "[aria-label],[aria-labelledby]";
const TABLE_SELECTOR = "table,[role='table'],[role='grid'],[role='treegrid']";
const TABLE_ROW_SELECTOR = "tr,[role='row']";
const TABLE_CELL_SELECTOR = "th,td,[role='columnheader'],[role='rowheader'],[role='cell'],[role='gridcell']";
const SVG_THUMBNAIL_MAX_LENGTH = 120000;
const NON_CONTENT_TEXT_TAGS = new Set(["script", "style", "template"]);
const MAX_ACCESSIBLE_TEXT_DEPTH = 128;
const analysisContextStack = [];
const DEFAULT_ANALYSIS_OPTIONS = {
  includeShadowDom: true
};

const LANDMARK_ROLES = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search"
]);

const PROHIBITED_HEADING_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
  "treeitem"
]);

const PRESENTATIONAL_ROLES = new Set(["none", "presentation"]);
const HIDDEN_INPUT_TYPES = new Set(["hidden"]);
const VALID_ARIA_ROLES = new Set([
  "alert",
  "article",
  "banner",
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "dialog",
  "document",
  "form",
  "figure",
  "graphics-document",
  "graphics-object",
  "graphics-symbol",
  "grid",
  "gridcell",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "menu",
  "menuitem",
  "navigation",
  "option",
  "radio",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "search",
  "searchbox",
  "status",
  "switch",
  "tab",
  "table",
  "textbox"
]);
const GRAPHIC_ROLES = new Set(["figure", "graphics-document", "graphics-object", "graphics-symbol", "img"]);
const TABLE_ROLES = new Set(["table", "grid", "treegrid"]);
const TABLE_CELL_ROLES = new Set(["columnheader", "rowheader", "cell", "gridcell"]);
const CHILDREN_ARE_NAME_ROLES = new Set(["button", "checkbox", "combobox", "heading", "img", "link", "menuitem", "option", "radio", "searchbox", "switch", "tab", "textbox"]);
const MISSING_TEXT_NOTE_ROLES = new Set(["button", "checkbox", "combobox", "heading", "img", "link", "menuitem", "option", "radio", "searchbox", "switch", "tab", "textbox"]);
const INTERACTIVE_ROLES = new Set(["button", "checkbox", "combobox", "link", "listbox", "menuitem", "option", "radio", "searchbox", "switch", "tab", "textbox"]);
const LINEAR_TEXT_BOUNDARY_ROLE = "__text-boundary";
const TEXT_RUN_BOUNDARY_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hr",
  "main",
  "nav",
  "p",
  "pre",
  "section"
]);

export function analyzeAccessibility(root = document, options = {}) {
  return withAccessibilityAnalysisCache(() => {
    const headings = collectHeadings(root, options);
    const landmarks = markLandmarkNameProblems(collectLandmarks(root, options));

    return {
      headings: markSkippedLevels(headings),
      landmarks,
      landmarkStructure: collectLandmarkStructure(root, landmarks, options),
      graphics: markGraphicNameProblems(collectGraphicItems(root, options)),
      ariaLabels: markAriaLabelNameProblems(collectAriaLabelItems(root, options)),
      tables: collectTableItems(root, options),
      updatedAt: new Date().toISOString()
    };
  }, options);
}

export function withAccessibilityAnalysisCache(callback, options = {}) {
  const existingContext = getAnalysisContext();
  if (existingContext) {
    return callback(existingContext);
  }

  const context = {
    accessibleNameByElement: new WeakMap(),
    exposedByElement: new WeakMap(),
    options: normalizeAnalysisOptions(options)
  };

  analysisContextStack.push(context);

  try {
    return callback(context);
  } finally {
    analysisContextStack.pop();
  }
}

export function queryElementsDeep(root = document, selector = "*", options = {}) {
  const analysisOptions = normalizeAnalysisOptions(options);
  const elements = [];

  walkComposedTree(root, analysisOptions, (node) => {
    if (node instanceof Element && node.matches(selector)) {
      elements.push(node);
    }
  });

  return elements;
}

export function findElementByIdDeep(root = document, id = "", options = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    return null;
  }

  const direct = getRootIdLookup(root)?.(id);
  if (direct instanceof Element) {
    return direct;
  }

  const analysisOptions = normalizeAnalysisOptions(options);
  let match = null;

  walkComposedTree(root, analysisOptions, (node) => {
    if (!match && node instanceof Element && node.id === id) {
      match = node;
    }
  });

  return match;
}

export function collectHeadings(root = document, options = {}) {
  return queryElementsDeep(root, HEADING_SELECTOR, options)
    .filter(isExposedToAccessibilityTree)
    .map((element) => {
      const nativeLevel = getNativeHeadingLevel(element);
      const role = getExplicitRole(element);
      const ariaLevel = getValidAriaLevel(element);

      if (nativeLevel && !PROHIBITED_HEADING_ROLES.has(role ?? "")) {
        return createHeadingItem(element, nativeLevel, role ?? "heading");
      }

      if (role === "heading" && ariaLevel !== null) {
        return createHeadingItem(element, ariaLevel, "heading");
      }

      return null;
    })
    .filter(Boolean);
}

export function collectLandmarks(root = document, options = {}) {
  return queryElementsDeep(root, LANDMARK_SELECTOR, options)
    .filter(isExposedToAccessibilityTree)
    .map((element) => {
      return createLandmarkItem(element);
    })
    .filter(Boolean);
}

export function collectLandmarkStructure(root = document, landmarks = null, options = {}) {
  const resolvedLandmarks = landmarks ?? collectLandmarks(root, options);
  const landmarkById = new Map(resolvedLandmarks.map((landmark) => [landmark.id, landmark]));
  const body = root.body ?? root.documentElement;
  const analysisOptions = normalizeAnalysisOptions(options);
  const items = [];
  let contentGapId = 0;

  function addContentGap(depth = 0, element = null) {
    const previous = items.at(-1);
    const gap = previous?.type === "content" ? previous : null;
    const elementId = element instanceof Element ? getStableElementId(element) : "";
    const snippet = element instanceof Element ? getLandmarkGapSnippet(element) : "";

    if (gap) {
      if (elementId && !gap.elementIds.includes(elementId)) {
        gap.elementIds.push(elementId);
      }
      if (snippet && !gap.snippets.includes(snippet) && gap.snippets.length < 3) {
        gap.snippets.push(snippet);
      }
      return;
    }

    contentGapId += 1;
    items.push({
      type: "content",
      id: `content-not-in-landmark-${contentGapId}`,
      label: "Content not in a landmark",
      depth,
      elementIds: elementId ? [elementId] : [],
      snippets: snippet ? [snippet] : [],
      problem: "Content is outside landmarks. Place meaningful page content inside a landmark so users can navigate to it."
    });
  }

  const visited = new WeakSet();
  const stack = Array.from(getComposedChildNodes(body, analysisOptions))
    .reverse()
    .map((node) => ({ node, insideLandmark: false }));

  while (stack.length > 0) {
    const { node, insideLandmark } = stack.pop();

    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhitespace(node.textContent ?? "");
      const parent = node.parentElement;

      if (text && parent && !insideLandmark && isExposedToAccessibilityTree(parent) && !isExtensionOwnedElement(parent)) {
        addContentGap(0, parent);
      }

      continue;
    }

    if (!(node instanceof Element) || isExtensionOwnedElement(node)) {
      continue;
    }

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);

    if (!isExposedToAccessibilityTree(node)) {
      if (isPresentationalElement(node)) {
        pushComposedChildren(stack, node, analysisOptions, (child) => ({ node: child, insideLandmark }));
      }

      continue;
    }

    const landmark = createLandmarkItem(node);

    if (landmark) {
      items.push(landmarkById.get(landmark.id) ?? landmark);
      pushComposedChildren(stack, node, analysisOptions, (child) => ({ node: child, insideLandmark: true }));
      continue;
    }

    if (!insideLandmark && hasNonLandmarkSemanticContent(node)) {
      addContentGap(0, node);
    }

    pushComposedChildren(stack, node, analysisOptions, (child) => ({ node: child, insideLandmark }));
  }

  return items;
}

export function collectLinearSemantics(root = document, options = {}) {
  const body = root.body ?? root.documentElement;
  const analysisOptions = normalizeAnalysisOptions(options);
  const items = [];

  walkLinearNode(body, items, 0, null, analysisOptions);

  return mergeLinearTextRuns(items);
}

export function collectInteractiveItems(root = document, options = {}) {
  const elements = queryElementsDeep(root.body ?? root.documentElement, "*", options)
    .filter(isKeyboardReachable)
    .filter((element) => !isExtensionOwnedElement(element));
  const ordered = orderByTabSequence(elements);

  return ordered.map((element) => {
    const role = getInteractiveRole(element);
    const exposed = isExposedToAccessibilityTree(element);

    return {
      id: getStableElementId(element),
      role,
      name: exposed ? getInteractiveName(element, role) : "",
      detail: getInteractiveDetail(element, role),
      selector: getElementSelector(element),
      exposed
    };
  });
}

export function collectGraphicItems(root = document, options = {}) {
  return queryElementsDeep(root, GRAPHIC_SELECTOR, options)
    .filter(shouldIncludeGraphicItem)
    .map((element) => {
      const role = getGraphicRole(element);

      if (!role) {
        return null;
      }

      const name = getGraphicAccessibleName(element, role);

      return {
        id: getStableElementId(element),
        role,
        name,
        status: getGraphicStatus(element, role, name),
        source: getGraphicSourceLabel(element, role),
        thumbnailSrc: getGraphicThumbnailSrc(element),
        selector: getElementSelector(element),
        problem: null
      };
    })
    .filter(Boolean);
}

export function collectAriaLabelItems(root = document, options = {}) {
  return queryElementsDeep(root, ARIA_LABEL_SELECTOR, options)
    .filter(isExposedToAccessibilityTree)
    .filter((element) => !getGraphicRole(element))
    .filter(hasAuthorAriaName)
    .map((element) => {
      const name = computeAccessibleName(element, new Set(), { nameFromContent: true }).trim();

      return {
        id: getStableElementId(element),
        role: getAriaLabelItemRole(element),
        name,
        source: getAriaNameSource(element),
        selector: getElementSelector(element),
        problem: null
      };
    });
}

export function collectTableItems(root = document, options = {}) {
  const analysisOptions = normalizeAnalysisOptions(options);

  return queryElementsDeep(root, TABLE_SELECTOR, analysisOptions)
    .filter(isExposedToAccessibilityTree)
    .filter((element) => !isExtensionOwnedElement(element))
    .map((element) => createTableItem(element, analysisOptions))
    .filter(Boolean);
}

export function isExposedToAccessibilityTree(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const context = getAnalysisContext();
  const cached = context?.exposedByElement.get(element);
  if (typeof cached === "boolean") {
    return cached;
  }

  let exposed = true;

  for (let current = element; current; current = getComposedParentElement(current)) {
    if (current.tagName.toLowerCase() === "noscript") {
      exposed = false;
      break;
    }

    if (current.hasAttribute("hidden")) {
      exposed = false;
      break;
    }

    if (current.getAttribute("aria-hidden") === "true") {
      exposed = false;
      break;
    }

    if (current instanceof HTMLInputElement && HIDDEN_INPUT_TYPES.has(current.type)) {
      exposed = false;
      break;
    }

    const style = getComputedStyle(current);

    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      exposed = false;
      break;
    }

    if (current.inert) {
      exposed = false;
      break;
    }
  }

  if (exposed) {
    const role = getExplicitRole(element);
    exposed = !PRESENTATIONAL_ROLES.has(role ?? "");
  }

  context?.exposedByElement.set(element, exposed);
  return exposed;
}

export function computeAccessibleName(element, visited = new Set(), options = { nameFromContent: true }) {
  if (!(element instanceof Element) || visited.has(element)) {
    return "";
  }

  const context = getAnalysisContext();
  const cacheKey = options.nameFromContent ? "content" : "author";
  const canUseCache = visited.size === 0;

  if (canUseCache) {
    const cachedNames = context?.accessibleNameByElement.get(element);
    const cachedName = cachedNames?.[cacheKey];

    if (typeof cachedName === "string") {
      return cachedName;
    }
  }

  visited.add(element);
  const result = computeAccessibleNameUncached(element, visited, options);

  if (canUseCache) {
    const cachedNames = context?.accessibleNameByElement.get(element) ?? {};
    cachedNames[cacheKey] = result;
    context?.accessibleNameByElement.set(element, cachedNames);
  }

  return result;
}

function computeAccessibleNameUncached(element, visited, options) {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => resolveIdReference(element, id))
      .filter(Boolean)
      .map((labelElement) => computeAccessibleText(labelElement, visited, {
        allowVisitedRoot: labelElement === element,
        depth: 1,
        inLabelledByTraversal: true
      }))
      .join(" ")
      .trim();

    if (label) {
      return normalizeWhitespace(label);
    }
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel?.trim()) {
    return normalizeWhitespace(ariaLabel);
  }

  if (element instanceof HTMLImageElement) {
    return normalizeWhitespace(element.alt);
  }

  if (element instanceof SVGElement) {
    const svgTitle = normalizeWhitespace(
      Array.from(element.children)
        .find((child) => child.tagName.toLowerCase() === "title")
        ?.textContent ?? ""
    );

    if (svgTitle) {
      return svgTitle;
    }
  }

  if (element instanceof HTMLInputElement) {
    const label = getLabelText(element, visited);
    if (label) {
      return label;
    }

    const type = element.type.toLowerCase();
    if (type === "checkbox" || type === "radio") {
      return normalizeWhitespace(element.title);
    }

    return normalizeWhitespace(element.value || element.placeholder || element.title);
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = getLabelText(element, visited);
    if (label) {
      return label;
    }
  }

  if (element instanceof HTMLFieldSetElement) {
    const legend = Array.from(element.children).find((child) => child instanceof HTMLLegendElement);
    if (legend) {
      return computeAccessibleText(legend, visited);
    }
  }

  const title = normalizeWhitespace(element.title);
  if (title) {
    return title;
  }

  return options.nameFromContent ? computeAccessibleText(element, visited, {
    allowVisitedRoot: true,
    skipCurrentLabelledBy: true
  }) : "";
}

function computeAccessibleText(element, visited, options = {}) {
  const depth = options.depth ?? 0;
  const inLabelledByTraversal = options.inLabelledByTraversal ?? false;
  const skipCurrentLabelledBy = options.skipCurrentLabelledBy ?? false;
  if (depth > MAX_ACCESSIBLE_TEXT_DEPTH) {
    return "";
  }

  if (!(element instanceof Element) || !isExposedToAccessibilityTree(element)) {
    return "";
  }

  if (visited.has(element)) {
    if (!options.allowVisitedRoot) {
      return "";
    }
  } else {
    visited.add(element);
  }

  if (NON_CONTENT_TEXT_TAGS.has(element.tagName.toLowerCase())) {
    return "";
  }

  const name = element.getAttribute("aria-label");
  if (name?.trim()) {
    return normalizeWhitespace(name);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy && !inLabelledByTraversal && !skipCurrentLabelledBy) {
    return normalizeWhitespace(
      labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => resolveIdReference(element, id))
        .filter(Boolean)
        .map((labelElement) => computeAccessibleText(labelElement, visited, {
          allowVisitedRoot: labelElement === element,
          depth: depth + 1,
          inLabelledByTraversal: true
        }))
        .join(" ")
    );
  }

  return normalizeWhitespace(
    Array.from(getComposedChildNodes(element, normalizeAnalysisOptions()))
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent ?? "";
        }

        if (node instanceof Element) {
          return computeAccessibleText(node, visited, {
            depth: depth + 1,
            inLabelledByTraversal
          });
        }

        return "";
      })
      .join(" ")
  );
}

function createHeadingItem(element, level, role) {
  return {
    id: getStableElementId(element),
    level,
    role,
    text: computeAccessibleName(element) || "(Untitled heading)",
    source: getHeadingSource(element, level),
    selector: getElementSelector(element),
    problem: null
  };
}

function createLandmarkItem(element) {
  const role = getLandmarkRole(element);

  if (!role) {
    return null;
  }

  const name = computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();

  if (role === "region" && name === "") {
    return null;
  }

  return {
    type: "landmark",
    id: getStableElementId(element),
    role,
    name,
    label: name || getFallbackLandmarkLabel(role),
    source: getLandmarkSource(element, role),
    depth: getLandmarkDepth(element),
    selector: getElementSelector(element),
    problem: null
  };
}

function createTableItem(element, options = {}) {
  const role = getTableRole(element);

  if (!role) {
    return null;
  }

  const cells = getTableCells(element, options)
    .map((cell) => createTableCellItem(cell, element, options))
    .filter(Boolean);
  const rowCount = Math.max(
    getTableRows(element, options).length,
    ...cells.map((cell) => cell.rowIndex),
    0
  );
  const columnCount = Math.max(
    ...cells.map((cell) => cell.columnIndex),
    0
  );
  const headerCellCount = cells.filter((cell) => cell.role === "columnheader" || cell.role === "rowheader").length;
  const dataCellCount = cells.length - headerCellCount;
  const caption = getTableCaptionText(element, options);
  const name = computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();

  return {
    id: getStableElementId(element),
    role,
    name,
    caption,
    source: getTableSource(element, role),
    selector: getElementSelector(element),
    rowCount,
    columnCount,
    headerCellCount,
    dataCellCount,
    cells
  };
}

function createTableCellItem(element, table, options = {}) {
  const role = getTableCellRole(element);

  if (!role) {
    return null;
  }

  return {
    id: getStableElementId(element),
    role,
    text: getTableCellText(element),
    source: getTableCellSource(element, role),
    selector: getElementSelector(element),
    rowIndex: getTableCellRowIndex(element, table, options),
    columnIndex: getTableCellColumnIndex(element),
    headerScope: element.getAttribute("scope")?.trim().toLowerCase() || undefined
  };
}

function getHeadingSource(element, level) {
  const tag = element.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    return `<${tag}>`;
  }

  return `role="heading" + aria-level="${level}"`;
}

function getLandmarkSource(element, role) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole === role) {
    return `role="${role}"`;
  }

  return `<${element.tagName.toLowerCase()}>`;
}

function getTableSource(element, role) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole === role) {
    return `role="${role}"`;
  }

  return `<${element.tagName.toLowerCase()}>`;
}

function getTableCellSource(element, role) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole === role) {
    return `role="${role}"`;
  }

  return `<${element.tagName.toLowerCase()}>`;
}

function getTableCaptionText(element, options = {}) {
  const caption = getComposedChildElements(element, options)
    .find((child) => child.tagName.toLowerCase() === "caption");

  return caption ? normalizeWhitespace(caption.textContent ?? "") : "";
}

function getTableCellText(element) {
  const name = computeAccessibleName(element, new Set(), { nameFromContent: true }).trim() ||
    normalizeWhitespace(element.textContent ?? "");

  return name.length <= 96 ? name : `${name.slice(0, 95).trimEnd()}...`;
}

function getTableRows(table, options = {}) {
  return queryElementsDeep(table, TABLE_ROW_SELECTOR, options)
    .filter((row) => row !== table)
    .filter((row) => getClosestComposedElement(row, TABLE_SELECTOR) === table)
    .filter(isExposedToAccessibilityTree);
}

function getTableCells(table, options = {}) {
  return queryElementsDeep(table, TABLE_CELL_SELECTOR, options)
    .filter((cell) => getClosestComposedElement(cell, TABLE_SELECTOR) === table)
    .filter(isExposedToAccessibilityTree);
}

function getTableCellRowIndex(element, table, options = {}) {
  const ariaRowIndex = getPositiveIntegerAttribute(element, "aria-rowindex");
  if (ariaRowIndex) {
    return ariaRowIndex;
  }

  const row = getClosestComposedElement(element, TABLE_ROW_SELECTOR);
  if (!row) {
    return 1;
  }

  const rowAriaIndex = getPositiveIntegerAttribute(row, "aria-rowindex");
  if (rowAriaIndex) {
    return rowAriaIndex;
  }

  const rows = getTableRows(table, options);
  const index = rows.indexOf(row);

  return index >= 0 ? index + 1 : 1;
}

function getTableCellColumnIndex(element) {
  const ariaColumnIndex = getPositiveIntegerAttribute(element, "aria-colindex");
  if (ariaColumnIndex) {
    return ariaColumnIndex;
  }

  if ("cellIndex" in element && Number.isInteger(element.cellIndex) && element.cellIndex >= 0) {
    return element.cellIndex + 1;
  }

  const row = getClosestComposedElement(element, TABLE_ROW_SELECTOR);
  if (!row) {
    return 1;
  }

  const cells = getComposedChildElements(row, normalizeAnalysisOptions())
    .filter((child) => Boolean(getTableCellRole(child)));
  const index = cells.indexOf(element);

  return index >= 0 ? index + 1 : 1;
}

function hasNonLandmarkSemanticContent(element) {
  const semantic = getLinearSemanticInfo(element);

  return Boolean(semantic && !LANDMARK_ROLES.has(semantic.role));
}

function getLandmarkGapSnippet(element) {
  const text = normalizeWhitespace(element.textContent ?? "") ||
    computeAccessibleName(element, new Set(), { nameFromContent: true }).trim();

  if (text.length <= 96) {
    return text;
  }

  return `${text.slice(0, 95).trimEnd()}...`;
}

function isPresentationalElement(element) {
  return PRESENTATIONAL_ROLES.has(getExplicitRole(element) ?? "");
}

function walkLinearNode(rootNode, items, depth, listItemContext = null, options = {}) {
  const visited = new WeakSet();
  const stack = [{ type: "node", node: rootNode, depth, listItemContext }];

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame.type === "boundary") {
      items.push(createLinearTextBoundary(frame.depth));
      continue;
    }

    const { node } = frame;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhitespace(node.textContent ?? "");
      const parent = node.parentElement;

      if (text && parent && isExposedToAccessibilityTree(parent) && !isSvgImplementationText(parent)) {
        items.push({
          id: getStableElementId(parent),
          role: "text",
          name: text,
          detail: "",
          depth: frame.depth
        });
      }

      continue;
    }

    if (!(node instanceof Element) || !isExposedToAccessibilityTree(node) || isExtensionOwnedElement(node)) {
      continue;
    }

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);

    if (node.tagName.toLowerCase() === "br") {
      items.push(createLinearTextBoundary(frame.depth));
      continue;
    }

    const semantic = getLinearSemanticInfo(node);
    const nextDepth = semantic ? frame.depth + 1 : frame.depth;
    const textRunBoundary = !semantic && isTextRunBoundaryElement(node);

    if (semantic) {
      const listPosition = semantic.role === "listitem" ? frame.listItemContext?.position : undefined;
      const listSize = semantic.role === "listitem" ? frame.listItemContext?.size : undefined;

      items.push({
        id: getStableElementId(node),
        ...semantic,
        depth: frame.depth,
        ...(listPosition && listSize ? { listPosition, listSize } : {})
      });

      if (node instanceof SVGElement || CHILDREN_ARE_NAME_ROLES.has(semantic.role) || shouldUseChildrenAsLinearName(node, semantic.role)) {
        continue;
      }
    }

    if (textRunBoundary) {
      items.push(createLinearTextBoundary(frame.depth));
    }

    const childListItems = semantic?.role === "list" ? getLinearListItems(node, options) : [];
    let childListItemPosition = 0;
    const childFrames = getComposedChildNodes(node, options).map((child) => {
      const childListItemContext = childListItems.includes(child)
        ? { position: childListItemPosition += 1, size: childListItems.length }
        : null;

      return { type: "node", node: child, depth: nextDepth, listItemContext: childListItemContext };
    });

    if (textRunBoundary) {
      stack.push({ type: "boundary", depth: frame.depth });
    }

    for (let index = childFrames.length - 1; index >= 0; index -= 1) {
      stack.push(childFrames[index]);
    }
  }
}

function getLinearListItems(element, options = {}) {
  return getComposedChildElements(element, options).filter((child) => getLinearRole(child) === "listitem");
}

function getLinearSemanticInfo(element) {
  const role = getLinearRole(element);

  if (!role) {
    return null;
  }

  const detail = getLinearRoleDetail(element, role);
  const hasNestedSemantics = role === "listitem" && hasNestedLinearSemanticContent(element);
  const name = hasNestedSemantics ? "" : getLinearName(element, role);

  if (role === "text" || name || detail || isContainerRole(role) || hasNestedSemantics || shouldShowMissingTextNote(role)) {
    return { role, name: name || getFallbackLinearLabel(element, role), detail };
  }

  return null;
}

function getLinearRole(element) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole && VALID_ARIA_ROLES.has(explicitRole)) {
    if (explicitRole === "heading" && getValidAriaLevel(element) === null) {
      return null;
    }

    if (explicitRole === "region" && !computeAccessibleName(element, new Set(), { nameFromContent: false }).trim()) {
      return null;
    }

    return explicitRole;
  }

  if (explicitRole) {
    return null;
  }

  const landmarkRole = getLandmarkRole(element);
  if (landmarkRole) {
    return landmarkRole;
  }

  const nativeHeadingLevel = getNativeHeadingLevel(element);
  if (nativeHeadingLevel) {
    return "heading";
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "button") return "button";
  if (tag === "img" || tag === "svg" || tag === "figure") return getGraphicRole(element) ?? "img";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "listitem";
  if (tag === "table") return "table";
  if (tag === "tr") return "row";
  if (tag === "th") return element.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
  if (tag === "td") return "cell";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return getSelectRole(element);
  if (tag === "output") return "status";

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "searchbox";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
  }

  return null;
}

function getGraphicRole(element) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole && GRAPHIC_ROLES.has(explicitRole)) {
    return explicitRole;
  }

  if (explicitRole) {
    return null;
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "img" || tag === "svg") return "img";
  if (tag === "figure") return "figure";
  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "image") return "img";

  return null;
}

function getGraphicAccessibleName(element, role) {
  const name = computeAccessibleName(element, new Set(), { nameFromContent: true }).trim();

  if (name) {
    return name;
  }

  if (role === "figure") {
    const caption = Array.from(element.children ?? [])
      .find((child) => child instanceof HTMLElement && child.tagName.toLowerCase() === "figcaption");

    if (caption) {
      return computeAccessibleText(caption, new Set()).trim();
    }
  }

  return "";
}

function getGraphicSourceLabel(element, role) {
  const explicitRole = getExplicitRole(element);
  const tag = element.tagName.toLowerCase();

  if (explicitRole && GRAPHIC_ROLES.has(explicitRole)) {
    return `role="${role}"`;
  }

  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "image") {
    return "input image";
  }

  return tag;
}

function getGraphicThumbnailSrc(element) {
  if (element instanceof HTMLImageElement) {
    return normalizeWhitespace(element.currentSrc || element.src);
  }

  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "image") {
    return normalizeWhitespace(element.src);
  }

  const svg = getSvgForThumbnail(element);

  if (svg) {
    return getSvgThumbnailSrc(svg);
  }

  return "";
}

function getSvgForThumbnail(element) {
  if (element instanceof SVGElement && element.tagName.toLowerCase() === "svg") {
    return element;
  }

  if (element instanceof Element) {
    return queryElementsDeep(element, "svg").at(0) ?? null;
  }

  return null;
}

function getSvgThumbnailSrc(svg) {
  try {
    const clone = svg.cloneNode(true);
    inlineSvgUseReferences(clone, svg);
    sanitizeSvgThumbnail(clone);

    if (!clone.namespaceURI && !clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    applySvgThumbnailComputedStyles(clone, svg);

    const serialized = new XMLSerializer().serializeToString(clone);

    if (!serialized || serialized.length > SVG_THUMBNAIL_MAX_LENGTH) {
      return "";
    }

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  } catch {
    return "";
  }
}

function inlineSvgUseReferences(clone, originalSvg) {
  const clonedUses = Array.from(clone.querySelectorAll("use"));
  const originalUses = Array.from(originalSvg.querySelectorAll("use"));

  clonedUses.forEach((clonedUse, index) => {
    const originalUse = originalUses[index];
    const href = originalUse?.getAttribute("href") ?? originalUse?.getAttribute("xlink:href") ?? clonedUse.getAttribute("href") ?? clonedUse.getAttribute("xlink:href");
    const referenced = getReferencedSvgNode(href, originalSvg);

    if (!referenced) {
      return;
    }

    const replacement = createSvgUseReplacement(clonedUse, referenced, clone);
    clonedUse.replaceWith(replacement);
  });
}

function getReferencedSvgNode(href, svg) {
  if (!href) {
    return null;
  }

  const [urlPart, rawId] = href.split("#");

  if (!rawId) {
    return null;
  }

  const id = decodeURIComponent(rawId);

  if (!urlPart) {
    return svg.ownerDocument?.getElementById(id);
  }

  // Avoid synchronous network fetches while analyzing the inspected page.
  return null;
}

function createSvgUseReplacement(use, referenced, rootSvg) {
  const thumbnailDocument = rootSvg.ownerDocument;
  const replacement = thumbnailDocument.createElementNS("http://www.w3.org/2000/svg", "g");

  Array.from(use.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();

    if (name !== "href" && name !== "xlink:href") {
      replacement.setAttribute(attribute.name, attribute.value);
    }
  });

  if (!rootSvg.getAttribute("viewBox") && referenced.getAttribute("viewBox")) {
    rootSvg.setAttribute("viewBox", referenced.getAttribute("viewBox"));
  }

  if (referenced.tagName.toLowerCase() === "symbol" || referenced.tagName.toLowerCase() === "svg") {
    Array.from(referenced.childNodes).forEach((child) => {
      replacement.appendChild(thumbnailDocument.importNode(child, true));
    });
    return replacement;
  }

  replacement.appendChild(thumbnailDocument.importNode(referenced, true));
  return replacement;
}

function applySvgThumbnailComputedStyles(clone, originalSvg) {
  const computed = originalSvg.ownerDocument?.defaultView?.getComputedStyle(originalSvg);

  if (computed?.color) {
    clone.style.color = computed.color;
  }

  if (!clone.getAttribute("width") && originalSvg.getBoundingClientRect().width) {
    clone.setAttribute("width", String(Math.ceil(originalSvg.getBoundingClientRect().width)));
  }

  if (!clone.getAttribute("height") && originalSvg.getBoundingClientRect().height) {
    clone.setAttribute("height", String(Math.ceil(originalSvg.getBoundingClientRect().height)));
  }
}

function sanitizeSvgThumbnail(svg) {
  svg.querySelectorAll("script,foreignObject,iframe,object,embed").forEach((element) => element.remove());

  [svg, ...svg.querySelectorAll("*")].forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    });
  });
}

function getGraphicStatus(element, role, name) {
  if (!isExposedToAccessibilityTree(element) && isHiddenFromAccessibilityWithAria(element)) {
    return "decorative";
  }

  if (element instanceof HTMLImageElement) {
    if (!element.hasAttribute("alt")) {
      return "missing-alt";
    }

    if (element.getAttribute("alt") === "") {
      return "decorative";
    }
  }

  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "image" && !element.hasAttribute("alt")) {
    return "missing-alt";
  }

  return name ? "named" : `unnamed-${role}`;
}

function shouldIncludeGraphicItem(element) {
  if (isExposedToAccessibilityTree(element)) {
    return true;
  }

  return isRenderedForGraphicList(element) && isHiddenFromAccessibilityWithAria(element);
}

function isRenderedForGraphicList(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  for (let current = element; current; current = getComposedParentElement(current)) {
    if (current.tagName.toLowerCase() === "noscript") {
      return false;
    }

    if (current.hasAttribute("hidden")) {
      return false;
    }

    if (current instanceof HTMLInputElement && HIDDEN_INPUT_TYPES.has(current.type)) {
      return false;
    }

    if (current.inert) {
      return false;
    }

    const style = getComputedStyle(current);

    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
  }

  return true;
}

function isHiddenFromAccessibilityWithAria(element) {
  for (let current = element; current; current = getComposedParentElement(current)) {
    if (current.getAttribute("aria-hidden") === "true") {
      return true;
    }
  }

  return false;
}

function hasAuthorAriaName(element) {
  return Boolean(
    element.getAttribute("aria-label")?.trim() ||
    element.getAttribute("aria-labelledby")?.trim()
  );
}

function getAriaLabelItemRole(element) {
  return getLinearRole(element) ?? getExplicitRole(element) ?? element.tagName.toLowerCase();
}

function getAriaNameSource(element) {
  const sources = [];

  if (element.getAttribute("aria-label")?.trim()) {
    sources.push("aria-label");
  }

  if (element.getAttribute("aria-labelledby")?.trim()) {
    sources.push("aria-labelledby");
  }

  return sources.join(" + ");
}

function getInteractiveRole(element) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole && INTERACTIVE_ROLES.has(explicitRole)) {
    return explicitRole;
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return getSelectRole(element);
  if (tag === "output") return "status";

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "searchbox";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
  }

  if (element.isContentEditable) {
    return "textbox";
  }

  return explicitRole && VALID_ARIA_ROLES.has(explicitRole) ? explicitRole : "focusable";
}

function getInteractiveName(element, role) {
  const name = computeAccessibleName(element, new Set(), { nameFromContent: true }).trim();

  if (name) {
    return name;
  }

  if (role === "textbox" && element instanceof HTMLInputElement) {
    return normalizeWhitespace(element.placeholder);
  }

  return "(No accessible name)";
}

function getInteractiveDetail(element, role) {
  const details = [];

  if (role === "checkbox" || role === "radio" || role === "switch") {
    const checked = element.getAttribute("aria-checked");

    if (checked) {
      details.push(checked === "true" ? "checked" : "not checked");
    } else if (element instanceof HTMLInputElement) {
      details.push(element.checked ? "checked" : "not checked");
    }
  }

  if (role === "button" && element.getAttribute("aria-pressed")) {
    details.push(element.getAttribute("aria-pressed") === "true" ? "pressed" : "not pressed");
  }

  if (element instanceof HTMLSelectElement) {
    const selected = getSelectedOptionText(element);
    const optionCount = Array.from(element.options).filter((option) => !option.disabled).length;

    if (selected) {
      details.push(`selected ${selected}`);
    }

    if (role === "combobox") {
      details.push("collapsed");
    }

    if (optionCount > 0) {
      details.push(`${optionCount} option${optionCount === 1 ? "" : "s"}`);
    }
  }

  if (element.getAttribute("aria-disabled") === "true") {
    details.push("disabled");
  }

  const tabIndex = element.getAttribute("tabindex");
  if (tabIndex && Number(tabIndex) > 0) {
    details.push(`tabindex ${tabIndex}`);
  }

  return details.join(", ");
}

function isKeyboardReachable(element) {
  if (!(element instanceof HTMLElement) || !isRenderedForKeyboard(element) || isDisabledNativeControl(element)) {
    return false;
  }

  if (element.tabIndex >= 0) {
    return true;
  }

  return Boolean(element.matches("a[href],button,input:not([type='hidden']),select,textarea,summary,[contenteditable='true'],audio[controls],video[controls]"));
}

function isRenderedForKeyboard(element) {
  for (let current = element; current; current = getComposedParentElement(current)) {
    if (current.hasAttribute("hidden")) {
      return false;
    }

    if (current instanceof HTMLInputElement && HIDDEN_INPUT_TYPES.has(current.type)) {
      return false;
    }

    const style = getComputedStyle(current);

    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }

    if (current.inert) {
      return false;
    }
  }

  return true;
}

function isDisabledNativeControl(element) {
  return Boolean(
    element instanceof HTMLButtonElement && element.disabled ||
    element instanceof HTMLInputElement && element.disabled ||
    element instanceof HTMLSelectElement && element.disabled ||
    element instanceof HTMLTextAreaElement && element.disabled
  );
}

function orderByTabSequence(elements) {
  return elements
    .map((element, index) => ({ element, index, tabIndex: element.tabIndex }))
    .sort((first, second) => {
      const firstPositive = first.tabIndex > 0;
      const secondPositive = second.tabIndex > 0;

      if (firstPositive && secondPositive && first.tabIndex !== second.tabIndex) {
        return first.tabIndex - second.tabIndex;
      }

      if (firstPositive !== secondPositive) {
        return firstPositive ? -1 : 1;
      }

      return first.index - second.index;
    })
    .map((entry) => entry.element);
}

function getLinearRoleDetail(element, role) {
  if (role === "heading") {
    return `level ${getValidAriaLevel(element) ?? getNativeHeadingLevel(element) ?? 2}`;
  }

  if (role === "checkbox" || role === "radio" || role === "switch") {
    if (element.getAttribute("aria-checked")) {
      return element.getAttribute("aria-checked") === "true" ? "checked" : "not checked";
    }

    if (element instanceof HTMLInputElement) {
      return element.checked ? "checked" : "not checked";
    }
  }

  if (role === "button" && element.getAttribute("aria-pressed")) {
    return element.getAttribute("aria-pressed") === "true" ? "pressed" : "not pressed";
  }

  if (element instanceof HTMLSelectElement) {
    const details = [];
    const selected = getSelectedOptionText(element);
    const optionCount = Array.from(element.options).filter((option) => !option.disabled).length;

    if (selected) {
      details.push(`selected ${selected}`);
    }

    if (role === "combobox") {
      details.push("collapsed");
    }

    if (optionCount > 0) {
      details.push(`${optionCount} option${optionCount === 1 ? "" : "s"}`);
    }

    return details.join(", ");
  }

  if (role === "list") {
    const size = getLinearListItems(element).length;
    return size > 0 ? `${size} item${size === 1 ? "" : "s"}` : "";
  }

  return "";
}

function getLinearName(element, role) {
  if (LANDMARK_ROLES.has(role) || role === "form" || role === "region") {
    return computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();
  }

  if (element instanceof HTMLSelectElement) {
    return computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();
  }

  if (role === "list" || role === "table") {
    return computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();
  }

  return computeAccessibleName(element, new Set(), { nameFromContent: true }).trim();
}

function getFallbackLinearLabel(element, role) {
  if (role === "img") {
    return "Note: image is missing accessible text";
  }

  if (role === "heading") {
    return "Note: heading is missing text";
  }

  if (shouldShowMissingTextNote(role)) {
    return "Note: missing accessible text";
  }

  if (isContainerRole(role)) {
    return getFallbackLandmarkLabel(role);
  }

  return "";
}

function mergeLinearTextRuns(items) {
  const merged = [];
  let textMergeBlocked = false;

  for (const item of items) {
    if (item.role === LINEAR_TEXT_BOUNDARY_ROLE) {
      textMergeBlocked = true;
      continue;
    }

    const previous = merged.at(-1);

    if (item.role === "text" && previous?.role === "text" && previous.depth === item.depth && !textMergeBlocked) {
      previous.name = normalizeWhitespace(`${previous.name} ${item.name}`);
      continue;
    }

    merged.push({ ...item });
    textMergeBlocked = false;
  }

  return merged;
}

function createLinearTextBoundary(depth) {
  return {
    id: "",
    role: LINEAR_TEXT_BOUNDARY_ROLE,
    name: "",
    detail: "",
    depth
  };
}

function isTextRunBoundaryElement(element) {
  return TEXT_RUN_BOUNDARY_TAGS.has(element.tagName.toLowerCase());
}

function shouldShowMissingTextNote(role) {
  return MISSING_TEXT_NOTE_ROLES.has(role);
}

function isSvgImplementationText(element) {
  return Boolean(getClosestComposedElement(element, "svg"));
}

function shouldUseChildrenAsLinearName(element, role) {
  return role === "listitem" && !hasNestedLinearSemanticContent(element);
}

function hasNestedLinearSemanticContent(element) {
  for (const child of getComposedChildElements(element, normalizeAnalysisOptions())) {
    if (!isExposedToAccessibilityTree(child) || isExtensionOwnedElement(child)) {
      continue;
    }

    if (getLinearSemanticInfo(child)) {
      return true;
    }

    if (hasNestedLinearSemanticContent(child)) {
      return true;
    }
  }

  return false;
}

function isContainerRole(role) {
  return LANDMARK_ROLES.has(role) || role === "article" || role === "dialog" || role === "document" || role === "list" || role === "table";
}

function isExtensionOwnedElement(element) {
  return Boolean(element.closest?.(
    "#a11y-tools-live-region-captions,#a11y-tools-live-region-marker,#a11y-tools-page-status,#a11y-tools-live-region-captions-style,#a11y-tools-page-structure-overlay,#a11y-tools-page-structure-overlay-style,#a11y-tools-linear-view,#a11y-tools-linear-view-style"
  ));
}

function markSkippedLevels(headings) {
  let previousLevel = 0;

  return headings.map((heading) => {
    const skippedBy = previousLevel > 0 && heading.level > previousLevel + 1
      ? heading.level - previousLevel - 1
      : 0;
    previousLevel = heading.level;

    return {
      ...heading,
      problem: skippedBy > 0
        ? `Heading level jumps from h${heading.level - skippedBy - 1} to h${heading.level}.`
        : null
    };
  });
}

function markLandmarkNameProblems(landmarks) {
  const unnamedCountByRole = landmarks.reduce((counts, landmark) => {
    if (!landmark.name) {
      counts.set(landmark.role, (counts.get(landmark.role) ?? 0) + 1);
    }
    return counts;
  }, new Map());

  return landmarks.map((landmark) => {
    if (!landmark.name && (unnamedCountByRole.get(landmark.role) ?? 0) > 1) {
      return {
        ...landmark,
        problem: `Multiple ${landmark.role} landmarks are unnamed. Add accessible names so users can tell them apart.`
      };
    }

    return landmark;
  });
}

function markGraphicNameProblems(graphics) {
  return graphics.map((graphic) => {
    if (graphic.status === "decorative") {
      return graphic;
    }

    if (graphic.status === "missing-alt") {
      return {
        ...graphic,
        problem: "Missing alt attribute. Add alt text for informative images, or use alt=\"\" only when the image is decorative or redundant."
      };
    }

    if (!graphic.name) {
      return {
        ...graphic,
        problem: "No accessible name found. This is only appropriate when the graphic is decorative or redundant."
      };
    }

    return graphic;
  });
}

function markAriaLabelNameProblems(items) {
  return items.map((item) => {
    if (!item.name) {
      return {
        ...item,
        problem: "ARIA naming is present but no accessible name could be computed. Check that referenced labels exist and are exposed."
      };
    }

    return item;
  });
}

function getNativeHeadingLevel(element) {
  const match = element.tagName.match(/^H([1-6])$/);
  return match ? Number(match[1]) : null;
}

function getValidAriaLevel(element) {
  const value = Number(element.getAttribute("aria-level"));
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}

function getExplicitRole(element) {
  return element.getAttribute("role")?.trim().toLowerCase().split(/\s+/)[0] ?? null;
}

function getLandmarkRole(element) {
  const explicitRole = getExplicitRole(element);
  if (explicitRole && LANDMARK_ROLES.has(explicitRole)) {
    return explicitRole;
  }

  if (explicitRole) {
    return null;
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "main") return "main";
  if (tag === "nav") return "navigation";
  if (tag === "aside") return "complementary";
  if (tag === "form") return computeAccessibleName(element, new Set(), { nameFromContent: false }) ? "form" : null;
  if (tag === "section") return computeAccessibleName(element, new Set(), { nameFromContent: false }) ? "region" : null;

  if (tag === "header" && !hasSectioningAncestor(element)) return "banner";
  if (tag === "footer" && !hasSectioningAncestor(element)) return "contentinfo";

  return null;
}

function getTableRole(element) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole && TABLE_ROLES.has(explicitRole)) {
    return explicitRole;
  }

  if (explicitRole) {
    return null;
  }

  return element.tagName.toLowerCase() === "table" ? "table" : null;
}

function getTableCellRole(element) {
  const explicitRole = getExplicitRole(element);

  if (explicitRole && TABLE_CELL_ROLES.has(explicitRole)) {
    return explicitRole;
  }

  if (explicitRole) {
    return null;
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "th") {
    const scope = element.getAttribute("scope")?.trim().toLowerCase();
    return scope === "row" || scope === "rowgroup" ? "rowheader" : "columnheader";
  }

  if (tag === "td") {
    return "cell";
  }

  return null;
}

function getPositiveIntegerAttribute(element, attribute) {
  const value = Number(element.getAttribute(attribute));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getLandmarkDepth(element) {
  let depth = 0;

  for (let current = getComposedParentElement(element); current; current = getComposedParentElement(current)) {
    if (isIncludedLandmark(current)) {
      depth += 1;
    }
  }

  return depth;
}

function isIncludedLandmark(element) {
  if (!isExposedToAccessibilityTree(element)) {
    return false;
  }

  const role = getLandmarkRole(element);
  if (!role) {
    return false;
  }

  const name = computeAccessibleName(element, new Set(), { nameFromContent: false }).trim();
  return role !== "region" || name !== "";
}

function hasSectioningAncestor(element) {
  return Boolean(getClosestComposedElement(getComposedParentElement(element), "article,aside,main,nav,section"));
}

function getLabelText(element, visited) {
  if (element.labels?.length) {
    return normalizeWhitespace(
      Array.from(element.labels)
        .map((label) => computeLabelText(label, element, visited))
        .join(" ")
    );
  }

  return "";
}

function computeLabelText(node, labelledControl, visited, depth = 0) {
  if (depth > MAX_ACCESSIBLE_TEXT_DEPTH) {
    return "";
  }

  if (node === labelledControl) {
    return "";
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof Element) || !isExposedToAccessibilityTree(node)) {
    return "";
  }

  if (visited.has(node)) {
    return "";
  }

  visited.add(node);

  const ariaLabel = node.getAttribute("aria-label");
  if (ariaLabel?.trim()) {
    return normalizeWhitespace(ariaLabel);
  }

  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy?.trim()) {
    return normalizeWhitespace(
      labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => resolveIdReference(node, id))
        .filter(Boolean)
        .map((labelElement) => computeAccessibleText(labelElement, visited, {
          allowVisitedRoot: labelElement === node,
          depth: depth + 1,
          inLabelledByTraversal: true
        }))
        .join(" ")
    );
  }

  return Array.from(getComposedChildNodes(node, normalizeAnalysisOptions()))
    .map((child) => computeLabelText(child, labelledControl, visited, depth + 1))
    .join(" ");
}

function getSelectRole(element) {
  if (!(element instanceof HTMLSelectElement)) {
    return "combobox";
  }

  return element.multiple || element.size > 1 ? "listbox" : "combobox";
}

function getSelectedOptionText(element) {
  if (!(element instanceof HTMLSelectElement)) {
    return "";
  }

  const selectedOptions = Array.from(element.selectedOptions)
    .map((option) => normalizeWhitespace(option.textContent ?? ""))
    .filter(Boolean);

  return selectedOptions.join(", ");
}

function getFallbackLandmarkLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getStableElementId(element) {
  if (!element.id) {
    element.id = `a11y-tools-${Math.random().toString(36).slice(2, 10)}`;
  }

  return element.id;
}

function getElementSelector(element) {
  if (element.id && !isGeneratedElementId(element.id) && !isInShadowTree(element)) {
    return `#${CSS.escape(element.id)}`;
  }

  const parts = [];
  let current = element;
  const ownerDocument = element.ownerDocument ?? document;

  while (current instanceof Element && current !== ownerDocument.documentElement) {
    parts.unshift(getSelectorPart(current));
    const parent = current.parentElement;

    if (parent?.id && !isGeneratedElementId(parent.id)) {
      parts.unshift(`#${CSS.escape(parent.id)}`);
      break;
    }

    if (parent === ownerDocument.body) {
      parts.unshift("body");
      break;
    }

    if (parent) {
      current = parent;
      continue;
    }

    const root = current.getRootNode?.();
    if (root instanceof ShadowRoot) {
      parts.unshift("::shadow");
      current = root.host;
      continue;
    }

    break;
  }

  return parts.join(" > ");
}

function getSelectorPart(element) {
  const tag = element.tagName.toLowerCase();
  const classNames = Array.from(element.classList ?? [])
    .filter((className) => !className.startsWith("a11y-tools-"))
    .slice(0, 2);
  const classSelector = classNames.length ? `.${classNames.map((className) => CSS.escape(className)).join(".")}` : "";
  const sameTagSiblings = getComposedSiblingElements(element)
    .filter((sibling) => sibling.tagName === element.tagName);
  const index = sameTagSiblings.indexOf(element) + 1;
  const nth = sameTagSiblings.length > 1 && index > 0 ? `:nth-of-type(${index})` : "";

  return `${tag}${classSelector}${nth}`;
}

function isGeneratedElementId(id) {
  return /^a11y-tools-[a-z0-9]{8}$/i.test(id);
}

function isInShadowTree(element) {
  const root = element.getRootNode?.();
  return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot;
}

function normalizeAnalysisOptions(options = {}) {
  const contextOptions = getAnalysisContext()?.options ?? DEFAULT_ANALYSIS_OPTIONS;

  return {
    includeShadowDom: options.includeShadowDom ?? contextOptions.includeShadowDom ?? DEFAULT_ANALYSIS_OPTIONS.includeShadowDom
  };
}

function walkComposedTree(root, options, callback) {
  const start = getTraversalRoot(root);

  if (!start) {
    return;
  }

  const visited = new WeakSet();
  const stack = [start];

  while (stack.length > 0) {
    const node = stack.pop();

    if (visited.has(node)) {
      continue;
    }

    visited.add(node);
    callback(node);
    pushComposedChildren(stack, node, options, (child) => child);
  }
}

function pushComposedChildren(stack, node, options, createFrame) {
  const children = getComposedChildNodes(node, options);

  for (let index = children.length - 1; index >= 0; index -= 1) {
    stack.push(createFrame(children[index]));
  }
}

function getTraversalRoot(root) {
  if (root instanceof Document) {
    return root.documentElement ?? root.body;
  }

  return root;
}

function getComposedChildNodes(node, options = {}) {
  const analysisOptions = normalizeAnalysisOptions(options);

  if (typeof HTMLSlotElement !== "undefined" && node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    if (assigned.length > 0) {
      return assigned;
    }
  }

  if (analysisOptions.includeShadowDom && node instanceof Element && node.shadowRoot) {
    return Array.from(node.shadowRoot.childNodes);
  }

  return Array.from(node.childNodes ?? []);
}

function getComposedChildElements(element, options = {}) {
  return getComposedChildNodes(element, options).filter((child) => child instanceof Element);
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

function getComposedSiblingElements(element) {
  if (!(element instanceof Element)) {
    return [];
  }

  const parent = element.parentElement;
  if (parent) {
    return Array.from(parent.children);
  }

  const root = element.getRootNode?.();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    return Array.from(root.children);
  }

  return [element];
}

function getRootIdLookup(root) {
  if (root instanceof Document) {
    return (id) => root.getElementById(id);
  }

  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    return (id) => root.getElementById(id);
  }

  return null;
}

function resolveIdReference(element, id) {
  const root = element.getRootNode?.();
  const sameTreeMatch = getRootIdLookup(root)?.(id);

  if (sameTreeMatch instanceof Element) {
    return sameTreeMatch;
  }

  return element.ownerDocument?.getElementById(id) ?? null;
}

function normalizeWhitespace(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function getAnalysisContext() {
  return analysisContextStack.at(-1) ?? null;
}
