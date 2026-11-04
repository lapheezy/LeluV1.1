/**
 * ==========================================================
 * LÉLU HOME — LIVE STATE
 *
 * Everything the home shows, read from the systems that own it:
 * notifications (NotificationProvider), projects (ProjectStore), her
 * executive state (ExecutiveRuntime: current task, action, approvals,
 * browser), cloud persistence (SupabasePersistence), the remembered
 * layout (HomeStore) and the weather (Open-Meteo). Nothing invented.
 * ==========================================================
 */

import { useCallback, useEffect, useState } from "react";
import NotificationProvider, { type NotificationRecord } from "../../../../core/notifications/NotificationProvider";
import ProjectStore, { type LeluProject } from "../../../../core/projects/ProjectStore";
import ExecutiveRuntime, { type ExecutiveSelfState } from "../../../../core/executive/ExecutiveRuntime";
import SupabasePersistence, { type SupabaseAuthState } from "../../../../core/persistence/SupabasePersistence";
import ProactiveCore from "../../../../core/proactive/ProactiveCore";
import HomeStore, { type HomeState } from "./homeStore";
import { devicePlace, fetchWeather, geocode, savePlace, savedPlace, type HomeWeather } from "./homeWeather";

type Executive = ExecutiveSelfState;

export function useNotifications(): { recent: NotificationRecord[]; unread: number } {
  const provider = NotificationProvider.getInstance();
  const read = () => ({ recent: provider.history().slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 3), unread: provider.unreadCount() });
  const [value, setValue] = useState(read);
  useEffect(() => provider.subscribeHistory(() => setValue(read())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

export function useProjects(): LeluProject[] {
  const store = ProjectStore.getInstance();
  const [projects, setProjects] = useState(() => store.list());
  useEffect(() => store.subscribe(() => setProjects(store.list())), [store]);
  return projects;
}

export function useExecutive(): Executive {
  const runtime = ExecutiveRuntime.getInstance();
  const [state, setState] = useState(() => runtime.get());
  useEffect(() => runtime.subscribe(() => setState({ ...runtime.get() })), [runtime]);
  return state;
}

export function useCloud(): SupabaseAuthState {
  const persistence = SupabasePersistence.getInstance();
  const [state, setState] = useState(() => persistence.getAuthState());
  useEffect(() => persistence.subscribeAuth(setState), [persistence]);
  return state;
}

export function useHomeStore(): HomeState {
  const [state, setState] = useState(() => HomeStore.get());
  useEffect(() => HomeStore.subscribe(setState), []);
  return state;
}

export function useWeather(): {
  weather: HomeWeather | null;
  error: string | null;
  needsPlace: boolean;
  locate: () => void;
} {
  const [weather, setWeather] = useState<HomeWeather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPlace, setNeedsPlace] = useState(false);

  const load = useCallback(async () => {
    try {
      let place = savedPlace();
      if (!place) {
        const known = ProactiveCore.getInstance().getLocation();
        if (known) {
          place = await geocode(known);
          if (place) savePlace(place);
        }
      }
      if (!place) {
        setNeedsPlace(true);
        return;
      }
      setNeedsPlace(false);
      setWeather(await fetchWeather(place));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const locate = useCallback(() => {
    devicePlace()
      .then((place) => {
        savePlace(place);
        return load();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  return { weather, error, needsPlace, locate };
}
