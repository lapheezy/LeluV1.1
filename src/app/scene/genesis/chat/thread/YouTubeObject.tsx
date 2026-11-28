/**
 * A YouTube video inside the thread (Mission 44.9): YouTube's own embed
 * player (youtube-nocookie), started by the person. Its state is READ from
 * the player through the IFrame API's postMessage channel (infoDelivery:
 * playerState, currentTime) and written to the element, so "is it playing"
 * is a measurement, never an assumption.
 *
 * Across a reload YouTube cannot keep playing: the player is recreated and
 * offers to resume at the last position it reported (start=…). The person
 * presses play again; nothing autoplays.
 */

import { useEffect, useRef, useState } from "react";
import { update, type ThreadObject } from "../../../../../core/thread/ThreadObjects";
import NekoLive, { useNekoAvailability } from "../../neko/NekoLive";

const STATES: Record<number, string> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };

export default function YouTubeObject({ object }: { object: ThreadObject }) {
  const video = object.video!;
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = useState<{ playerState: string; time: number; duration: number }>({ playerState: "loading", time: 0, duration: 0 });
  const resumeAt = useRef(Math.floor(object.lastTime ?? 0));
  const saved = useRef(0);
  // Where the embedded player refuses (this server gets "Video unavailable"), the same video can play in Neko.
  const neko = useNekoAvailability();
  const [inNeko, setInNeko] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      if (e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: { playerState?: number; currentTime?: number; duration?: number } } | null = null;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!data) return;
      if (data.event === "onReady") setState((s) => ({ ...s, playerState: "ready" }));
      const info = data.info;
      if (data.event === "infoDelivery" && info) {
        setState((s) => ({
          playerState: typeof info.playerState === "number" ? STATES[info.playerState] ?? String(info.playerState) : s.playerState,
          time: typeof info.currentTime === "number" ? info.currentTime : s.time,
          duration: typeof info.duration === "number" ? info.duration : s.duration,
        }));
        // Keep the position (at most every 5 s) so a reload can offer to resume there.
        if (typeof info.currentTime === "number" && Math.abs(info.currentTime - saved.current) > 5) {
          saved.current = info.currentTime;
          update(object.id, { lastTime: Math.floor(info.currentTime) });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [object.id]);

  // The IFrame API only reports after the page says it is listening.
  const listen = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    for (const delay of [0, 400, 1200]) setTimeout(() => w.postMessage(JSON.stringify({ event: "listening", id: object.id, channel: "widget" }), "*"), delay);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?enablejsapi=1&playsinline=1&rel=0${resumeAt.current ? `&start=${resumeAt.current}` : ""}&origin=${encodeURIComponent(origin)}`;
  const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="ty" data-youtube={video.id} data-player-state={inNeko ? "neko" : state.playerState} data-player-time={state.time.toFixed(1)}>
      {inNeko ? <NekoLive url={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}${resumeAt.current ? `&t=${resumeAt.current}s` : ""}`} height="100%" surface="thread-youtube" /> : <iframe ref={frame} src={src} title={video.title} onLoad={listen} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />}
      <div className="ty-meta">
        <span className={`ty-state ty-${state.playerState}`}>{state.playerState === "playing" ? "● Playing" : state.playerState}</span>
        <span>
          {t(state.time)}
          {state.duration ? ` / ${t(state.duration)}` : ""}
        </span>
        {resumeAt.current && state.playerState !== "playing" ? <span className="ty-resume">resumes at {t(resumeAt.current)} when you press play</span> : null}
        {video.channel ? <span className="ty-ch">{video.channel}</span> : null}
        {neko === "reachable" ? (
          <button type="button" className="ty-neko" data-neko-toggle onClick={() => setInNeko((v) => !v)}>
            {inNeko ? "Back to embed" : "◉ Watch in Neko"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
