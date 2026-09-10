/**
 * Error reporting for the OG interfaces.
 *
 * The OG original forwarded exceptions to a global that only its old host
 * platform's preview shell defined. Outside that shell the call did nothing,
 * and LÉLU runs outside it, so the bridge is removed rather than left as dead
 * indirection pointing at a service this project does not use.
 *
 * The signature is retained so ErrorBoundary keeps compiling, and errors go to
 * the console, which is where the rest of LÉLU reports them.
 */
export function reportInterfaceError(error: unknown, context: Record<string, unknown> = {}): void {
  console.error("[og] interface error", error, context);
}
