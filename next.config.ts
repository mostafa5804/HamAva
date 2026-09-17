import type { NextConfig } from "next";

// GitHub Pages has no Node.js server, so `pnpm build:pages` exports static files
// instead of the Sites/Vinext server bundle. A repository project site also
// lives under `/<repository>/`, which needs a base path. Both values stay unset
// for local development and for the hosted Sites target.
const staticExport = process.env.HAMAVA_STATIC_EXPORT === "1";
const basePath = (process.env.HAMAVA_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(staticExport
    ? {
        output: "export" as const,
        // A static host resolves a directory URL to its `index.html`.
        trailingSlash: true,
        // The default image loader needs a server; the app uses plain <img>.
        images: { unoptimized: true },
      }
    : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
