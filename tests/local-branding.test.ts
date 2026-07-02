import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("local extension branding", () => {
  it("keeps the local development icon in the local manifest", async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), "forward-local-branding-"));
    const manifestPath = resolve(workdir, "manifest.json");

    await writeFile(manifestPath, JSON.stringify({
      name: "Forward • Accessibility Lens",
      action: {
        default_title: "Forward • Accessibility Lens",
        default_icon: {
          "16": "icons/icon-16.png",
          "32": "icons/icon-32.png",
          "48": "icons/icon-48.png",
          "128": "icons/icon-128.png"
        }
      },
      icons: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png"
      }
    }, null, 2));

    await execFileAsync("node", [
      resolve(root, "scripts/apply-local-extension-branding.js"),
      "--manifest",
      manifestPath,
      "--icons-dir",
      resolve(workdir, "icons")
    ]);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest.name).toBe("Forward • Accessibility Lens (Local)");
    expect(manifest.action.default_title).toBe("Forward • Accessibility Lens (Local)");
    expect(manifest.action.default_icon).toEqual({
      "16": "icons/local-icon-16.png",
      "32": "icons/local-icon-32.png",
      "48": "icons/local-icon-48.png",
      "128": "icons/local-icon-128.png"
    });
    expect(manifest.icons).toEqual(manifest.action.default_icon);
  });
});
