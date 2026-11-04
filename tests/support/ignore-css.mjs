/**
 * Node test runner: stylesheets are the browser's business. A component
 * that imports a .css file (the cloud chat, the home) loads in tests with
 * an empty module in its place instead of failing to import.
 */
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
  return next(url, context);
}
`),
  import.meta.url,
);
