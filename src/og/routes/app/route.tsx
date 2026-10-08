import { createFileRoute } from "@og/compat/router";
import { AppShell } from "@og/components/app/AppShell";

export const Route = createFileRoute("/app")({
  ssr: false,
  head: () => ({ meta: [{ title: "Lélu — Inner Sky" }] }),
  component: AppShell,
});
/** Default export so v1.1's router can lazy-load this OG surface. */
export default AppShell;
