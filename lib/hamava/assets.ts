/**
 * Resolve a file from `public/` against the page that is currently open.
 *
 * GitHub Pages serves the app either from the domain root (a `<user>.github.io`
 * repository or a custom domain) or from a project sub-path such as `/HamAva/`.
 * Next.js only inlines a base path into the documents it renders, so paths that
 * the application passes to browser APIs itself (the audio worklet module and
 * the service worker) are resolved from the document instead of the site root.
 */
export function appAsset(path: string): string {
  const clean = String(path).replace(/^\/+/, '');
  // Prerender runs without a DOM; this branch is never used at runtime.
  if (typeof document === 'undefined') return `/${clean}`;
  return new URL(clean, document.baseURI).href;
}