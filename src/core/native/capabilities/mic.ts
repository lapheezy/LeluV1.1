/**
 * ==========================================================
 * LÉLU
 * MICROPHONE CAPABILITY — real capture through the EXISTING
 * voice audio pipeline (audioRecorder.ts + speechToText.ts).
 *
 *   execute({ probe: true })            — open stream, measure
 *                                        real RMS levels, stop
 *   execute({ recordMs, transcribe })   — record real audio,
 *                                        transcribe via the same
 *                                        Groq Whisper path the
 *                                        voice loop uses
 *
 * The full two-way voice conversation stays in VoiceEngine.
 * This capability is the "device intent" path LÉLU can call
 * through ToolResolver (e.g. "record a note").
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import {
  createLevelMeter,
  MediaRecorderCapture,
  pickRecorderMimeType,
  mediaRecorderSupported,
  wavCaptureSupported,
  type LevelMeterHandle,
} from "../../voice/audioRecorder";
import { transcribeAudio } from "../../voice/speechToText";
import { hasMediaDevices, isSecureContext, queryPermission, wait } from "./helpers";

async function captureLevels(durationMs: number): Promise<number> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    let maxRms = 0;
    let samples = 0;
    await new Promise<void>((resolve) => {
      const meter: LevelMeterHandle = createLevelMeter(stream, (rms) => {
        maxRms = Math.max(maxRms, rms);
        samples += 1;
      });
      meter.start();
      wait(durationMs).then(() => {
        meter.stop();
        resolve();
      });
    });
    return samples > 0 ? maxRms : 0;
  } finally {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // already ended
      }
    }
  }
}

async function recordAndTranscribe(recordMs: number): Promise<{
  durationMs: number;
  transcript: string;
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    if (!mediaRecorderSupported() && !wavCaptureSupported()) {
      throw new Error("No audio recorder available in this browser.");
    }
    const mime = pickRecorderMimeType();
    const recorder = new MediaRecorderCapture(stream, mime);
    recorder.start();
    await wait(recordMs);
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) {
      throw new Error("No audio was captured.");
    }
    const transcript = await transcribeAudio(blob);
    return { durationMs: recordMs, transcript };
  } finally {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // already ended
      }
    }
  }
}

export const microphoneCapability: NativeCapability = {
  id: "microphone.capture",
  title: "Microphone",
  category: "input",
  requiredPermission: "microphone",
  unavailableReason:
    "Microphone capture is not available in this browser (needs getUserMedia over HTTPS).",
  isAvailable(): boolean {
    return hasMediaDevices() && isSecureContext();
  },
  permissionState(): Promise<PermissionState> {
    return queryPermission("microphone");
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const recordMs = Math.min(15000, Number(payload.recordMs ?? 0));
    const transcribe = Boolean(payload.transcribe);

    if (recordMs > 0 && transcribe) {
      const captured = await recordAndTranscribe(recordMs);
      return { ok: true, result: captured };
    }

    const maxRms = await captureLevels(1200);
    return {
      ok: true,
      result: {
        probed: true,
        maxRms: Number(maxRms.toFixed(4)),
        captureSupported: hasMediaDevices(),
      },
    };
  },
};
