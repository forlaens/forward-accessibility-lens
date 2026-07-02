import { describe, expect, it } from "vitest";
import { analyzeAccessibility, collectAriaLabelItems, collectGraphicItems, collectInteractiveItems, collectLandmarkStructure, collectLinearSemantics, collectTableItems, queryElementsDeep } from "../src/shared/a11y-tree.js";

describe("accessibility tree analysis", () => {
  it("includes native and aria headings that are exposed", () => {
    document.body.innerHTML = `
      <h1>Page title</h1>
      <div role="heading" aria-level="2">ARIA heading</div>
      <h2 role="button">Button-like text</h2>
      <div role="heading" aria-level="bad">Invalid level</div>
      <div aria-hidden="true"><h2>Hidden heading</h2></div>
      <h2 style="display: none">Display none heading</h2>
    `;

    const result = analyzeAccessibility(document);

    expect(result.headings.map((heading) => heading.text)).toEqual([
      "Page title",
      "ARIA heading"
    ]);
  });

  it("reports which element or ARIA attributes create heading semantics", () => {
    document.body.innerHTML = `
      <h2>Native heading</h2>
      <div role="heading" aria-level="3">ARIA heading</div>
    `;

    const result = analyzeAccessibility(document);

    expect(result.headings.map((heading) => heading.source)).toEqual([
      "<h2>",
      "role=\"heading\" + aria-level=\"3\""
    ]);
  });

  it("flags heading jumps that skip several levels", () => {
    document.body.innerHTML = `
      <h1>One</h1>
      <h4>Four</h4>
    `;

    const result = analyzeAccessibility(document);

    expect(result.headings[1].problem).toContain("jumps from h1 to h4");
  });

  it("finds exposed landmarks and flags repeated unnamed landmarks of the same role", () => {
    document.body.innerHTML = `
      <header>Site header</header>
      <nav aria-label="Primary">Navigation links</nav>
      <main>Main content</main>
      <aside>Related one</aside>
      <aside>Related two</aside>
      <section>Not a region without a name</section>
      <section aria-label="Support">Named region</section>
      <div role="navigation" aria-hidden="true">Hidden nav</div>
    `;

    const result = analyzeAccessibility(document);

    expect(result.landmarks.map((landmark) => landmark.role)).toEqual([
      "banner",
      "navigation",
      "main",
      "complementary",
      "complementary",
      "region"
    ]);
    expect(result.landmarks.filter((landmark) => landmark.problem)).toHaveLength(2);
    expect(result.landmarks.find((landmark) => landmark.role === "navigation")?.name).toBe("Primary");
  });

  it("does not flag a single unnamed contentinfo landmark", () => {
    document.body.innerHTML = `
      <main>Main content</main>
      <footer>Copyright Example</footer>
    `;

    const result = analyzeAccessibility(document);
    const contentinfo = result.landmarks.find((landmark) => landmark.role === "contentinfo");

    expect(contentinfo).toBeDefined();
    expect(contentinfo?.name).toBe("");
    expect(contentinfo?.problem).toBeNull();
  });

  it("uses aria-labelledby before aria-label for landmark names", () => {
    document.body.innerHTML = `
      <h2 id="label">Search tools</h2>
      <form aria-labelledby="label" aria-label="Ignored label">
        <label>Query <input name="q"></label>
      </form>
    `;

    const result = analyzeAccessibility(document);

    expect(result.landmarks[0]).toMatchObject({
      role: "form",
      name: "Search tools"
    });
  });

  it("reports landmark nesting depth", () => {
    document.body.innerHTML = `
      <main>
        <nav aria-label="Inside main">
          <form aria-label="Nested search">
            <label>Query <input name="q"></label>
          </form>
        </nav>
      </main>
    `;

    const result = analyzeAccessibility(document);

    expect(result.landmarks.map((landmark) => [landmark.role, landmark.depth])).toEqual([
      ["main", 0],
      ["navigation", 1],
      ["form", 2]
    ]);
  });

  it("marks content outside landmarks in landmark reading order without adjacent duplicate markers", () => {
    document.body.innerHTML = `
      <p>Intro outside landmarks</p>
      <p>More intro outside landmarks</p>
      <header>Site header</header>
      <p>Between header and main</p>
      <button>Outside action</button>
      <main>Main content</main>
      <footer>Footer content</footer>
      <img alt="Trailing image outside landmarks">
    `;

    const result = analyzeAccessibility(document);

    expect(result.landmarkStructure?.map((item) => item.type === "content" ? item.label : item.role)).toEqual([
      "Content not in a landmark",
      "banner",
      "Content not in a landmark",
      "main",
      "contentinfo",
      "Content not in a landmark"
    ]);
    expect(result.landmarkStructure?.filter((item, index, items) => (
      item.type === "content" && items[index - 1]?.type === "content"
    ))).toEqual([]);
    expect(result.landmarkStructure
      ?.filter((item) => item.type === "content")
      .map((item) => item.elementIds.length)).toEqual([2, 2, 1]);
    expect(result.landmarkStructure
      ?.filter((item) => item.type === "content")
      .map((item) => item.snippets)).toEqual([
        ["Intro outside landmarks", "More intro outside landmarks"],
        ["Between header and main", "Outside action"],
        ["Trailing image outside landmarks"]
      ]);
  });

  it("does not mark content inside landmarks as outside landmark content", () => {
    document.body.innerHTML = `
      <main>
        <h1>Page title</h1>
        <p>Main content</p>
        <nav aria-label="Main navigation">Links</nav>
      </main>
    `;

    const structure = collectLandmarkStructure(document);

    expect(structure.map((item) => item.type === "content" ? item.label : item.role)).toEqual([
      "main",
      "navigation"
    ]);
  });

  it("marks exposed content inside presentational containers outside landmarks", () => {
    document.body.innerHTML = `
      <header>Site header</header>
      <main role="none">
        <h1>Visual main title</h1>
        <p>Body copy outside landmarks</p>
      </main>
      <footer>Footer content</footer>
    `;

    const structure = collectLandmarkStructure(document);

    expect(structure.map((item) => item.type === "content" ? item.label : item.role)).toEqual([
      "banner",
      "Content not in a landmark",
      "contentinfo"
    ]);
    expect(structure.find((item) => item.type === "content")?.elementIds.length).toBe(2);
    expect(structure.find((item) => item.type === "content")?.snippets).toEqual([
      "Visual main title",
      "Body copy outside landmarks"
    ]);
  });

  it("collects exposed semantic content in linear order", () => {
    document.body.innerHTML = `
      <header>Brand</header>
      <main>
        <h1>Page title</h1>
        <noscript><p>Enable JavaScript</p></noscript>
        <a href="/next">Next page</a>
        <button aria-label="Save changes">Save</button>
        <div role="heading" aria-level="3">ARIA section</div>
        <div role="heading" aria-level="invalid">Ignored heading</div>
        <p aria-hidden="true">Hidden text</p>
      </main>
    `;

    const items = collectLinearSemantics(document);

    expect(items.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["banner", "", "Banner"],
      ["text", "", "Brand"],
      ["main", "", "Main"],
      ["heading", "level 1", "Page title"],
      ["link", "", "Next page"],
      ["button", "", "Save changes"],
      ["heading", "level 3", "ARIA section"],
      ["text", "", "Ignored heading"]
    ]);
  });

  it("collects tables with header and data cell roles", () => {
    document.body.innerHTML = `
      <table id="prices">
        <caption>Pricing</caption>
        <thead>
          <tr><th scope="col">Plan</th><th scope="col">Price</th></tr>
        </thead>
        <tbody>
          <tr><th scope="row">Pro</th><td>$20</td></tr>
        </tbody>
      </table>
    `;

    const tables = collectTableItems(document);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      caption: "Pricing",
      rowCount: 2,
      columnCount: 2,
      headerCellCount: 3,
      dataCellCount: 1
    });
    expect(tables[0].cells.map((cell) => [cell.role, cell.text, cell.rowIndex, cell.columnIndex])).toEqual([
      ["columnheader", "Plan", 1, 1],
      ["columnheader", "Price", 1, 2],
      ["rowheader", "Pro", 2, 1],
      ["cell", "$20", 2, 2]
    ]);

    const result = analyzeAccessibility(document);
    expect(result.tables?.[0].caption).toBe("Pricing");
  });

  it("includes open shadow root content in structural scans", () => {
    document.body.innerHTML = `<main><shadow-card></shadow-card></main>`;
    const host = document.querySelector("shadow-card") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <h2 id="shadow-title">Shadow title</h2>
      <button aria-labelledby="shadow-title">Open</button>
    `;

    const result = analyzeAccessibility(document);
    const interactiveItems = collectInteractiveItems(document);

    expect(result.headings.map((heading) => heading.text)).toContain("Shadow title");
    expect(result.headings[0].selector).toContain("::shadow");
    expect(interactiveItems.map((item) => [item.role, item.name])).toContainEqual(["button", "Shadow title"]);
  });

  it("can skip open shadow roots when deep scan settings disable them", () => {
    document.body.innerHTML = `<main><shadow-card></shadow-card></main>`;
    const host = document.querySelector("shadow-card") as HTMLElement;
    host.attachShadow({ mode: "open" }).innerHTML = `<h2>Shadow title</h2>`;

    const result = analyzeAccessibility(document, { includeShadowDom: false });

    expect(result.headings.map((heading) => heading.text)).not.toContain("Shadow title");
  });

  it("guards composed-tree scans against repeated slot assignments", () => {
    document.body.innerHTML = `
      <main>
        <button><slot data-loop="true"></slot></button>
        <p>After slot</p>
      </main>
    `;
    const loopingSlot = document.querySelector("slot") as HTMLSlotElement;
    const originalAssignedNodes = HTMLSlotElement.prototype.assignedNodes;

    HTMLSlotElement.prototype.assignedNodes = function(options?: AssignedNodesOptions) {
      if (this === loopingSlot) {
        return [this];
      }

      return originalAssignedNodes.call(this, options);
    };

    try {
      expect(queryElementsDeep(document, "slot")).toEqual([loopingSlot]);
      expect(collectLandmarkStructure(document).map((item) => item.type)).toContain("landmark");
      expect(collectLinearSemantics(document).map((item) => item.name)).toContain("After slot");
      expect(collectInteractiveItems(document).find((item) => item.role === "button")?.name).toBe("(No accessible name)");
    } finally {
      HTMLSlotElement.prototype.assignedNodes = originalAssignedNodes;
    }
  });

  it("guards accessible-name calculation against very deep aria-labelledby chains", () => {
    document.body.innerHTML = `
      <button aria-labelledby="label-0">Fallback</button>
      <div id="labels"></div>
    `;

    const labels = document.getElementById("labels")!;
    for (let index = 0; index < 180; index += 1) {
      const label = document.createElement("span");
      label.id = `label-${index}`;
      label.setAttribute("aria-labelledby", `label-${index + 1}`);
      labels.append(label);
    }

    const finalLabel = document.createElement("span");
    finalLabel.id = "label-180";
    finalLabel.textContent = "Deep label";
    labels.append(finalLabel);

    expect(() => collectInteractiveItems(document)).not.toThrow();
    expect(collectInteractiveItems(document).find((item) => item.role === "button")?.name).toBe("Fallback");
  });

  it("guards accessible-name calculation against cyclic aria-labelledby references", () => {
    document.body.innerHTML = `
      <button aria-labelledby="label-a">Fallback</button>
      <span id="label-a" aria-labelledby="label-b"></span>
      <span id="label-b" aria-labelledby="label-a">Loop label</span>
    `;

    expect(() => collectInteractiveItems(document)).not.toThrow();
    expect(collectInteractiveItems(document).find((item) => item.role === "button")?.name).toBe("Fallback");
  });

  it("collects keyboard-reachable interactive items and marks assistive technology exposure", () => {
    document.body.innerHTML = `
      <button>First</button>
      <a href="/next" aria-hidden="true">Hidden link</a>
      <button disabled>Disabled</button>
      <div tabindex="2" role="button" aria-label="Priority action"></div>
      <input aria-label="Email">
    `;

    const items = collectInteractiveItems(document);

    expect(items.map((item) => [item.role, item.name, item.exposed])).toEqual([
      ["button", "Priority action", true],
      ["button", "First", true],
      ["link", "", false],
      ["textbox", "Email", true]
    ]);
  });

  it("represents native select controls with label, selected value, and option count", () => {
    document.body.innerHTML = `
      <label>
        Language
        <select>
          <option selected>English</option>
          <option>Dansk</option>
          <option>Norsk</option>
        </select>
      </label>
    `;

    const linearItems = collectLinearSemantics(document);
    const interactiveItems = collectInteractiveItems(document);

    expect(linearItems.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["text", "", "Language"],
      ["combobox", "selected English, collapsed, 3 options", "Language"]
    ]);
    expect(interactiveItems.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["combobox", "selected English, collapsed, 3 options", "Language"]
    ]);
  });

  it("represents native output elements as status semantics", () => {
    document.body.innerHTML = `
      <main>
        <label for="first">First</label>
        <input id="first" type="number" value="2">
        <label for="second">Second</label>
        <input id="second" type="number" value="3">
        <output id="sum" for="first second">5</output>
      </main>
    `;

    const linearItems = collectLinearSemantics(document);

    expect(linearItems.map((item) => [item.role, item.detail, item.name])).toContainEqual([
      "status",
      "",
      "5"
    ]);
  });

  it("does not repeat list item text when nested semantic rows expose it", () => {
    document.body.innerHTML = `
      <ul>
        <li>Plain text item</li>
        <li><a href="/docs">Read docs</a></li>
        <li><span>Wrapped text item</span></li>
        <li>Prefix <button>Save</button></li>
      </ul>
    `;

    const linearItems = collectLinearSemantics(document);

    expect(linearItems.map((item) => [
      item.role,
      item.detail,
      item.name,
      item.listPosition ?? null,
      item.listSize ?? null
    ])).toEqual([
      ["list", "4 items", "List", null, null],
      ["listitem", "", "Plain text item", 1, 4],
      ["listitem", "", "", 2, 4],
      ["link", "", "Read docs", null, null],
      ["listitem", "", "Wrapped text item", 3, 4],
      ["listitem", "", "", 4, 4],
      ["text", "", "Prefix", null, null],
      ["button", "", "Save", null, null]
    ]);
  });

  it("keeps non-semantic inline text together in linear order", () => {
    document.body.innerHTML = `
      <main>
        <p>Onsdag samlede vi <em>mere end 80 deltagere</em> i Allerhuset.</p>
        <p>Læs <a href="/mere">mere</a> om eventet.</p>
        <p>Første linje<br>Anden linje</p>
      </main>
    `;

    const linearItems = collectLinearSemantics(document);

    expect(linearItems.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["main", "", "Main"],
      ["text", "", "Onsdag samlede vi mere end 80 deltagere i Allerhuset."],
      ["text", "", "Læs"],
      ["link", "", "mere"],
      ["text", "", "om eventet."],
      ["text", "", "Første linje"],
      ["text", "", "Anden linje"]
    ]);
  });

  it("shows note-style text for exposed semantic items that are missing accessible text", () => {
    document.body.innerHTML = `
      <main>
        <h2></h2>
        <a href="/empty"></a>
        <button></button>
        <img>
        <label><input type="checkbox"></label>
      </main>
    `;

    const linearItems = collectLinearSemantics(document);

    expect(linearItems.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["main", "", "Main"],
      ["heading", "level 2", "Note: heading is missing text"],
      ["link", "", "Note: missing accessible text"],
      ["button", "", "Note: missing accessible text"],
      ["img", "", "Note: image is missing accessible text"],
      ["checkbox", "not checked", "Note: missing accessible text"]
    ]);
  });

  it("does not expose SVG implementation text as linear page text", () => {
    document.body.innerHTML = `
      <main>
        <svg role="img" aria-label="Logo">
          <style>.a{fill:none}.b{clip-path:url(#a)}.c{fill:#fff}</style>
          <path d="M0 0h10v10z"></path>
        </svg>
      </main>
    `;

    const linearItems = collectLinearSemantics(document);

    expect(linearItems.map((item) => [item.role, item.detail, item.name])).toEqual([
      ["main", "", "Main"],
      ["img", "", "Logo"]
    ]);
  });

  it("collects exposed images, SVGs, figures, and ARIA graphics with accessible names", () => {
    document.body.innerHTML = `
      <img alt="Product screenshot" src="/product.png">
      <img>
      <img alt="" aria-hidden="true">
      <svg aria-hidden="true"><path d="M0 0h10v10z"></path></svg>
      <svg><style>.st0{fill-rule:evenodd;clip-rule:evenodd;}</style><path d="M0 0h10v10z"></path></svg>
      <svg role="img" onclick="alert('x')">
        <title>Trend sparkline</title>
        <script>alert("x")</script>
        <path d="M0 0h10v10z"></path>
      </svg>
      <figure>
        <img alt="">
        <figcaption>Revenue chart</figcaption>
      </figure>
      <div role="graphics-symbol" aria-label="Logo mark"></div>
      <div role="img"></div>
      <div role="button" aria-label="Not a graphic"></div>
    `;

    const items = collectGraphicItems(document);

    expect(items.map((item) => [item.role, item.name, item.source])).toEqual([
      ["img", "Product screenshot", "img"],
      ["img", "", "img"],
      ["img", "", "img"],
      ["img", "", "svg"],
      ["img", "", "svg"],
      ["img", "Trend sparkline", "role=\"img\""],
      ["figure", "Revenue chart", "figure"],
      ["img", "", "img"],
      ["graphics-symbol", "Logo mark", "role=\"graphics-symbol\""],
      ["img", "", "role=\"img\""]
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "named",
      "missing-alt",
      "decorative",
      "decorative",
      "unnamed-img",
      "named",
      "named",
      "decorative",
      "named",
      "unnamed-img"
    ]);
    expect(items.map((item) => item.thumbnailSrc)).toEqual([
      "http://localhost:3000/product.png",
      "",
      "",
      expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
      expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
      expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
      "",
      "",
      "",
      ""
    ]);
    expect(decodeURIComponent(items[5].thumbnailSrc)).not.toContain("<script");
    expect(decodeURIComponent(items[5].thumbnailSrc)).not.toContain("onclick=");
    expect(analyzeAccessibility(document).graphics.filter((item) => item.problem)).toHaveLength(3);
  });

  it("collects exposed ARIA labels but excludes image and graphic items", () => {
    document.body.innerHTML = `
      <button aria-label="Save changes">Save</button>
      <span id="tab-label">Settings</span>
      <div role="tab" aria-labelledby="tab-label"></div>
      <img alt="Product screenshot" aria-label="Ignored image label">
      <svg role="img" aria-label="Ignored SVG label"></svg>
      <figure aria-label="Ignored figure label"></figure>
      <div role="graphics-symbol" aria-label="Ignored graphic label"></div>
      <div aria-hidden="true" aria-label="Hidden label"></div>
      <div role="region" aria-labelledby="missing-label"></div>
    `;

    const items = collectAriaLabelItems(document);

    expect(items.map((item) => [item.role, item.name, item.source])).toEqual([
      ["button", "Save changes", "aria-label"],
      ["tab", "Settings", "aria-labelledby"],
      ["region", "", "aria-labelledby"]
    ]);
    expect(analyzeAccessibility(document).ariaLabels.filter((item) => item.problem)).toHaveLength(1);
  });
});
