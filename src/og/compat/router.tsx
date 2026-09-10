/**
 * ==========================================================
 * LÉLU — OG ROUTER COMPATIBILITY LAYER
 *
 * The OG interfaces were built on TanStack Router; v1.1 routes
 * with react-router. Rather than rewrite 23 OG files — and lose
 * the ability to diff them against the original — this module
 * presents the small slice of TanStack's API the OG code
 * actually uses, implemented on react-router.
 *
 * The whole surface in use is six names:
 *   createFileRoute, Link, useNavigate, useParams,
 *   useRouterState, Outlet
 *
 * Only `to`/`params` path building is supported on Link and
 * navigate, because that is all OG passes. Anything richer
 * should be a real react-router call in new code, not an
 * extension here — this layer exists to carry the OG sources
 * across unchanged, not to become a router.
 * ==========================================================
 */

import type { ReactNode } from "react";
import {
  Link as RRLink,
  Outlet as RROutlet,
  useLocation,
  useNavigate as useRRNavigate,
  useParams as useRRParams,
} from "react-router-dom";

export const Outlet = RROutlet;

/** Substitute `$id`-style segments with the params TanStack would have. */
function buildPath(to: string, params?: Record<string, string | number>): string {
  if (!params) return to;
  return to.replace(/\$([A-Za-z0-9_]+)/g, (whole, key: string) =>
    params[key] != null ? String(params[key]) : whole,
  );
}

function toSearch(search?: Record<string, unknown>): string {
  if (!search) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v != null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface OgLinkProps {
  to: string;
  params?: Record<string, string | number>;
  search?: Record<string, unknown>;
  replace?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler;
  title?: string;
  children?: ReactNode;
}

export function Link({ to, params, search, ...rest }: OgLinkProps) {
  return <RRLink to={`${buildPath(to, params)}${toSearch(search)}`} {...rest} />;
}

export interface OgNavigateOptions {
  to: string;
  params?: Record<string, string | number>;
  search?: Record<string, unknown>;
  replace?: boolean;
}

/** TanStack calls navigate with an options object; react-router takes a path. */
export function useNavigate() {
  const navigate = useRRNavigate();
  return (options: OgNavigateOptions | string) => {
    if (typeof options === "string") return navigate(options);
    const { to, params, search, replace } = options;
    return navigate(`${buildPath(to, params)}${toSearch(search)}`, { replace });
  };
}

export function useParams<T = Record<string, string>>(_opts?: unknown): T {
  return useRRParams() as unknown as T;
}

export interface OgRouterState {
  location: { pathname: string; search: string };
}

/** OG reads this as `useRouterState({ select: s => s.location.pathname })`,
 *  so the selector's return type is what callers get back. */
export function useRouterState<T = OgRouterState>(opts?: {
  select?: (state: OgRouterState) => T;
}): T {
  const location = useLocation();
  const state: OgRouterState = {
    location: { pathname: location.pathname, search: location.search },
  };
  return (opts?.select ? opts.select(state) : state) as T;
}

export interface OgRouteConfig {
  component?: () => ReactNode;
  ssr?: boolean;
  head?: () => unknown;
  loader?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/**
 * OG route modules end with `export const Route = createFileRoute(path)({...})`.
 * Under react-router the route table is declared in src/og/OgRoutes.tsx, so
 * this keeps those exports valid and hands back the component the table
 * renders. `head()` is retained but not invoked — v1.1 has no SSR head
 * management, and inventing one here would be scope the brief did not ask for.
 */
export function createFileRoute(_path: string) {
  return (config: OgRouteConfig) => ({
    ...config,
    useParams,
    useNavigate,
  });
}
