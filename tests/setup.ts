import React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

const panelStyles = readFileSync(`${process.cwd()}/src/panel/styles.css`, "utf8");

globalThis.React = React;

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, "CSS", {
    value: {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
    }
  });
}

Object.defineProperty(globalThis, "chrome", {
  value: {
    runtime: {
      onMessage: {
        addListener: () => undefined,
        removeListener: () => undefined
      },
      sendMessage: () => Promise.resolve()
    }
  },
  writable: true
});

beforeEach(() => {
  document.documentElement.lang = "en";
  document.head.innerHTML = `<title>Forward Accessibility Lens</title><style>${panelStyles}</style>`;
  document.body.innerHTML = "";

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        media: "",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
      })
    });
  }
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
