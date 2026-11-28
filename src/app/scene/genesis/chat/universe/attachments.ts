/**
 * Turning picked files into what a chat message carries, shared by every composer (the Chat Universe and
 * the core chat box in the Cosmos), so a photo or a document attaches the same way everywhere.
 * - Images and video → processed media (core/media/mediaProcessor).
 * - Text-like files → a readable preview (first 800 characters).
 * - 3D files (GLB, glTF, STL, OBJ) → their own bytes, so the reply can open them in three.js.
 */

import { processImageFile, processVideoFile, type ProcessedMedia } from "../../../../../core/media/mediaProcessor";

export interface ChatFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview: string;
  /** A 3D file's own bytes, so the reply can show it in three.js. */
  dataUrl?: string;
}

export const MODEL_UPLOAD_LIMIT = 24 * 1024 * 1024;

export async function prepareAttachments(files: FileList | File[] | null, max = 4): Promise<{ media: ProcessedMedia[]; files: ChatFile[]; notices: string[] }> {
  const media: ProcessedMedia[] = [];
  const out: ChatFile[] = [];
  const notices: string[] = [];
  for (const file of [...(files ?? [])].slice(0, max)) {
    try {
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        media.push(file.type.startsWith("video/") ? await processVideoFile(file) : await processImageFile(file));
        continue;
      }
      let preview = "";
      const textLike =
        file.size < 512 * 1024 &&
        (/^text\/|json|javascript|typescript|xml|yaml|markdown|html|css|svg/.test(file.type) ||
          /\.(txt|md|json|js|ts|tsx|jsx|py|css|html|xml|yml|yaml|csv|log|env|gitignore)$/i.test(file.name));
      if (textLike) preview = (await file.text()).slice(0, 800);
      let dataUrl: string | undefined;
      if (/\.(glb|gltf|stl|obj)$/i.test(file.name)) {
        if (file.size > MODEL_UPLOAD_LIMIT) {
          notices.push(`${file.name} is larger than ${Math.round(MODEL_UPLOAD_LIMIT / 1024 / 1024)} MB — it was attached by name only, so it cannot be previewed.`);
        } else {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("the file could not be read"));
            reader.readAsDataURL(file);
          });
        }
      }
      out.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, preview, ...(dataUrl ? { dataUrl } : {}) });
    } catch (error) {
      notices.push(`Could not attach ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { media, files: out, notices };
}
