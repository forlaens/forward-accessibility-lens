import { describe, expect, it } from "vitest";
import {
  getPageScopedValue,
  migratePageScopedValue
} from "../src/extension/page-state";

describe("page-scoped extension state", () => {
  it("preserves toggle values across URL-only same-document changes", () => {
    const state = new Map<string, boolean>();
    state.set("12:https://forlaens.com/forward-udvidelser/", true);

    migratePageScopedValue(state, 12, "https://forlaens.com/forward-udvidelser/?software-type=web-app");

    expect(getPageScopedValue(
      state,
      12,
      "https://forlaens.com/forward-udvidelser/?software-type=web-app",
      false
    )).toBe(true);
  });
});
