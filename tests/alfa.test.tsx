import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import rules from "@siteimprove/alfa-rules";
import { Audit, Outcome } from "@siteimprove/alfa-act";
import { Native } from "@siteimprove/alfa-web/native";
import { Page } from "@siteimprove/alfa-web";
import { App } from "../src/panel/main";

it("has no Siteimprove Alfa accessibility failures", async () => {
  render(<App />);

  const pageJson = await Native.fromDocument(document);
  const page = Page.from(pageJson).getUnsafe("Unable to create Alfa page from document");
  const outcomes = await Audit.of(page, rules).evaluate().toPromise();
  const failures = Array.from(outcomes).filter((outcome) => {
    if (outcome.outcome !== Outcome.Value.Failed) {
      return false;
    }

    const json = outcome.toJSON() as { rule: { uri: string } };
    return json.rule.uri !== "https://alfa.siteimprove.com/rules/sia-r87";
  });

  expect(formatAlfaFailures(failures)).toEqual([]);
});

function formatAlfaFailures(outcomes: Array<Outcome<any, any, any, any>>) {
  return outcomes.map((outcome) => {
    const json = outcome.toJSON() as {
      rule: { uri: string; requirements?: Array<{ type: string; uri: string }> };
      target?: { type: string; name?: string };
      expectations?: Array<[string, { error?: { message?: string } }]>;
    };

    return {
      rule: json.rule.uri,
      requirements: json.rule.requirements?.map((requirement) => `${requirement.type}: ${requirement.uri}`) ?? [],
      target: json.target?.name ?? json.target?.type,
      text: "data" in (json.target ?? {}) ? (json.target as { data?: string }).data : undefined,
      messages: json.expectations?.map(([, result]) => result.error?.message).filter(Boolean) ?? []
    };
  });
}
