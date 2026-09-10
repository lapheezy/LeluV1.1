import { Link, Outlet, useNavigate, useRouterState } from "@og/compat/router";
import { useEffect } from "react";
import { useSession } from "@og/hooks/use-session";
import { supabase } from "@og/integrations/supabase/client";
import {
  Sparkles,
  Sun,
  Library,
  Orbit,
  MessageSquare,
  FileText,
  LogOut,
  Bot,
  Settings as SettingsIcon,
  ListChecks,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@og/components/ui/sidebar";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const PRIMARY: NavItem[] = [
  { to: "/app", label: "Home", icon: Sparkles, exact: true },
  { to: "/app/chats", label: "Chats", icon: MessageSquare },
  { to: "/app/agents", label: "Agents", icon: Bot },
  { to: "/app/memories", label: "Memory Garden", icon: Library },
  { to: "/app/files", label: "Files", icon: FileText },
  { to: "/app/universes", label: "Projects", icon: Orbit },
];

const SECONDARY: NavItem[] = [
  { to: "/app/queue", label: "Action queue", icon: ListChecks },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell() {
  const { session, loading, error, unconfigured } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect only when there is a Supabase to sign in to. With none
    // configured the OG surface renders disconnected instead of bouncing the
    // user out of it — LÉLU has to work without Supabase (brief §5, §21).
    if (!loading && !session && !unconfigured) navigate({ to: "/" });
  }, [loading, session, unconfigured, navigate]);

  if (loading || (!session && !unconfigured)) {
    return (
      <div className="min-h-screen grid place-items-center gap-3 bg-background px-6 text-center text-sm text-foreground/60">
        <div>
          <p>{loading ? "opening…" : "you're signed out"}</p>
          {error && <p className="mt-2 text-xs text-foreground/50">{error}</p>}
          {!loading && (
            <button
              onClick={() => navigate({ to: "/" })}
              className="mt-4 text-xs underline hover:text-foreground"
            >
              back to the horizon
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <CompanionSidebar />
        <SidebarInset className="min-w-0 flex flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border/40 bg-background/80 px-3 backdrop-blur md:px-4">
            <SidebarTrigger className="-ml-1" />
            <Crumbs />
            <div className="ml-auto flex items-center gap-2">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] uppercase tracking-[0.25em] text-foreground/60 hover:text-foreground hover:bg-foreground/5"
              >
                <Sun className="size-3.5" />
                <span className="hidden sm:inline">Solar core</span>
              </Link>
            </div>
          </header>
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function CompanionSidebar() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile, isMobile } = useSidebar();

  const handleNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-1.5 group"
          onClick={handleNav}
        >
          <span className="inline-block size-2 shrink-0 rounded-full bg-sun shadow-[0_0_12px_oklch(0.85_0.15_75)] group-hover:scale-110 transition" />
          <span className="font-display text-sm tracking-[0.35em] uppercase truncate group-data-[collapsible=icon]:hidden">
            Lélu
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Companion</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY.map((item) => (
                <NavRow key={item.to} item={item} path={path} onNav={handleNav} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECONDARY.map((item) => (
                <NavRow key={item.to} item={item} path={path} onNav={handleNav} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border/40">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/" });
              }}
            >
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavRow({
  item,
  path,
  onNav,
}: {
  item: NavItem;
  path: string;
  onNav: () => void;
}) {
  const active = item.exact
    ? path === item.to
    : path === item.to || path.startsWith(item.to + "/");
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link to={item.to} onClick={onNav}>
          <Icon className="size-4" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function Crumbs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const label =
    PRIMARY.find((p) =>
      p.exact ? path === p.to : path === p.to || path.startsWith(p.to + "/"),
    )?.label ??
    SECONDARY.find((p) => path.startsWith(p.to))?.label ??
    "Inner sky";
  return (
    <span className="text-[11px] uppercase tracking-[0.25em] text-foreground/50 truncate">
      {label}
    </span>
  );
}