/**
 * The chat box that rises from LÉLU's core in the Cosmos (owner, 2026-11-28).
 *
 * Open the app, sign in, and LÉLU opens INTO the Cosmos: the primary scene, her core at the centre, and
 * this one chat box coming up out of the core. That is the whole first screen. Everything else is one
 * step away:
 * - the "+" Controls tab holds every other chat option: photos, camera, documents, 3D files, the chat
 *   workspace (the Thread), the Chat Universe, the Neural Map (V1/V2/V3), the chat variants, the theme and
 *   the light/full mode;
 * - or tell LÉLU what you want;
 * - or use the dial at the bottom.
 *
 * It sends through the same event every composer uses (UNIVERSE_SEND_EVENT, handled by the one send
 * engine), and attaches through the same shared path (chat/universe/attachments.ts). No second chat.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGenesis } from "../GenesisCore";
import { openChatWorkspace, showNeuralMap } from "./chatWorkspace";
import { UNIVERSE_SEND_EVENT } from "../chat/universe/ChatUniverse";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import { prepareAttachments, type ChatFile } from "../chat/universe/attachments";
import VoiceMicButton from "../../../../core/voice/VoiceMicButton";
import { setVariant, variantFor } from "../../../../core/thread/ThreadObjects";
import { variants } from "../../../../core/thread/ThreadVariants";
import type { ProcessedMedia } from "../../../../core/media/mediaProcessor";
import "./coreChat.css";

/** Extra sections the Controls tab shows (theme, performance), registered by their owners. */
export type ControlsSection = { id: string; title: string; render: () => React.ReactNode };
const extraSections: ControlsSection[] = [];
export function registerControlsSection(section: ControlsSection): void {
  if (!extraSections.some((s) => s.id === section.id)) extraSections.push(section);
}

export default function CoreChat() {
  const genesis = useGenesis();
  const { conversations, activeConversationId } = genesis.state;
  const conversation = conversations.find((c) => c.id === activeConversationId) ?? conversations[0] ?? null;
  const [draft, setDraft] = useState("");
  const [media, setMedia] = useState<ProcessedMedia[]>([]);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [controls, setControls] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);

  // There is always a conversation to talk in.
  useEffect(() => {
    if (!conversation) genesis.createConversation();
  }, [conversation, genesis]);

  const id = conversation?.id ?? null;
  const last = conversation?.messages ?? [];
  const lastUser = [...last].reverse().find((m) => m.role === "user");
  const lastReply = [...last].reverse().find((m) => m.role === "assistant");

  const attach = async (list: FileList | null) => {
    const r = await prepareAttachments(list);
    if (r.notices.length) setNotice(r.notices.join(" "));
    setMedia((c) => [...c, ...r.media].slice(0, 4));
    setFiles((c) => [...c, ...r.files].slice(0, 4));
    setControls(false);
  };

  const send = () => {
    const text = draft.trim() || (media.length === 0 && files.length > 0 ? "Please read the attached file(s)." : "");
    if (!id || (!text && media.length === 0)) return;
    if (id !== activeConversationId) genesis.switchConversation(id);
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: id, media, files } }));
    setDraft("");
    setMedia([]);
    setFiles([]);
  };

  /** The chat workspace and the Neural Map, inside the Cosmos (shared with the dial: chatWorkspace.ts). */
  const openWorkspace = (stage: "thread" | "conversation" = "thread") => {
    setControls(false);
    openChatWorkspace(genesis, stage);
  };
  const showMap = (aspect: "v1" | "v2" | "v3") => {
    setControls(false);
    showNeuralMap(genesis, aspect);
  };
  const current = id ? variantFor(id) : "workspace";

  // Rendered at the page root: inside the interface container its z-index only counted within that
  // container, and her companion figure covered Send on a phone (measured).
  return createPortal(
    <div className="ccx" data-core-chat data-controls={controls ? "open" : "closed"}>
      <span className="ccx-stem" aria-hidden />
      {lastReply || lastUser || conversation?.processing ? (
        <div className="ccx-last" aria-live="polite">
          {lastUser ? <p className="ccx-you">{lastUser.text.slice(0, 220)}</p> : null}
          {conversation?.processing ? (
            <p className="ccx-typing" role="status"><span /><span /><span /></p>
          ) : lastReply ? (
            <p className="ccx-her">{lastReply.text.slice(0, 600)}{lastReply.text.length > 600 ? "…" : ""}</p>
          ) : null}
          <button type="button" className="ccx-link" onClick={() => openWorkspace("conversation")}>Open the whole conversation</button>
        </div>
      ) : null}

      {controls ? (
        <div className="ccx-controls" role="dialog" aria-label="Chat controls" data-core-controls>
          <section>
            <h4>Add to the message</h4>
            <div className="ccx-grid">
              <button type="button" onClick={() => photoRef.current?.click()}>🖼 Photos &amp; video</button>
              <button type="button" onClick={() => cameraRef.current?.click()}>📷 Camera</button>
              <button type="button" onClick={() => docRef.current?.click()}>📄 Documents</button>
              <button type="button" onClick={() => modelRef.current?.click()}>🧊 3D file</button>
            </div>
          </section>
          <section>
            <h4>Open, inside the Cosmos</h4>
            <div className="ccx-grid">
              <button type="button" data-open="workspace" onClick={() => openWorkspace()}>Chat workspace</button>
              <button type="button" data-open="universe" onClick={() => { setControls(false); setUniverseOpen(true); }}>Chat Universe</button>
              <button type="button" data-open="v1" onClick={() => showMap("v1")}>Neural Map · V1 knowledge</button>
              <button type="button" data-open="v2" onClick={() => showMap("v2")}>Neural Map · V2 architecture</button>
              <button type="button" data-open="v3" onClick={() => showMap("v3")}>Neural Map · V3 agents</button>
              <button type="button" data-open="creative" onClick={() => { setControls(false); window.dispatchEvent(new CustomEvent("lelu-creative-dock-open")); }}>Creative objects</button>
            </div>
          </section>
          <section>
            <h4>Chat variant</h4>
            <div className="ccx-grid">
              {variants().map((v) => (
                <button key={v.id} type="button" data-variant={v.id} data-on={v.id === current ? "true" : "false"} title={v.description} onClick={() => { if (id) setVariant(id, v.id); openWorkspace(); }}>
                  {v.label}
                </button>
              ))}
            </div>
          </section>
          {extraSections.map((s) => (
            <section key={s.id} data-section={s.id}>
              <h4>{s.title}</h4>
              {s.render()}
            </section>
          ))}
          <p className="ccx-hint">Or just tell LÉLU, or use the dial at the bottom.</p>
        </div>
      ) : null}

      {media.length || files.length ? (
        <div className="ccx-chips" aria-label="Attachments">
          {[...media.map((m, i) => ({ key: `m${i}`, name: (m as { name?: string }).name ?? "image", drop: () => setMedia((c) => c.filter((_, j) => j !== i)) })), ...files.map((f) => ({ key: f.id, name: f.name, drop: () => setFiles((c) => c.filter((x) => x.id !== f.id)) }))].map((c) => (
            <span key={c.key} className="ccx-chip">{c.name}<button type="button" aria-label={`Remove ${c.name}`} onClick={c.drop}>×</button></span>
          ))}
        </div>
      ) : null}
      {notice ? <p className="ccx-notice" role="status">{notice}</p> : null}

      <form className="ccx-bar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="ccx-plus" aria-label="Chat controls" aria-expanded={controls} data-on={controls ? "true" : "false"} onClick={() => setControls((v) => !v)}>+</button>
        <textarea
          rows={1}
          value={draft}
          placeholder="Talk to LÉLU…"
          aria-label="Message LÉLU"
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <VoiceMicButton context="cosmos-core" showStatus={false} />
        <button type="submit" className="ccx-send" aria-label="Send to LÉLU" disabled={!draft.trim() && media.length === 0 && files.length === 0}>Send</button>
      </form>
      <input ref={photoRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => void attach(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void attach(e.target.files)} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.rtf,.html,.xlsx,.pptx" multiple hidden onChange={(e) => void attach(e.target.files)} />
      <input ref={modelRef} type="file" accept=".glb,.gltf,.stl,.obj" hidden onChange={(e) => void attach(e.target.files)} />
    </div>,
    document.body,
  );
}
