import { describe, expect, it } from "vitest";
import { analyzeAccessibility } from "../src/shared/a11y-tree.js";

type HeadingNameCase = {
  name: string;
  html: string;
  expected: string;
};

const headingNameCases: HeadingNameCase[] = [
  {
    name: "plain text content",
    html: `<h1>Page title</h1>`,
    expected: "Page title"
  },
  {
    name: "a linked image text alternative",
    html: `<h1><a href="/"><img alt="Brand"></a></h1>`,
    expected: "Brand"
  },
  {
    name: "mixed text, informative images, and decorative images",
    html: `<h1>Shop <img alt="new"> <span>today</span> <img alt=""></h1>`,
    expected: "Shop new today"
  },
  {
    name: "only a decorative image",
    html: `<h1><img alt=""></h1>`,
    expected: "(Untitled heading)"
  },
  {
    name: "an accessibility-hidden image",
    html: `<h1><img alt="Hidden" aria-hidden="true">Visible</h1>`,
    expected: "Visible"
  },
  {
    name: "aria-label taking precedence over content",
    html: `<h1 aria-label="Author label">Ignored</h1>`,
    expected: "Author label"
  },
  {
    name: "aria-labelledby taking precedence over aria-label and content",
    html: `<h1 aria-labelledby="label" aria-label="Ignored label">Ignored content</h1><span id="label">Referenced label</span>`,
    expected: "Referenced label"
  },
  {
    name: "multiple aria-labelledby references in attribute order",
    html: `<h1 aria-labelledby="second first">Ignored</h1><span id="first">First</span><span id="second">Second</span>`,
    expected: "Second First"
  },
  {
    name: "a valid aria-labelledby reference after a missing reference",
    html: `<h1 aria-labelledby="missing label">Ignored</h1><span id="label">Referenced label</span>`,
    expected: "Referenced label"
  },
  {
    name: "a directly referenced hidden label",
    html: `<h1 aria-labelledby="label">Ignored</h1><span id="label" hidden>Hidden label</span>`,
    expected: "Hidden label"
  },
  {
    name: "the complete subtree of a directly referenced hidden label",
    html: `<h1 aria-labelledby="label">Ignored</h1><span id="label" hidden>Hidden <span aria-hidden="true">included</span></span>`,
    expected: "Hidden included"
  },
  {
    name: "a hidden descendant of a visible referenced label",
    html: `<h1 aria-labelledby="label">Ignored</h1><span id="label">Visible <span hidden>excluded</span></span>`,
    expected: "Visible"
  },
  {
    name: "content taking precedence over title",
    html: `<h1 title="Tooltip">Visible title</h1>`,
    expected: "Visible title"
  },
  {
    name: "title as the final fallback",
    html: `<h1 title="Tooltip"></h1>`,
    expected: "Tooltip"
  },
  {
    name: "content flattened through a presentational descendant",
    html: `<h1><span role="presentation">Flattened title</span></h1>`,
    expected: "Flattened title"
  },
  {
    name: "a descendant aria-label replacing its subtree",
    html: `<h1><span aria-label="Replacement">Ignored</span></h1>`,
    expected: "Replacement"
  },
  {
    name: "a descendant aria-labelledby replacing its subtree",
    html: `<h1><span aria-labelledby="label">Ignored</span></h1><span id="label">Reference</span>`,
    expected: "Reference"
  },
  {
    name: "normalized whitespace",
    html: `<h1>  Hello\n <span> world </span> </h1>`,
    expected: "Hello world"
  },
  {
    name: "non-content script, style, and template descendants",
    html: `<h1>Before<script>bad</script><style>bad</style><template>bad</template>After</h1>`,
    expected: "Before After"
  },
  {
    name: "an inline SVG title",
    html: `<h1><svg><title>Logo</title><path></path></svg></h1>`,
    expected: "Logo"
  },
  {
    name: "an embedded textbox value",
    html: `<h1>Flash <input value="5"> times</h1>`,
    expected: "Flash 5 times"
  },
  {
    name: "an embedded select value",
    html: `<h1>Choose <select><option>One</option><option selected>Two</option></select></h1>`,
    expected: "Choose Two"
  },
  {
    name: "an embedded range aria-valuetext",
    html: `<h1>Volume <input type="range" value="7" aria-valuetext="seven"> level</h1>`,
    expected: "Volume seven level"
  },
  {
    name: "a named descendant button",
    html: `<h1><button aria-label="Save">Ignored</button></h1>`,
    expected: "Save"
  },
  {
    name: "a presentational image whose alt must not contribute",
    html: `<h1><img role="presentation" alt="Ignored">Visible</h1>`,
    expected: "Visible"
  },
  {
    name: "a CSS-hidden descendant",
    html: `<h1>Visible <span style="display:none">Hidden</span></h1>`,
    expected: "Visible"
  },
  {
    name: "an empty aria-label falling back to content",
    html: `<h1 aria-label=" ">Visible</h1>`,
    expected: "Visible"
  },
  {
    name: "an empty aria-labelledby falling back to content",
    html: `<h1 aria-labelledby="">Visible</h1>`,
    expected: "Visible"
  },
  {
    name: "an image title when alt is absent",
    html: `<h1><img title="Tooltip"></h1>`,
    expected: "Tooltip"
  },
  {
    name: "an image aria-label taking precedence over alt",
    html: `<h1><img aria-label="ARIA" alt="Alt"></h1>`,
    expected: "ARIA"
  },
  {
    name: "an image aria-labelledby taking precedence over alt",
    html: `<h1><img aria-labelledby="label" alt="Alt"></h1><span id="label">Reference</span>`,
    expected: "Reference"
  },
  {
    name: "an image input text alternative",
    html: `<h1><input type="image" alt="Search"></h1>`,
    expected: "Search"
  },
  {
    name: "an informative image inside a presentational wrapper",
    html: `<h1><span role="presentation"><img alt="Brand"></span></h1>`,
    expected: "Brand"
  },
  {
    name: "a repeated aria-labelledby reference",
    html: `<h1 aria-labelledby="label label">Ignored</h1><span id="label">Label</span>`,
    expected: "Label Label"
  },
  {
    name: "a self-referencing aria-labelledby",
    html: `<h1 id="heading" aria-labelledby="heading">Self text</h1>`,
    expected: "Self text"
  },
  {
    name: "an embedded textarea value",
    html: `<h1>Message <textarea>Initial</textarea> end</h1>`,
    expected: "Message Initial end"
  },
  {
    name: "an embedded contenteditable textbox value",
    html: `<h1>Count <span role="textbox" contenteditable>4</span> end</h1>`,
    expected: "Count 4 end"
  },
  {
    name: "an embedded ARIA slider value",
    html: `<h1>Level <span role="slider" aria-valuenow="4" aria-valuetext="four"></span> end</h1>`,
    expected: "Level four end"
  },
  {
    name: "a referenced label inside a hidden ancestor",
    html: `<h1 aria-labelledby="label">Fallback</h1><div hidden><span id="label">Ancestor hidden</span></div>`,
    expected: "Ancestor hidden"
  },
  {
    name: "adjacent inline descendants without authored whitespace",
    html: `<h1><span>Alpha</span><span>Beta</span></h1>`,
    expected: "AlphaBeta"
  },
  {
    name: "authored whitespace between inline descendants",
    html: `<h1><span>Alpha </span><span>Beta</span></h1>`,
    expected: "Alpha Beta"
  },
  {
    name: "block descendants separated by an accessible-name boundary",
    html: `<h1><div>Alpha</div><div>Beta</div></h1>`,
    expected: "Alpha Beta"
  },
  {
    name: "a line break represented as whitespace",
    html: `<h1>Alpha<br>Beta</h1>`,
    expected: "Alpha Beta"
  },
  {
    name: "a referenced descendant not counted again in DOM order",
    html: `<h1><span aria-labelledby="label">Ignored</span><i id="label">Reference</i></h1>`,
    expected: "Reference"
  },
  {
    name: "hidden inline content removed without inventing whitespace",
    html: `<h1>Alpha<span hidden>Hidden</span>Beta</h1>`,
    expected: "AlphaBeta"
  }
];

describe("heading accessible-name matrix", () => {
  it.each(headingNameCases)("computes $name", ({ html, expected }) => {
    document.body.innerHTML = html;

    expect(analyzeAccessibility(document).headings[0]?.text).toBe(expected);
  });

  it("does not include headings excluded from the accessibility tree", () => {
    document.body.innerHTML = `
      <h1 hidden>Hidden attribute</h1>
      <h2 aria-hidden="true">ARIA hidden</h2>
      <h3 style="display:none">Display none</h3>
      <h4 inert>Inert</h4>
      <h5 role="presentation">Presentational</h5>
    `;

    expect(analyzeAccessibility(document).headings).toEqual([]);
  });
});
