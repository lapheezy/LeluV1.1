/**
 * ==========================================================
 * LÉLU
 * VIDEO PROJECT — video creation architecture (V1)
 *
 * The Video workspace is organized around the full pipeline:
 *
 *   Video Project → Storyboard → Scenes → Assets → Timeline
 *                   → Audio → Animation → Render
 *
 * V1 delivers the architecture, project model, UI, asset
 * management, and provider abstraction. Actual video encoding
 * / cloud generation is PROVIDER-DEPENDENT and clearly marked
 * in the UI — never faked.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface VideoShot {
  id: string;
  title: string;
  description: string;
  durationSec: number;
  /** Storyboard frame asset id (optional). */
  frameAssetId?: string;
  /** Scene ids this shot belongs to. */
  sceneIds: string[];
}

export interface VideoScene {
  id: string;
  title: string;
  description: string;
  shotIds: string[];
  assetIds: string[];
  animationNotes: string;
}

export type VideoAssetKind = "image" | "audio" | "video" | "text";

export interface VideoAsset {
  id: string;
  kind: VideoAssetKind;
  name: string;
  /** Data URL for image/video/audio content. */
  ref?: string;
  /** Text payload for text assets (captions, voice-over scripts). */
  text?: string;
}

export interface TimelineItem {
  id: string;
  assetId?: string;
  startSec: number;
  durationSec: number;
  note?: string;
}

export interface TimelineTrack {
  id: string;
  name: string;
  kind: "visual" | "audio" | "text";
  items: TimelineItem[];
}

export interface VideoProject {
  id: string;
  name: string;
  description: string;
  concept: string;
  status: "draft" | "in-progress" | "render-ready" | "rendered";
  shots: VideoShot[];
  scenes: VideoScene[];
  assets: VideoAsset[];
  timeline: TimelineTrack[];
  audio: { voiceOver?: string; musicRef?: string; notes: string };
  render: {
    engine: string | null;
    status: "idle" | "queued" | "rendering" | "done" | "failed";
    output?: string;
    error?: string;
    updatedAt?: number;
  };
  createdAt: number;
  updatedAt: number;
}

type Listener = (projects: VideoProject[]) => void;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyVideoProject(name: string): VideoProject {
  const now = Date.now();
  return {
    id: makeId("video"),
    name,
    description: "",
    concept: "",
    status: "draft",
    shots: [],
    scenes: [],
    assets: [],
    timeline: [
      { id: makeId("track"), name: "Visual", kind: "visual", items: [] },
      { id: makeId("track"), name: "Audio", kind: "audio", items: [] },
      { id: makeId("track"), name: "Text", kind: "text", items: [] },
    ],
    audio: { notes: "" },
    render: { engine: null, status: "idle" },
    createdAt: now,
    updatedAt: now,
  };
}

export default class VideoStore {
  private static instance: VideoStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): VideoStore {
    if (!VideoStore.instance) {
      VideoStore.instance = new VideoStore();
    }
    return VideoStore.instance;
  }

  private static readonly KEY = "videos.v1";

  public list(): VideoProject[] {
    const projects = this.kv.get<VideoProject[]>(VideoStore.KEY) ?? [];
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.list());
      } catch (error) {
        console.error("[Lélu VideoStore] listener threw (contained)", error);
      }
    }
  }

  public get(id: string): VideoProject | undefined {
    return this.list().find((project) => project.id === id);
  }

  private persist(projects: VideoProject[]): void {
    this.kv.set(VideoStore.KEY, projects);
    this.notify();
  }

  private mutate(mutator: (projects: VideoProject[]) => VideoProject[]): void {
    this.persist(mutator(this.list()));
  }

  public create(name: string, description = ""): VideoProject {
    const project = emptyVideoProject(name);
    project.description = description;
    this.persist([project, ...this.list()]);
    return project;
  }

  public update(id: string, patch: Partial<VideoProject>): VideoProject | undefined {
    let updated: VideoProject | undefined;
    this.mutate((projects) =>
      projects.map((project) => {
        if (project.id !== id) {
          return project;
        }
        updated = { ...project, ...patch, id: project.id, createdAt: project.createdAt, updatedAt: Date.now() };
        return updated;
      }),
    );
    return updated;
  }

  public remove(id: string): void {
    this.mutate((projects) => projects.filter((project) => project.id !== id));
  }

  /* ------------------------- project structure ------------------------- */

  public addShot(projectId: string, title: string, description = "", durationSec = 5): VideoShot | undefined {
    const project = this.get(projectId);
    if (!project) {
      return undefined;
    }
    const shot: VideoShot = {
      id: makeId("shot"),
      title,
      description,
      durationSec,
      sceneIds: [],
    };
    this.update(projectId, { shots: [...project.shots, shot] });
    return shot;
  }

  public addScene(projectId: string, title: string, description = ""): VideoScene | undefined {
    const project = this.get(projectId);
    if (!project) {
      return undefined;
    }
    const scene: VideoScene = {
      id: makeId("scene"),
      title,
      description,
      shotIds: [],
      assetIds: [],
      animationNotes: "",
    };
    this.update(projectId, { scenes: [...project.scenes, scene] });
    return scene;
  }

  public addAsset(
    projectId: string,
    input: { kind: VideoAssetKind; name: string; ref?: string; text?: string },
  ): VideoAsset | undefined {
    const project = this.get(projectId);
    if (!project) {
      return undefined;
    }
    const asset: VideoAsset = { id: makeId("asset"), ...input };
    this.update(projectId, { assets: [...project.assets, asset] });
    return asset;
  }

  /** Add a shot from a text prompt as a storyboard frame (structured concept). */
  public addStoryboardShot(
    projectId: string,
    title: string,
    description: string,
  ): VideoShot | undefined {
    const project = this.get(projectId);
    if (!project) {
      return undefined;
    }
    const shot = this.addShot(projectId, title, description);
    if (!shot) {
      return undefined;
    }
    // Storyboard frame generation is PROVIDER-DEPENDENT — the shot is
    // the structured concept; the visual frame needs a render engine.
    this.update(projectId, { status: "in-progress" });
    return shot;
  }

  public removeShot(projectId: string, shotId: string): void {
    const project = this.get(projectId);
    if (!project) {
      return;
    }
    this.update(projectId, { shots: project.shots.filter((shot) => shot.id !== shotId) });
  }

  /** Mark the project render-ready when shots + assets + timeline exist. */
  public refreshStatus(projectId: string): void {
    const project = this.get(projectId);
    if (!project) {
      return;
    }
    const hasShots = project.shots.length > 0;
    const hasAssets = project.assets.length > 0;
    const hasTimeline = project.timeline.some((track) => track.items.length > 0);
    const status = hasShots && hasAssets && hasTimeline ? "render-ready" : project.status === "rendered" ? "rendered" : "in-progress";
    this.update(projectId, { status });
  }
}
