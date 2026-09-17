import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// GitHub Pages serves files only: no Node.js runtime, no routes, no database.
// `next build` with `output: "export"` writes the whole app to `out/`, which is
// exactly what the project needs because all Gemini work happens in the browser.
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const outDir = fileURLToPath(new URL("../out/", import.meta.url));
const basePath = (process.env.HAMAVA_BASE_PATH ?? "").replace(/\/+$/, "");

if (!existsSync(nextBin)) {
  throw new Error("next is not installed yet. Run `pnpm install` first.");
}

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  cwd: projectRoot,
  // Static export is opt-in so the Sites/Vinext build keeps its own pipeline.
  env: { ...process.env, HAMAVA_STATIC_EXPORT: "1" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(`${outDir}index.html`)) {
  throw new Error("The build finished without `out/index.html`; check that output: \"export\" is active.");
}

// Jekyll hides folders whose name starts with an underscore (`_next/`), which
// breaks branch-based Pages publishing. GitHub Actions deploys ignore this file,
// and it costs nothing for hosts that never look at it.
writeFileSync(`${outDir}.nojekyll`, "");

assertStaticExport();

function assertStaticExport() {
  const indexHtml = readFileSync(`${outDir}index.html`, "utf8");
  if (basePath && !indexHtml.includes(`${basePath}/_next/`)) {
    throw new Error(`out/index.html does not use the base path ${basePath}; pass HAMAVA_BASE_PATH without a trailing slash.`);
  }
  // Turbopack writes the stylesheet into `_next/static/chunks`, other bundlers
  // use `_next/static/css`; search the whole export instead of one directory.
  const cssFiles = readdirSync(`${outDir}_next`, { recursive: true })
    .map(entry => String(entry))
    .filter(entry => entry.endsWith(".css"));
  if (!cssFiles.length) throw new Error("No exported CSS found; the static export is incomplete.");
  if (!basePath) return;
  // Every root-relative `url(/...)` left in the CSS would 404 under the base path.
  const rootRelative = /url\(\s*['"]?(\/[^'")\s]*)/g;
  const leaked = [];
  for (const entry of cssFiles) {
    const css = readFileSync(`${outDir}_next/${entry}`, "utf8");
    for (const [, path] of css.matchAll(rootRelative)) {
      if (path.startsWith("//") || path.startsWith(`${basePath}/`)) continue;
      leaked.push(`${entry}: ${path}`);
    }
  }
  if (leaked.length) {
    throw new Error(`CSS still points at the site root (${leaked.join(", ")}); check the PostCSS public-asset plugin.`);
  }
}

console.log(`Static export ready in out/ (base path: ${basePath || "/"}).`);