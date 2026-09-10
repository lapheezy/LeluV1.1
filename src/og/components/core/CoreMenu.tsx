import { useEffect, useRef, useState } from "react";
import { useWindows, type PanelId } from "./WindowManager";
import { MessageSquare, Library, ListChecks, Search, Mic, ScrollText, Settings as SettingsIcon, Orbit, FileText, Bot, History } from "lucide-react";

const ITEMS: { id: PanelId; label: string; icon: React.ComponentType<{ className?: string }>; title: string }[] = [
  { id: "chat",       label: "Chat",       icon: MessageSquare, title: "Chat" },
  { id: "memory",     label: "Memory",     icon: Library,       title: "Memory" },
  { id: "memory-log", label: "Mem Log",    icon: History,       title: "Memory Log" },
  { id: "executive",  label: "Executive",  icon: ListChecks,    title: "Executive" },
  { id: "research",   label: "Research",   icon: Search,        title: "Research" },
  { id: "voice",      label: "Voice",      icon: Mic,           title: "Voice" },
  { id: "logs",       label: "Logs",       icon: ScrollText,    title: "Logs" },
  { id: "settings",   label: "Settings",   icon: SettingsIcon,  title: "Settings" },
  { id: "projects",   label: "Projects",   icon: Orbit,         title: "Projects" },
  { id: "files",      label: "Files",      icon: FileText,      title: "Files" },
  { id: "agents",     label: "Agents",     icon: Bot,           title: "Agents" },
];

export function CoreMenu({
  open,
  onClose,
  center,
  radius,
}: {
  open: boolean;
  onClose: () => void;
  center: { x: number; y: number };
  radius?: number;
}) {
  const openWin = useWindows((s) => s.open);
  const ref = useRef<HTMLDivElement | null>(null);
  const [autoRadius, setAutoRadius] = useState(180);

  useEffect(() => {
    const measure = () =>
      setAutoRadius(Math.max(110, Math.min(180, Math.min(window.innerWidth, window.innerHeight) * 0.34)));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const r = radius ?? autoRadius;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="pointer-events-none fixed inset-0 z-[8000]" aria-hidden={!open}>
      {ITEMS.map((item, i) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / ITEMS.length;
        const tx = Math.cos(angle) * r;
        const ty = Math.sin(angle) * r;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            aria-label={item.label}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              openWin({ id: item.id, key: item.id, title: item.title });
              onClose();
            }}
            className={`absolute transition-all duration-500 ease-out ${
              open ? "pointer-events-auto" : "pointer-events-none"
            }`}
            style={{
              left: center.x,
              top: center.y,
              transform: `translate(${open ? tx : 0}px, ${open ? ty : 0}px) translate(-50%, -50%) scale(${open ? 1 : 0.4})`,
              opacity: open ? 1 : 0,
            }}
          >
            <span className="relative grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-background/70 text-foreground/85 shadow-xl backdrop-blur-xl transition hover:scale-110 hover:text-foreground hover:border-white/40 sm:h-14 sm:w-14">
              <Icon className="size-5" />
              <span className="pointer-events-none absolute top-full mt-1 text-[9px] uppercase tracking-[0.3em] text-foreground/60 whitespace-nowrap">
                {item.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}