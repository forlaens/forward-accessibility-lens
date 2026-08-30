import { describe, expect, it } from "vitest";
import { computeAccessibleName } from "../src/shared/a11y-tree.js";

describe("accessible-name algorithm", () => {
  it("uses an image title only when alt is absent", () => {
    document.body.innerHTML = `
      <img id="title-only" title="Tooltip">
      <img id="empty-alt" alt="" title="Ignored tooltip">
    `;

    expect(computeAccessibleName(document.getElementById("title-only"))).toBe("Tooltip");
    expect(computeAccessibleName(document.getElementById("empty-alt"))).toBe("");
  });

  it("includes native image alternatives in form labels", () => {
    document.body.innerHTML = `
      <label for="email"><img alt="Email address"></label>
      <input id="email">
    `;

    expect(computeAccessibleName(document.getElementById("email"))).toBe("Email address");
  });

  it("flattens presentational descendants in form labels", () => {
    document.body.innerHTML = `
      <label for="email"><span role="presentation">Email address</span></label>
      <input id="email">
    `;

    expect(computeAccessibleName(document.getElementById("email"))).toBe("Email address");
  });

  it("excludes the labelled control from its own wrapping label", () => {
    document.body.innerHTML = `
      <label>Email address <input id="email" value="must not repeat"></label>
    `;

    expect(computeAccessibleName(document.getElementById("email"))).toBe("Email address");
  });
});
