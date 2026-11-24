/**
 * Node test runner: stylesheets are the browser's business. A component
 * that imports a .css file (the cloud chat, the home) loads in tests with
 * an empty module in its place instead of failing to import.
 *
 * Resolution is intercepted too, not only loading. A package subpath such
 * as `@excalidraw/excalidraw/index.css` is gated behind build conditions
 * that Node's default resolver does not match, so it failed BEFORE a load
 * hook could see it (ERR_PACKAGE_PATH_NOT_EXPORTED). Resolving every
 * `.css` specifier to the same empty module works for relative files and
 * package exports alike.
 */
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
const EMPTY_CSS = "data:text/javascript,export default {};";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) {
    return { url: EMPTY_CSS, format: "module", shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
  return next(url, context);
}
`),
  import.meta.url,
);
