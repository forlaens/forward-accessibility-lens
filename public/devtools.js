const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: "a11y-tools-devtools" });

port.postMessage({
  type: "A11Y_TOOLS_DEVTOOLS_OPEN",
  tabId
});

port.onMessage.addListener((message) => {
  if (
    message?.type !== "A11Y_TOOLS_DEVTOOLS_INSPECT_ELEMENT" &&
    message?.type !== "A11Y_TOOLS_DEVTOOLS_INSPECT_SELECTOR"
  ) {
    return;
  }

  const elementId = typeof message.elementId === "string" ? message.elementId : "";
  const selector = typeof message.selector === "string" ? message.selector : "";

  if (!elementId && !selector) {
    return;
  }

  const expression = `
    (function () {
      function walkDeep(root, callback) {
        if (!root) return null;
        const visit = (node) => {
          const result = callback(node);
          if (result) return result;

          if (node instanceof Element && node.shadowRoot) {
            const shadowResult = visit(node.shadowRoot);
            if (shadowResult) return shadowResult;
          }

          for (const child of node.childNodes || []) {
            const childResult = visit(child);
            if (childResult) return childResult;
          }

          return null;
        };

        return visit(root);
      }

      const element = ${elementId
        ? `walkDeep(document, (node) => node instanceof Element && node.id === ${JSON.stringify(elementId)} ? node : null)`
        : `walkDeep(document, (node) => node instanceof Element && node.matches(${JSON.stringify(selector)}) ? node : null)`};
      if (!element) {
        return false;
      }
      inspect(element);
      return true;
    })();
  `;

  chrome.devtools.inspectedWindow.eval(expression, { useContentScriptContext: false });
});
