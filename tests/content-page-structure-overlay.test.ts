import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

describe("content page structure overlay", () => {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  afterEach(() => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    delete (globalThis as Record<string, unknown>).__a11yToolsContentVersion;
    vi.resetModules();
  });

  it("keeps heading labels visibly styled when labels render in their own overlay layer", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            contentMessageListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: vi.fn(() => Promise.resolve())
      }
    } as unknown as typeof chrome;

    document.body.innerHTML = `<h1 id="page-title">Visible heading</h1>`;

    const heading = document.getElementById("page-title") as HTMLElement;
    heading.getBoundingClientRect = () => ({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 320,
      bottom: 90,
      width: 300,
      height: 60,
      toJSON: () => ({})
    } as DOMRect);

    await import("../src/extension/content.js");

    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: { headings: true }
    });

    await waitFor(() => {
      const label = document.querySelector(".a11y-tools-page-structure-marker__label");
      const style = document.getElementById("a11y-tools-page-structure-overlay-style");

      expect(label).toBeTruthy();
      expect(label?.textContent).toBe("H1");
      expect(label?.classList.contains("a11y-tools-page-structure-marker__label--heading")).toBe(true);
      expect(style?.textContent).toContain("--a11y-tools-marker-color: #005fcc");
    });
  });

  it("labels table header and data cells in the page outline", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            contentMessageListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: vi.fn(() => Promise.resolve())
      }
    } as unknown as typeof chrome;

    document.body.innerHTML = `
      <table id="schedule">
        <caption>Schedule</caption>
        <tr><th>Time</th><td>10:00</td></tr>
      </table>
    `;

    const table = document.getElementById("schedule") as HTMLElement;
    const header = document.querySelector("th") as HTMLElement;
    const cell = document.querySelector("td") as HTMLElement;
    table.getBoundingClientRect = () => ({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 420,
      bottom: 180,
      width: 400,
      height: 150,
      toJSON: () => ({})
    } as DOMRect);
    header.getBoundingClientRect = () => ({
      x: 30,
      y: 80,
      left: 30,
      top: 80,
      right: 180,
      bottom: 120,
      width: 150,
      height: 40,
      toJSON: () => ({})
    } as DOMRect);
    cell.getBoundingClientRect = () => ({
      x: 180,
      y: 80,
      left: 180,
      top: 80,
      right: 330,
      bottom: 120,
      width: 150,
      height: 40,
      toJSON: () => ({})
    } as DOMRect);

    await import("../src/extension/content.js");

    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
      overlay: { tables: true }
    });

    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll(".a11y-tools-page-structure-marker__label"))
        .map((label) => label.textContent);

      expect(labels).toContain("Schedule");
      expect(labels).toContain("TH");
      expect(labels).toContain("TD");
    });
  });

  it("keeps large landmark labels attached to the visible landmark box", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    globalThis.chrome = {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            contentMessageListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: vi.fn(() => Promise.resolve())
      }
    } as unknown as typeof chrome;

    document.body.innerHTML = `<main id="main">Page content</main>`;

    const main = document.getElementById("main") as HTMLElement;
    main.getBoundingClientRect = () => ({
      x: 0,
      y: -220,
      left: 0,
      top: -220,
      right: 900,
      bottom: 620,
      width: 900,
      height: 840,
      toJSON: () => ({})
    } as DOMRect);

    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList?.contains("a11y-tools-page-structure-marker")) {
        const element = this as HTMLElement;
        const left = Number.parseFloat(element.style.left) || 0;
        const top = Number.parseFloat(element.style.top) || 0;
        const width = Number.parseFloat(element.style.width) || 0;
        const height = Number.parseFloat(element.style.height) || 0;

        return {
          x: left,
          y: top,
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
          toJSON: () => ({})
        } as DOMRect;
      }

      if (this.classList?.contains("a11y-tools-page-structure-marker__label")) {
        const element = this as HTMLElement;
        const left = Number.parseFloat(element.style.left) || 0;
        const top = Number.parseFloat(element.style.top) || 0;

        return {
          x: left,
          y: top,
          left,
          top,
          right: left + 92,
          bottom: top + 27,
          width: 92,
          height: 27,
          toJSON: () => ({})
        } as DOMRect;
      }

      return originalGetBoundingClientRect.call(this);
    };

    try {
      await import("../src/extension/content.js");

      contentMessageListener?.({
        type: "A11Y_TOOLS_SET_PAGE_STRUCTURE_OVERLAY",
        overlay: { landmarks: true }
      });

      await waitFor(() => {
        const label = document.querySelector(".a11y-tools-page-structure-marker__label") as HTMLElement | null;

        expect(label).toBeTruthy();
        expect(label?.textContent).toBe("main");
        expect(label?.style.top).toBe("9px");
      });
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("applies and restores text resize simulation", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            contentMessageListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: vi.fn(() => Promise.resolve())
      }
    } as unknown as typeof chrome;

    document.body.innerHTML = `<main><p id="intro" style="font-size: 10px">Readable content</p></main>`;

    await import("../src/extension/content.js");

    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: {
        enabled: true,
        scale: 400
      }
    });

    const intro = document.getElementById("intro") as HTMLElement;

    await waitFor(() => {
      expect(intro.style.getPropertyValue("font-size")).toBe("40px");
      expect(intro.style.getPropertyPriority("font-size")).toBe("important");
      expect(document.getElementById("a11y-tools-text-resize-badge")?.textContent).toBe("Text resize 400% - stress test");
    });

    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: {
        enabled: false,
        scale: 400
      }
    });

    await waitFor(() => {
      expect(intro.style.getPropertyValue("font-size")).toBe("10px");
      expect(intro.style.getPropertyPriority("font-size")).toBe("");
      expect(document.getElementById("a11y-tools-text-resize-badge")).toBeNull();
    });
  });
});
