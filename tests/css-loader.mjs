/**
 * Node module hook for the test runner: stylesheets are import side-effects
 * only. The app build (Vite) compiles them; `tsx --test` has no such stage, so
 * a component that imports its own CSS failed the whole test file with
 * ERR_UNKNOWN_FILE_EXTENSION. This returns an empty module instead.
 */
export async function load(url, context, next) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  return next(url, context);
}
