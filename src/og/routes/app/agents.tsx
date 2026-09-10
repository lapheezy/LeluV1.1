import { createFileRoute } from "@og/compat/router";
import { Bot } from "lucide-react";

export const Route = createFileRoute("/app/agents")({ component: AgentsPage });

function AgentsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl">Agents</h1>
        <p className="text-foreground/60 text-sm mt-1">
          Specialized aspects of Lélu, each tuned for a single purpose.
        </p>
      </header>
      <div className="rounded-xl border border-border/40 bg-card/30 p-10 text-center">
        <Bot className="mx-auto size-8 text-foreground/40" />
        <p className="mt-3 text-sm text-foreground/60">
          Agent framework arriving soon. For now, Lélu speaks as one.
        </p>
      </div>
    </div>
  );
}