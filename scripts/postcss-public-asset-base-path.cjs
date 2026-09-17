// Prefixes `url(/...)` references that point at files in `public/` with the
// deployment base path.
//
// Next.js rewrites its own `_next/` assets for a base path, but it leaves
// `url()` inside plain CSS untouched (assetPrefix docs: "Files in the public
// folder ... you'll have to introduce the prefix yourself"), and a GitHub Pages
// project site lives under `/<repository>/`.
//
// The plugin is only referenced by postcss.config.mjs when HAMAVA_BASE_PATH is
// set, so root hosts keep the original `/fonts/...` URLs.
module.exports = (options = {}) => {
  const basePath = String(options.basePath || "").replace(/\/+$/, "");
  const pattern = /url\(\s*(['"]?)\/(?!\/)/g;

  return {
    postcssPlugin: "hamava-public-asset-base-path",
    // OnceExit runs after every other plugin and its changes are not revisited,
    // so the rewrite can never feed itself: `/fonts/x` becomes
    // `/<base>/fonts/x`, which would otherwise match the pattern again.
    OnceExit(root) {
      root.walkDecls((declaration) => {
        if (declaration.raws.hamavaPrefixed) return;
        pattern.lastIndex = 0;
        if (!pattern.test(declaration.value)) return;
        pattern.lastIndex = 0;
        declaration.value = declaration.value.replace(
          pattern,
          (_match, quote) => `url(${quote}${basePath}/`,
        );
        declaration.raws.hamavaPrefixed = true;
      });
    },
  };
};

module.exports.postcss = true;