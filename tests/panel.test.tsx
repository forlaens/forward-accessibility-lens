import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/panel/main";

describe("panel structure lists", () => {
  it("shows text resize WCAG guidance and sends the selected simulation", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;
    const sendMessage = vi.fn(() => Promise.resolve());

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "textResize",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
    });

    expect(await screen.findByText("WCAG 1.4.4 Resize Text (AA)")).toBeTruthy();
    expect(screen.getByText("200% WCAG AA")).toBeTruthy();
    expect(screen.getByText("Raise it to 400% to expose fragile spacing, fixed-height components, and cramped controls.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "400%" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Text resize simulator" }));

    expect(sendMessage).toHaveBeenCalledWith({
      type: "A11Y_TOOLS_SET_TEXT_RESIZE_SIMULATION",
      textResizeSimulation: {
        enabled: true,
        scale: 400
      }
    });
  });

  it("does not show the landmark role as the accessible name fallback", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "landmarks",
              language: "da"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [],
          landmarks: [
            {
              type: "landmark",
              id: "main",
              role: "main",
              name: "",
              label: "Main",
              source: "<main>",
              depth: 0,
              selector: "main",
              problem: null
            },
            {
              type: "landmark",
              id: "nested-main",
              role: "main",
              name: "",
              label: "Main",
              source: "role=\"main\"",
              depth: 1,
              selector: "main [role='main']",
              problem: null
            }
          ],
          landmarkStructure: [
            {
              type: "landmark",
              id: "main",
              role: "main",
              name: "",
              label: "Main",
              source: "<main>",
              depth: 0,
              selector: "main",
              problem: null
            },
            {
              type: "landmark",
              id: "nested-main",
              role: "main",
              name: "",
              label: "Main",
              source: "role=\"main\"",
              depth: 1,
              selector: "main [role='main']",
              problem: null
            }
          ],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findAllByText("Rolle")).toHaveLength(2);
    expect(screen.getAllByText("Navn")).toHaveLength(2);
    expect(screen.getAllByText("Intet tilgængeligt navn")).toHaveLength(2);
    expect(screen.queryByText("Main")).toBeNull();
    expect(screen.getAllByText("main")[1].closest("li")?.style.marginInlineStart).toBe("32px");
  });

  it("indents the whole heading card by heading level", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "headings",
              language: "da"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [
            {
              id: "overview",
              level: 1,
              role: "heading",
              text: "Overblik",
              source: "<h1>",
              selector: "h1",
              problem: null
            },
            {
              id: "cases",
              level: 2,
              role: "heading",
              text: "Dine seneste sager",
              source: "<h2>",
              selector: "h2",
              problem: null
            },
            {
              id: "year",
              level: 3,
              role: "heading",
              text: "2026",
              source: "<h3>",
              selector: "h3",
              problem: null
            }
          ],
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Overblik")).toBeTruthy();
    expect(screen.getByText("H1").closest("li")?.style.marginInlineStart).toBe("0px");
    expect(screen.getByText("H2").closest("li")?.style.marginInlineStart).toBe("32px");
    expect(screen.getByText("H3").closest("li")?.style.marginInlineStart).toBe("64px");
    expect(screen.getByText("<h2>")).toBeTruthy();
  });

  it("keeps the current list page when switching browser tabs and back", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;
    const makeHeadings = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => {
      const number = index + 1;

      return {
        id: `${prefix}-${number}`,
        level: 1,
        role: "heading",
        text: `${prefix} heading ${number}`,
        source: "<h1>",
        selector: `h1:nth-of-type(${number})`,
        problem: null
      };
    });

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "headings",
              language: "en",
              resultsPerPage: 5
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test/one",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test/one",
        analysis: {
          headings: makeHeadings("Tab one", 8),
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Tab one heading 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show next page of results" }));

    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByText("Tab one heading 6")).toBeTruthy();

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 2,
        url: "https://example.test/two",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 2,
        url: "https://example.test/two",
        analysis: {
          headings: makeHeadings("Tab two", 2),
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Tab two heading 1")).toBeTruthy();
    expect(screen.queryByText("Page 2 of 2")).toBeNull();

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test/one",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test/one",
        analysis: {
          headings: makeHeadings("Tab one", 8),
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Tab one heading 6")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("keeps scan results when they arrive before the active tab context", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "headings",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [
            {
              id: "chat",
              level: 1,
              role: "heading",
              text: "Chat",
              source: "<h1>",
              selector: "h1",
              problem: null
            }
          ],
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
    });

    expect(await screen.findByText("Chat")).toBeTruthy();
    expect(screen.queryByText("Scanning page structure")).toBeNull();
  });

  it("shows frame-level scan progress and scan problems", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;
    const sendMessage = vi.fn(() => Promise.resolve());

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "headings",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_SCAN_PROGRESS",
        tabId: 1,
        url: "https://example.test",
        progress: {
          scanId: 9,
          phase: "scanningFrames",
          completedFrames: 1,
          successfulFrames: 1,
          failedFrames: 0,
          totalFrames: 3,
          includeIframes: true,
          includeShadowDom: true,
          problems: [
            {
              code: "frameTimeout",
              frameId: 7,
              canReveal: true
            }
          ]
        }
      });
    });

    expect(await screen.findAllByText("Scanned 1 of 3 frames")).toHaveLength(2);
    expect(screen.getByText("1 scanned, 0 skipped, 3 total. Open shadow roots are included.")).toBeTruthy();
    expect(screen.getByText("Frame 7: The frame did not finish before the timeout.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show iframe" }));
    expect(sendMessage).toHaveBeenCalledWith({
      type: "A11Y_TOOLS_REVEAL_FRAME",
      frameId: 7
    });

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        scanId: 9,
        analysis: {
          headings: [],
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_SCAN_PROGRESS",
        tabId: 1,
        url: "https://example.test",
        progress: {
          scanId: 9,
          phase: "complete",
          completedFrames: 3,
          successfulFrames: 2,
          failedFrames: 1,
          totalFrames: 3,
          includeIframes: true,
          includeShadowDom: true,
          problems: [
            {
              code: "frameTimeout",
              frameId: 7,
              canReveal: true
            }
          ]
        }
      });
    });

    expect(await screen.findAllByText("1 scan problem")).toHaveLength(2);
    expect(screen.getByText("No exposed headings found")).toBeTruthy();
  });

  it("shows available heading results while frame scanning continues", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "headings",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_SCAN_PROGRESS",
        tabId: 1,
        url: "https://example.test",
        progress: {
          scanId: 12,
          phase: "scanningFrames",
          completedFrames: 1,
          successfulFrames: 1,
          failedFrames: 0,
          totalFrames: 2,
          includeIframes: true,
          includeShadowDom: true,
          problems: []
        }
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        scanId: 12,
        analysis: {
          headings: [
            {
              id: "overview",
              level: 1,
              role: "heading",
              text: "Overview",
              source: "<h1>",
              selector: "h1",
              problem: null
            }
          ],
          landmarks: [],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Overview")).toBeTruthy();
    expect(screen.queryByText("Scanning page structure")).toBeNull();
  });

  it("relocalizes scan problem status after the language preference loads", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;
    let resolvePreferences: (value: Record<string, unknown>) => void = () => undefined;
    const preferencesPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolvePreferences = resolve;
    });
    const languagesSpy = vi.spyOn(globalThis.navigator, "languages", "get").mockReturnValue(["da-DK"]);

    try {
      globalThis.chrome = {
        runtime: {
          onMessage: {
            addListener: (listener: (message: Record<string, unknown>) => void) => {
              runtimeListener = listener;
            },
            removeListener: () => undefined
          },
          sendMessage: () => Promise.resolve()
        },
        storage: {
          local: {
            get: () => preferencesPromise,
            set: () => Promise.resolve()
          }
        }
      } as typeof chrome;

      render(<App />);

      await waitFor(() => expect(runtimeListener).toBeDefined());

      act(() => {
        runtimeListener?.({
          type: "A11Y_TOOLS_ACTIVE_TAB",
          tabId: 1,
          url: "https://example.test",
          status: "Scanning page"
        });
        runtimeListener?.({
          type: "A11Y_TOOLS_SCAN_PROGRESS",
          tabId: 1,
          url: "https://example.test",
          progress: {
            scanId: 9,
            phase: "complete",
            completedFrames: 1,
            successfulFrames: 0,
            failedFrames: 1,
            totalFrames: 1,
            includeIframes: true,
            includeShadowDom: true,
            problems: [
              {
                code: "frameAnalysisFailed",
                frameId: 0,
                detail: "Maximum call stack size exceeded"
              }
            ]
          }
        });
      });

      expect(await screen.findAllByText("1 problem med gennemgangen")).toHaveLength(2);

      await act(async () => {
        resolvePreferences({
          panelPreferences: {
            activeTool: "headings",
            language: "en"
          }
        });
        await preferencesPromise;
      });

      await waitFor(() => expect(screen.getAllByText("1 scan problem")).toHaveLength(2));
      expect(screen.queryByText("1 problem med gennemgangen")).toBeNull();
    } finally {
      languagesSpy.mockRestore();
    }
  });

  it("shows a content preview for landmark gaps", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "landmarks",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [],
          landmarks: [],
          landmarkStructure: [
            {
              type: "content",
              id: "content-not-in-landmark-1",
              label: "Content not in a landmark",
              depth: 0,
              elementIds: ["intro", "cta"],
              snippets: ["Intro outside landmarks", "Outside action"],
              problem: "Content is outside landmarks. Place meaningful page content inside a landmark so users can navigate to it."
            }
          ],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("Content not in a landmark")).toBeTruthy();
    expect(screen.getByText("Includes: “Intro outside landmarks” and “Outside action”")).toBeTruthy();
  });

  it("keeps the graphics tool visible when all filters are unchecked", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "graphics",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [],
          landmarks: [],
          graphics: [
            {
              id: "logo",
              role: "img",
              name: "Logo",
              status: "named",
              source: "img",
              thumbnailSrc: "",
              selector: "img",
              problem: null
            },
            {
              id: "decorative",
              role: "img",
              name: "",
              status: "decorative",
              source: "img",
              thumbnailSrc: "",
              selector: "img[alt='']",
              problem: null
            },
            {
              id: "missing",
              role: "img",
              name: "",
              status: "missing-alt",
              source: "img",
              thumbnailSrc: "",
              selector: "img:not([alt])",
              problem: "Missing alt attribute. Add alt text for informative images, or use alt=\"\" only when the image is decorative or redundant."
            }
          ],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findAllByText("(1)")).toHaveLength(3);

    fireEvent.click(screen.getByRole("checkbox", { name: /Has text alternative.*1 item/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Marked decorative.*1 item/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Missing text alternative.*1 item/ }));

    expect(screen.getByText("No images match the current filters")).toBeTruthy();
    expect(screen.queryByText("Logo")).toBeNull();
    expect(screen.queryByText("Status: marked as decorative")).toBeNull();
    expect(screen.queryByText("Missing text alternative")).toBeTruthy();
    expect(screen.queryByText("Copy list")).toBeNull();
  });

  it("flags unnamed non-decorative graphics as issues even without a problem payload", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "graphics",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://example.test",
        status: "Scanning page"
      });
      runtimeListener?.({
        type: "A11Y_TOOLS_PANEL_UPDATE",
        tabId: 1,
        url: "https://example.test",
        analysis: {
          headings: [],
          landmarks: [],
          graphics: [
            {
              id: "svg-icon",
              role: "img",
              name: "",
              status: "named",
              source: "svg",
              thumbnailSrc: "",
              selector: "svg",
              problem: null
            }
          ],
          updatedAt: new Date().toISOString()
        }
      });
    });

    expect(await screen.findByText("No accessible name")).toBeTruthy();
    expect(screen.getByText("Missing accessible name")).toBeTruthy();
    expect(screen.getByText("No accessible name found. This is only appropriate when the graphic is decorative or redundant.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /svg.*No accessible name.*Missing accessible name.*Show/i }).closest("li")?.className).toContain("has-problem");
  });

  it("keeps the settings button in the header grid flow", async () => {
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: () => undefined,
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "graphics",
              language: "da"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    const settingsButton = await screen.findByLabelText("Åbn indstillinger");

    expect(getComputedStyle(settingsButton).position).not.toBe("absolute");
    expect(getComputedStyle(settingsButton.closest(".app-header") as Element).gridTemplateColumns).not.toBe("minmax(0, 1fr)");
  });

  it("checks contrast from manually selected colors", async () => {
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: () => undefined,
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "contrast",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    expect(await screen.findByText("Color contrast checker")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Text color"), {
      target: { value: "#000000" }
    });
    fireEvent.change(screen.getByLabelText("Background color"), {
      target: { value: "#ffffff" }
    });

    expect(screen.getByText("21:1")).toBeTruthy();
    expect(screen.getAllByText("Pass")).toHaveLength(4);
    expect(screen.getByText("Passes all listed levels.")).toBeTruthy();
    expect(screen.getAllByText("Requires 4.5:1")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Reverse colors" }));
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#ffffff");
    expect((screen.getByLabelText("Background color hex value") as HTMLInputElement).value).toBe("#000000");

    fireEvent.click(screen.getByRole("button", { name: "Reverse colors" }));
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#000000");
    expect((screen.getByLabelText("Background color hex value") as HTMLInputElement).value).toBe("#ffffff");

    fireEvent.change(screen.getByLabelText("Text color hex value"), {
      target: { value: "#" }
    });
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#");

    fireEvent.change(screen.getByLabelText("Text color hex value"), {
      target: { value: " F F F " }
    });
    fireEvent.blur(screen.getByLabelText("Text color hex value"));
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#FFFFFF");

    fireEvent.paste(screen.getByLabelText("Background color hex value"), {
      clipboardData: { getData: () => "rgb(0, 0, 0)" }
    });
    expect((screen.getByLabelText("Background color hex value") as HTMLInputElement).value).toBe("#000000");
    expect(screen.getByText("21:1")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Text color hex value"), {
      target: { value: "fff" }
    });
    fireEvent.keyDown(screen.getByLabelText("Text color hex value"), { key: "Enter" });
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#ffffff");

    fireEvent.change(screen.getByLabelText("Text color hex value"), {
      target: { value: "rebeccapurple" }
    });
    fireEvent.blur(screen.getByLabelText("Text color hex value"));
    expect((screen.getByLabelText("Text color hex value") as HTMLInputElement).value).toBe("#663399");

    fireEvent.change(screen.getByLabelText("Background color hex value"), {
      target: { value: "not a color" }
    });
    fireEvent.blur(screen.getByLabelText("Background color hex value"));
    expect((screen.getByLabelText("Background color hex value") as HTMLInputElement).value).toBe("#000000");
    expect(screen.getByText(/Does not pass:/)).toBeTruthy();
    expect(screen.getAllByText("Fail")).toHaveLength(4);
  });

  it("keeps live region captions enabled when the active tab URL changes", async () => {
    let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (listener: (message: Record<string, unknown>) => void) => {
            runtimeListener = listener;
          },
          removeListener: () => undefined
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: () => Promise.resolve({
            panelPreferences: {
              activeTool: "liveRegions",
              language: "en"
            }
          }),
          set: () => Promise.resolve()
        }
      }
    } as typeof chrome;

    render(<App />);

    await waitFor(() => expect(runtimeListener).toBeDefined());

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://forlaens.com/forward-udvidelser/",
        liveRegionCaptionsEnabled: true,
        status: "Scanning page"
      });
    });

    const captionsToggle = await screen.findByRole("checkbox", { name: "Live region captions" });
    expect((captionsToggle as HTMLInputElement).checked).toBe(true);

    act(() => {
      runtimeListener?.({
        type: "A11Y_TOOLS_ACTIVE_TAB",
        tabId: 1,
        url: "https://forlaens.com/forward-udvidelser/?software-type=web-app",
        liveRegionCaptionsEnabled: true,
        status: "Scanning page"
      });
    });

    expect((captionsToggle as HTMLInputElement).checked).toBe(true);
  });
});
