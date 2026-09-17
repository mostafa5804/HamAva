import { repairTimeline, snapCuesToSpeech, speechTimeline, type SpeechWindow } from './timeline.ts';
import type { Cue } from './types';

/**
 * Line up model timestamps with the audio that is actually audible.
 *
 * A YouTube link is analysed by Gemini, so the returned timestamps refer to the
 * same video the player shows. A local file is different: browsers report a
 * timeline whose zero does not always match the media's own zero (container
 * edit lists, AAC priming, remuxed files), which shifts every subtitle by a
 * constant amount. Measuring the speech in the file and comparing it with the
 * returned cues recovers that constant, and snapping each cue to nearby speech
 * removes the rest of the drift.
 */

/** Refuse absurd decodes: `decodeAudioData` holds the whole file in memory. */
export const decodeByteLimit = 96 * 1024 * 1024;

export interface MediaAudioSource {
  /** A file the user picked. */
  file?: Blob | null;
  /** Playable URL of the media (blob URL or a direct link). */
  url?: string | null;
}

export async function decodeMediaAudio(ctx: BaseAudioContext, source: MediaAudioSource): Promise<AudioBuffer> {
  const bytes = source.file ? await source.file.arrayBuffer() : await readUrl(source.url);
  if (bytes.byteLength > decodeByteLimit) {
    throw new Error('فایل برای هماهنگ‌سازی خودکار بسیار بزرگ است؛ از «تأخیر زیرنویس» در تنظیمات استفاده کن.');
  }
  return ctx.decodeAudioData(bytes);
}

async function readUrl(url: string | null | undefined): Promise<ArrayBuffer> {
  const target = url?.trim();
  if (!target) throw new Error('منبع صوتی برای هماهنگ‌سازی پیدا نشد.');
  const response = await fetch(target);
  if (!response.ok) throw new Error(`خواندن صدای ویدیو برای هماهنگ‌سازی ممکن نشد (${response.status}).`);
  return response.arrayBuffer();
}

export interface SyncResult {
  /** Shift applied to every cue, in seconds (positive means cues were late). */
  offset: number;
  cues: Cue[];
  /** Spoken blocks found in the audio. */
  windows: number;
  /** Cues that had a matching spoken block nearby. */
  matched: number;
  measured: boolean;
}

/**
 * Compare cues with measured speech, shift the whole transcript by the median
 * mismatch, then snap each cue onto its spoken block.
 */
export function syncCuesToAudio(
  cues: Cue[],
  samples: ArrayLike<number>,
  sampleRate: number,
  duration: number,
): SyncResult {
  const unchanged: SyncResult = { offset: 0, cues, windows: 0, matched: 0, measured: false };
  if (!cues.length || !samples.length) return unchanged;
  const speech = speechTimeline(samples, sampleRate);
  if (speech.length < 2) return { ...unchanged, windows: speech.length };
  const deltas = cues
    .map(cue => nearestDelta(cue, speech))
    .filter((value): value is number => value !== null);
  const matched = deltas.length;
  // One or two lucky matches are not evidence; require a real pattern.
  if (matched < Math.max(3, Math.ceil(cues.length * 0.3))) {
    return { ...unchanged, windows: speech.length, matched };
  }
  const offset = clampOffset(median(deltas));
  const shifted = cues.map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
  const snapped = snapCuesToSpeech(shifted, speech);
  const repaired = repairTimeline(snapped, duration);
  return { offset, cues: repaired.length ? repaired : shifted, windows: speech.length, matched, measured: true };
}

/** Difference between a cue and the spoken block it belongs to, when close. */
function nearestDelta(cue: Cue, speech: SpeechWindow[], tolerance = 6): number | null {
  const middle = (cue.start + cue.end) / 2;
  let best: SpeechWindow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const window of speech) {
    const centre = (window.start + window.end) / 2;
    const distance = Math.abs(centre - middle);
    if (distance < bestDistance) {
      best = window;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > tolerance) return null;
  const centre = (best.start + best.end) / 2;
  // Only accept the block when its length is comparable to the cue; a cue that
  // sits inside one long block would report a meaningless delta.
  const windowLength = best.end - best.start;
  if (windowLength > Math.max(4, (cue.end - cue.start) * 3)) return null;
  return centre - middle;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A global shift beyond half a minute means the measurement went wrong. */
function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-30, Math.min(30, value));
}
