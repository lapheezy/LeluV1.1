import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBadge() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center p-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.25em] text-amber-100 backdrop-blur">
        <WifiOff className="size-3.5" /> offline — changes queued locally
      </div>
    </div>
  );
}