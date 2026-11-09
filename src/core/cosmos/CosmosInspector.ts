/**
 * ==========================================================
 * LÉLU — COSMOS INSPECTOR
 *
 * A spatial object is a pointer. This is what a pointer is
 * worth: given an object in a room, it loads the record it
 * links to and reports what that record actually says right
 * now — never what the object's card said when it was placed.
 *
 * If a record cannot be loaded, it says so. It never fills the
 * gap with the object's stored title and calls that inspection.
 * ==========================================================
 */

import ProjectStore from "../projects/ProjectStore";
import MultiChatStore from "../multichat/MultiChatStore";
import TaskEngine from "../tasks/TaskEngine";
import WorkspaceAPI from "../workspace/WorkspaceAPI";
import type { WorkspaceViewKind } from "../workspace/WorkspaceEngine";
import SpatialObjects, { type SpatialKind, type SpatialObject } from "./SpatialObjects";

export interface Inspection {
  ok: boolean;
  objectId: string;
  title: string;
  kind: SpatialKind;
  /** The record this object points at. */
  link: { kind: string; id: string };
  roomId: string;
  /** Real lines read from the record, or the truthful reason there are none. */
  lines: string[];
  /** A workspace view this record can be opened as, when it has one. */
  openable: boolean;
}

function clip(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** A URL standing in as a record id (media placed by address). */
function asUrl(link: { kind: string; id: string }): string | null {
  return /^https?:\/\//i.test(link.id) ? link.id : null;
}

const URL_VIEW_KINDS: Record<string, WorkspaceViewKind> = {
  image: "image",
  video: "video",
  file: "browser",
  research: "browser",
  document: "browser",
};

export default class CosmosInspector {
  private static instance: CosmosInspector | null = null;

  static getInstance(): CosmosInspector {
    if (!CosmosInspector.instance) CosmosInspector.instance = new CosmosInspector();
    return CosmosInspector.instance;
  }

  /** Read the record behind an object, from its own store. */
  inspect(objectId: string): Inspection {
    const object = SpatialObjects.getInstance().get(objectId);
    if (!object) {
      return {
        ok: false,
        objectId,
        title: objectId,
        kind: "note",
        link: { kind: "unknown", id: objectId },
        roomId: "cosmos-core",
        lines: ["That object is no longer in any room."],
        openable: false,
      };
    }

    const base: Inspection = {
      ok: true,
      objectId: object.id,
      title: object.title,
      kind: object.kind,
      link: { ...object.link },
      roomId: object.roomId,
      lines: [],
      openable: false,
    };

    const record = this.readRecord(object);
    return {
      ...base,
      ok: record.ok,
      lines: record.lines,
      openable: record.openable,
    };
  }

  /**
   * Open the record behind an object as a workspace view.
   *
   * This is a real open (through WorkspaceAPI, so the same boundary
   * rules apply): a project switches the active project as well, a task
   * shows its real step state, a conversation opens its transcript, and
   * a URL opens the browser view.
   */
  open(objectId: string): { ok: boolean; message: string } {
    const object = SpatialObjects.getInstance().get(objectId);
    if (!object) return { ok: false, message: "That object is no longer in any room." };
    const api = WorkspaceAPI.getInstance();
    const link = object.link;

    if (link.kind === "project") {
      const project = ProjectStore.getInstance().list().find((item) => item.id === link.id);
      if (!project) return { ok: false, message: `Project ${link.id} no longer exists.` };
      const switched = api.execute({ action: "switch-project", actor: "user", projectId: project.id });
      if (!switched.ok) return { ok: false, message: switched.message };
      const opened = api.execute({
        action: "open-workspace",
        actor: "user",
        view: {
          id: `project-${project.id}`,
          kind: "table",
          title: project.name,
          text: [
            `Project: ${project.name}`,
            `Status: ${project.status}`,
            project.objective ? `Objective: ${project.objective}` : "",
            project.checkpoint ? `Checkpoint: ${project.checkpoint.summary}` : "",
            project.checkpoint?.nextAction ? `Next: ${project.checkpoint.nextAction}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
      return { ok: opened.ok, message: opened.message };
    }

    if (link.kind === "task") {
      const task = TaskEngine.getInstance().get(link.id);
      if (!task) return { ok: false, message: `Task ${link.id} no longer exists.` };
      const opened = api.execute({
        action: "open-workspace",
        actor: "user",
        view: {
          id: `task-${task.id}`,
          kind: "timeline",
          title: task.goal,
          text: [
            `Task ${task.id}: ${task.goal}`,
            `Status: ${task.status}`,
            ...task.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.title || step.id}`),
          ].join("\n"),
        },
      });
      return { ok: opened.ok, message: opened.message };
    }

    if (link.kind === "conversation") {
      const opened = this.openConversation(link.id, api);
      if (opened) return opened;
    }

    const url = asUrl(link);
    if (url) {
      const opened = api.execute({
        action: "open-browser",
        actor: "user",
        view: { kind: URL_VIEW_KINDS[object.kind] ?? "browser", title: object.title, url },
      });
      return { ok: opened.ok, message: opened.message };
    }

    // A note or research object carries its own text by design: the text
    // IS the record the object was placed from.
    if (object.note || object.kind === "note" || object.kind === "research") {
      const opened = api.execute({
        action: "open-workspace",
        actor: "user",
        view: {
          kind: "file",
          title: object.title,
          text: [object.note ?? "", `Record: ${link.kind} ${link.id}`].filter(Boolean).join("\n\n"),
        },
      });
      return { ok: opened.ok, message: opened.message };
    }

    return {
      ok: false,
      message: `No reader is wired for a ${link.kind} record (${link.id.slice(0, 24)}), so nothing was opened.`,
    };
  }

  /* ---------------- internals ---------------- */

  private readRecord(object: SpatialObject): { ok: boolean; lines: string[]; openable: boolean } {
    const link = object.link;

    if (link.kind === "project") {
      const project = ProjectStore.getInstance().list().find((item) => item.id === link.id);
      if (!project) return { ok: false, lines: [`Project ${link.id} is not in the project store any more.`], openable: false };
      return {
        ok: true,
        openable: true,
        lines: [
          `Project: ${project.name}`,
          `Status: ${project.status}`,
          project.objective ? `Objective: ${clip(project.objective)}` : "",
          project.checkpoint ? `Checkpoint: ${clip(project.checkpoint.summary)}` : "",
          `${project.items.length} item${project.items.length === 1 ? "" : "s"} · updated ${new Date(project.updatedAt).toLocaleString()}`,
        ].filter(Boolean),
      };
    }

    if (link.kind === "task") {
      const task = TaskEngine.getInstance().get(link.id);
      if (!task) return { ok: false, lines: [`Task ${link.id} is not in the task engine any more.`], openable: false };
      const done = task.steps.filter((step) => step.status === "completed").length;
      return {
        ok: true,
        openable: true,
        lines: [
          `Task: ${task.goal}`,
          `Status: ${task.status}`,
          `${done}/${task.steps.length} step${task.steps.length === 1 ? "" : "s"} complete`,
        ],
      };
    }

    if (link.kind === "conversation") {
      const conversation = this.conversation(link.id);
      if (!conversation) return { ok: false, lines: [`Conversation ${link.id} is not available.`], openable: false };
      return {
        ok: true,
        openable: true,
        lines: [`Chat: ${conversation.title}`, `${conversation.messages} message${conversation.messages === 1 ? "" : "s"}`],
      };
    }

    const url = asUrl(link);
    if (url) {
      return { ok: true, openable: true, lines: [`Address: ${url}`, `Kind: ${object.kind}`] };
    }

    if (object.note) {
      return { ok: true, openable: true, lines: [clip(object.note, 400)] };
    }

    return {
      ok: false,
      lines: [`Nothing in this runtime can load a "${link.kind}" record with id ${link.id}.`],
      openable: false,
    };
  }

  /** Read-only: chat state belongs to MultiChatStore, not to the cosmos. */
  private conversation(id: string): { title: string; messages: number } | null {
    try {
      const conversation = MultiChatStore.getInstance().get(id);
      if (!conversation) return null;
      return {
        title: conversation.title || id,
        messages: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
      };
    } catch {
      return null;
    }
  }

  private openConversation(id: string, api: WorkspaceAPI): { ok: boolean; message: string } | null {
    const conversation = this.conversation(id);
    if (!conversation) return null;
    const opened = api.execute({
      action: "open-workspace",
      actor: "user",
      view: {
        kind: "activity",
        title: conversation.title,
        text: `${conversation.messages} message(s) in conversation ${id}.`,
      },
    });
    return { ok: opened.ok, message: opened.message };
  }
}
