import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

describe("content live region captions", () => {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  afterEach(() => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    delete (globalThis as Record<string, unknown>).__a11yToolsContentVersion;
    delete (globalThis as Record<string, unknown>).__a11yToolsSyncLiveRegions;
    delete (globalThis as Record<string, unknown>).__a11yToolsGetLiveRegionRecords;
    vi.resetModules();
  });

  it("keeps captions enabled when a filter updates a live status and calls history.replaceState", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;
    const sendMessage = vi.fn(() => Promise.resolve());

    globalThis.chrome = {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            contentMessageListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage
      }
    } as unknown as typeof chrome;

    window.history.replaceState({}, "", "/forward-udvidelser/");
    document.body.innerHTML = `
      <label for="software-type">Software type</label>
      <select id="software-type">
        <option value="all">All</option>
        <option value="web-app">Web app</option>
      </select>
      <p id="visible-count">3 extensions shown</p>
      <p
        id="filter-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);"
      >3 extensions shown</p>
      <article data-software-type="web-app">Web app extension</article>
      <article data-software-type="desktop">Desktop extension</article>
      <article data-software-type="desktop">Desktop helper</article>
    `;

    const select = document.getElementById("software-type") as HTMLSelectElement;
    const visibleCount = document.getElementById("visible-count") as HTMLElement;
    const status = document.getElementById("filter-status") as HTMLElement;
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-software-type]"));

    select.addEventListener("change", () => {
      const softwareType = select.value;
      let visible = 0;

      for (const card of cards) {
        const matches = softwareType === "all" || card.dataset.softwareType === softwareType;
        card.hidden = !matches;
        if (matches) {
          visible += 1;
        }
      }

      const message = `${visible} extension shown`;
      visibleCount.textContent = message;
      status.textContent = message;
      window.history.replaceState({}, "", `?software-type=${softwareType}`);
    });

    await import("../src/extension/content.js");

    expect(contentMessageListener).toBeDefined();
    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled: true
    });

    expect(document.getElementById("a11y-tools-live-region-captions")).toBeTruthy();

    select.value = "web-app";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      const overlay = document.getElementById("a11y-tools-live-region-captions");
      expect(overlay).toBeTruthy();
      expect(overlay?.hidden).toBe(false);
      expect(overlay?.textContent).toContain("1 extension shown");
    });
    expect(window.location.pathname).toBe("/forward-udvidelser/");
    expect(window.location.search).toBe("?software-type=web-app");
  });

  it("tracks broadly announced live regions and ignores implicit off roles by default", async () => {
    setupChromeRuntime();

    document.body.innerHTML = `
      <p id="status" role="status">Ready</p>
      <p id="log" role="log">Started</p>
      <p id="alert" role="alert">Problem</p>
      <p id="timer" role="timer">10</p>
      <p id="marquee" role="marquee">Ticker</p>
      <p id="explicit-timer" role="timer" aria-live="polite">9</p>
      <p id="invalid-live" aria-live="true">Invalid</p>
      <output id="sum" for="first second">5</output>
      <output id="silent-output" aria-live="off">Quiet result</output>
    `;

    await import("../src/extension/content.js");
    const records = getLiveRegionRecords();

    expect(records.map((record) => record.selector).sort()).toEqual([
      "#alert",
      "#explicit-timer",
      "#log",
      "#status",
      "#sum"
    ]);
    expect(records.find((record) => record.selector === "#sum")).toMatchObject({
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true"
    });
  });

  it("does not announce text that changed while a live region was hidden from assistive technology", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;
    setupChromeRuntime((listener) => {
      contentMessageListener = listener;
    });

    document.body.innerHTML = `<p id="status" role="status">Ready</p>`;

    await import("../src/extension/content.js");
    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled: true
    });

    const status = document.getElementById("status") as HTMLElement;
    status.setAttribute("aria-hidden", "true");
    status.textContent = "Changed while hidden";
    status.removeAttribute("aria-hidden");

    await waitFor(() => {
      expect(getLiveRegionRecords()[0]?.messages).toEqual([]);
    });

    status.textContent = "Changed while exposed";

    await waitFor(() => {
      expect(getLiveRegionRecords()[0]?.messages[0]?.text).toBe("Changed while exposed");
    });
  });

  it("does not announce existing text when live semantics are added after the fact", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;
    setupChromeRuntime((listener) => {
      contentMessageListener = listener;
    });

    document.body.innerHTML = `<p id="message">Already here</p>`;

    await import("../src/extension/content.js");
    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled: true
    });

    const message = document.getElementById("message") as HTMLElement;
    message.setAttribute("role", "status");

    await waitFor(() => {
      expect(getLiveRegionRecords()[0]?.messages).toEqual([]);
    });

    message.textContent = "New update";

    await waitFor(() => {
      expect(getLiveRegionRecords()[0]?.messages[0]?.text).toBe("New update");
    });
  });

  it("keeps the role alert initial announcement exception for newly inserted alerts", async () => {
    let contentMessageListener: ((message: Record<string, unknown>) => void) | undefined;
    setupChromeRuntime((listener) => {
      contentMessageListener = listener;
    });

    document.body.innerHTML = `<main id="root"></main>`;

    await import("../src/extension/content.js");
    contentMessageListener?.({
      type: "A11Y_TOOLS_SET_LIVE_REGION_CAPTIONS",
      enabled: true
    });

    const alert = document.createElement("p");
    alert.id = "alert";
    alert.setAttribute("role", "alert");
    alert.textContent = "Save failed";
    document.getElementById("root")?.append(alert);

    await waitFor(() => {
      expect(getLiveRegionRecords()[0]?.messages[0]?.text).toBe("Save failed");
    });
  });
});

function setupChromeRuntime(onMessageListener?: (listener: (message: Record<string, unknown>) => void) => void) {
  const sendMessage = vi.fn(() => Promise.resolve());

  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      onMessage: {
        addListener: (listener: (message: Record<string, unknown>) => void) => {
          onMessageListener?.(listener);
        },
        removeListener: () => undefined
      },
      sendMessage
    }
  } as unknown as typeof chrome;

  return sendMessage;
}

function getLiveRegionRecords() {
  const sync = (globalThis as Record<string, unknown>).__a11yToolsSyncLiveRegions as (() => void) | undefined;
  const getRecords = (globalThis as Record<string, unknown>).__a11yToolsGetLiveRegionRecords as (() => Array<{
    selector: string;
    role: string;
    ariaLive: string;
    ariaAtomic: string;
    messages: Array<{ text: string }>;
  }>) | undefined;

  sync?.();
  return getRecords?.() ?? [];
}
