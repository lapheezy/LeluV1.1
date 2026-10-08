/**
 * ==========================================================
 * LÉLU — OG SERVER-FUNCTION COMPATIBILITY LAYER
 *
 * OG's data layer (lib/*.functions.ts) is written as TanStack
 * Start server functions:
 *
 *   createServerFn({ method })
 *     .middleware([requireSupabaseAuth])
 *     .inputValidator(parse)
 *     .handler(async ({ data, context }) => …)
 *
 * v1.1 ships as a static SPA inside Capacitor, where there is
 * no server to call. But those handlers do not actually need
 * one: every body is a user-scoped Supabase query, and Supabase
 * enforces the same access rules through RLS whether the query
 * originates on a server or in the browser. So rather than
 * stand up an API tier the Android build could never reach,
 * this layer runs the handlers directly against the browser
 * client, supplying the `context` the middleware would have.
 *
 * What changes versus OG, and why it is safe:
 *
 *   - The service-role path is gone. Queries run as the signed-in
 *     user under RLS, which is the correct posture for code that
 *     ships to a device.
 *   - `requireSupabaseAuth` is not executed. Its job was to turn
 *     an Authorization header into a client and a user id; here
 *     the browser client already holds the session, so the same
 *     context is assembled from it.
 *
 * When Supabase is absent the call rejects with
 * SupabaseUnconfiguredError, which callers distinguish from a
 * query failure — LÉLU keeps running without persistence rather
 * than the screen dying (integration brief §5).
 * ==========================================================
 */

import {
  getSupabase,
  SupabaseUnconfiguredError,
} from "@og/integrations/supabase/client";

export interface ServerFnContext {
  supabase: NonNullable<ReturnType<typeof getSupabase>>;
  userId: string;
  claims: Record<string, unknown>;
}

export interface ServerFnHandlerArgs<TInput> {
  data: TInput;
  context: ServerFnContext;
}

/** Thrown when a Supabase-backed OG function runs with no signed-in user. */
export class NotAuthenticatedError extends Error {
  readonly unauthenticated = true;
  constructor() {
    super("Not signed in. OG persistence requires a Supabase session.");
    this.name = "NotAuthenticatedError";
  }
}

async function buildContext(): Promise<ServerFnContext> {
  const supabase = getSupabase();
  if (!supabase) throw new SupabaseUnconfiguredError();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const session = data.session;
  if (!session?.user?.id) throw new NotAuthenticatedError();

  return {
    supabase,
    userId: session.user.id,
    claims: (session.user as unknown as Record<string, unknown>) ?? {},
  };
}

type Validator<TInput> = (input: unknown) => TInput;
type Handler<TInput, TOutput> = (args: ServerFnHandlerArgs<TInput>) => Promise<TOutput>;

/**
 * A built OG function.
 *
 * `data` is intentionally `unknown` rather than the validator's output type.
 * OG call sites pass partial input and let the zod validator apply defaults
 * (`listQueue({ data: { status } })` against a schema whose `limit` has one),
 * so typing the argument as the validated shape would reject correct calls.
 * The validator remains the real gate at runtime.
 */
export type ServerFn<TOutput> = (args?: { data?: unknown }) => Promise<TOutput>;

class ServerFnBuilder<TInput = void> {
  private validator?: Validator<TInput>;

  /** Accepted and ignored: auth context is assembled from the browser session. */
  middleware(_middleware: unknown[]): this {
    return this;
  }

  inputValidator<TNext>(validator: Validator<TNext>): ServerFnBuilder<TNext> {
    const next = new ServerFnBuilder<TNext>();
    (next as unknown as { validator?: Validator<TNext> }).validator = validator;
    return next;
  }

  handler<TOutput>(handler: Handler<TInput, TOutput>): ServerFn<TOutput> {
    const validator = this.validator;
    const run = async (args?: { data?: unknown }): Promise<TOutput> => {
      const context = await buildContext();
      const raw = args?.data;
      const data = (validator ? validator(raw) : raw) as TInput;
      return handler({ data, context });
    };
    return run as ServerFn<TOutput>;
  }
}

export function createServerFn(_options?: { method?: "GET" | "POST" }) {
  return new ServerFnBuilder();
}

/** OG calls useServerFn(fn) to get a callable; here the fn already is one. */
export function useServerFn<T>(fn: T): T {
  return fn;
}

/** Middleware factory kept so auth-middleware.ts still type-checks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MiddlewareFn = (args: any) => any;

export function createMiddleware(_opts?: { type?: string }) {
  const chain = {
    server: (_fn: MiddlewareFn) => chain,
    client: (_fn: MiddlewareFn) => chain,
    middleware: (_m: unknown[]) => chain,
  };
  return chain;
}
