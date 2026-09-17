import { fileURLToPath } from "node:url";

// Next.js prefixes its own `_next/` assets with a base path, but it leaves
// `url()` references inside plain CSS untouched (see the assetPrefix docs:
// "Files in the public folder ... you'll have to introduce the prefix
// yourself"). A GitHub Pages project site lives under `/<repository>/`, so the
// `/fonts/...` files in `public/` need that prefix at build time.
const basePath = (process.env.HAMAVA_BASE_PATH ?? "").replace(/\/+$/, "");
// PostCSS loads a plugin by module id, so the id is an absolute file URL path:
// it resolves no matter which directory the build evaluates the config from.
const publicAssetPlugin = fileURLToPath(
  new URL("./scripts/postcss-public-asset-base-path.cjs", import.meta.url),
);

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Without a base path nothing is rewritten: root hosts keep `/fonts/...`.
    ...(basePath ? { [publicAssetPlugin]: { basePath } } : {}),
  },
};

export default config;
