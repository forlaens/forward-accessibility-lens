import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener<T extends unknown[] = unknown[]> = (...args: T) => void;

function createEvent<T extends unknown[] = unknown[]>() {
  const listeners: Listener<T>[] = [];

  return {
    addListener: (listener: Listener<T>) => {
      listeners.push(listener);
    },
    fire: (...args: T) => {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  };
}

function createPort(name: string) {
  const disconnectListeners: Array<() => void> = [];

  return {
    name,
    onMessage: createEvent<[Record<string, unknown>]>(),
    onDisconnect: {
      addListener: (listener: () => void) => {
        disconnectListeners.push(listener);
      }
    },
    postMessage: vi.fn(),
    disconnect: () => {
      for (const listener of disconnectListeners) {
        listener();
      }
    }
  };
}

function createChromeMock(url = "https://example.com/") {
  const onConnect = createEvent<[ReturnType<typeof createPort>]>();
  const onActivated = createEvent<[]>();
  const onUpdated = createEvent<[number, chrome.tabs.TabChangeInfo, chrome.tabs.Tab]>();
  const onRemoved = createEvent<[number]>();
  const onFocusChanged = createEvent<[number]>();

  const chromeMock = {
    runtime: {
      onInstalled: createEvent<[]>(),
      onMessage: createEvent<[Record<string, unknown>, chrome.runtime.MessageSender]>(),
      onConnect,
      sendMessage: vi.fn(() => Promise.resolve())
    },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve())
    },
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve())
      }
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 10, url, active: true, status: "complete" }])),
      sendMessage: vi.fn(() => Promise.resolve()),
      get: vi.fn((_tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        callback({ id: 10, url } as chrome.tabs.Tab);
      }),
      onActivated,
      onUpdated,
      onRemoved
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged
    },
    webNavigation: {
      getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0, parentFrameId: -1, url }]))
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ frameId: 0, result: undefined }]))
    }
  };

  return chromeMock;
}

async function loadBackground(chromeMock: ReturnType<typeof createChromeMock>) {
  vi.resetModules();
  globalThis.chrome = chromeMock as unknown as typeof chrome;
  await import("../src/extension/background.js");
}

async function waitForAsyncListeners() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("background lazy scanning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not inject the content script on passive browser events before the panel opens", async () => {
    const chromeMock = createChromeMock();
    await loadBackground(chromeMock);

    chromeMock.tabs.onActivated.fire();
    chromeMock.tabs.onUpdated.fire(10, { status: "complete" }, {
      id: 10,
      url: "https://example.com/",
      active: true,
      status: "complete"
    } as chrome.tabs.Tab);
    chromeMock.windows.onFocusChanged.fire(1);
    await waitForAsyncListeners();

    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("only asks for active-tab context from browser events while the side panel is connected", async () => {
    const chromeMock = createChromeMock("chrome://newtab/");
    await loadBackground(chromeMock);

    const panelPort = createPort("a11y-tools-panel");
    chromeMock.runtime.onConnect.fire(panelPort);

    chromeMock.tabs.onActivated.fire();
    await waitForAsyncListeners();

    expect(chromeMock.tabs.query).toHaveBeenCalledTimes(1);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();

    panelPort.disconnect();
    vi.clearAllMocks();

    chromeMock.windows.onFocusChanged.fire(1);
    await waitForAsyncListeners();

    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
});
