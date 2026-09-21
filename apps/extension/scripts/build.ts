import { build, loadEnv, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest } from "./manifest";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");
const mode = process.env.NODE_ENV === "development" ? "development" : "production";

const apiUrl = loadEnv(mode, root, "VITE_").VITE_API_URL;
if (!apiUrl) {
  throw new Error("VITE_API_URL is not set. Copy .env.example to .env first.");
}

// Content and background scripts are classic scripts (no ES imports at runtime),
// so each is bundled on its own as a self-contained IIFE.
function scriptConfig(entry: string, name: string): InlineConfig {
  return {
    root,
    configFile: false,
    mode,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: resolve(root, entry), formats: ["iife"], name, fileName: () => `${name}.js` },
    },
  };
}

const pagesConfig: InlineConfig = {
  root,
  configFile: false,
  mode,
  base: "./",
  logLevel: "warn",
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: { popup: resolve(root, "popup.html"), options: resolve(root, "options.html") } },
  },
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build(pagesConfig);
await build(scriptConfig("src/background/index.ts", "background"));
await build(scriptConfig("src/content/index.ts", "content"));

const base = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as Record<string, unknown>;
await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(buildManifest(base, apiUrl), null, 2));
console.info(`Built extension to ${outDir}`);
