import { expect, it } from "vitest";
import axe from "axe-core";
import { render } from "@testing-library/react";
import { App } from "../src/panel/main";

const strictAxeTags = [
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag21aaa",
  "wcag22a",
  "wcag22aa",
  "wcag22aaa",
  "best-practice"
];

it("has no axe-core violations, including AAA and best-practice rules", async () => {
  render(<App />);

  const results = await axe.run(document, {
    runOnly: {
      type: "tag",
      values: strictAxeTags
    }
  });

  expect(formatAxeViolations(results.violations)).toEqual([]);
});

function formatAxeViolations(violations: axe.Result[]) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" "))
  }));
}
