import type { Cue } from './types';

/**
 * Timing helpers shared by the local-media and YouTube preparation paths.
 *
 * Local files used to rely on the live translation socket, so every subtitle
 * inherited the network round trip as a delay and long files lost their tail.
 * The functions here keep cue windows anchored to the real media timeline:
 * a file is analysed by Gemini with explicit time ranges, the returned cues are
 * clamped to the media duration, and, when the user asks for it, cue boundaries
 * are snapped onto the speech that was actually measured in the audio.
 */

export interface MediaProbe {
  /** Lower-case MIME type reported by the browser or derived from the name. */
  mime: string;
  /** `audio` files are sent to Gemini as audio, everything else as video. */
  kind: 'audio' | 'video';
  size: number;
  name: string;
}

const audioMimes = ['audio/', 'application/ogg'];
const audioExtensions = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'];
const videoExtensions = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'ts', 'm4s'];

export function probeMediaFile(file: { name?: string; size?: number; type?: string }): MediaProbe {
  const name = String(file?.name ?? '').trim() || 'media';
  const size = Number.isFinite(Number(file?.size)) ? Math.max(0, Number(file?.size)) : 0;
  const reported = String(file?.type ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mime =
    reported && reported !== 'application/octet-stream'
      ? reported
      : extension
        ? guessMime(extension)
        : 'application/octet-stream';
  const kind: MediaProbe['kind'] =
    audioMimes.some(prefix => mime.startsWith(prefix)) || audioExtensions.includes(extension)
      ? 'audio'
      : 'video';
  return { mime, kind, size, name };
}

function guessMime(extension: string): string {
  if (audioExtensions.includes(extension)) return `audio/${extension === 'oga' ? 'ogg' : extension}`;
  if (videoExtensions.includes(extension)) return `video/${extension === 'mkv' ? 'x-matroska' : extension}`;
  return 'application/octet-stream';
}

/**
 * Inline requests carry the whole media as base64 inside the JSON body, so the
 * encoded payload must stay well below the request limit. Larger files go
 * through the Files API upload instead.
 */
export const inlineMediaBudget = 14_000_000;

/** A single request never asks the model to describe more than this range. */
export const analysisWindowSeconds = 900;
/** Automatic continuation stops here so a long film cannot spend the quota. */
export const maxAnalysisRequests = 12;

export function canSendInline(probe: MediaProbe, budget = inlineMediaBudget): boolean {
  // base64 inflates the payload by 4/3; keep room for the header and prompt.
  return probe.size > 0 && probe.size * (4 / 3) + 2000 <= budget;
}

export function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
}

export function inlineTooLargeMessage(size: number, budget = inlineMediaBudget): string {
  const limit = Math.max(1, Math.floor(budget / (4 / 3) / 1_000_000));
  return `این فایل ${megabytes(size)} مگابایت است و برای ارسال مستقیم به Gemini بزرگ است (سقف حدود ${limit} مگابایت). فایل را کوتاه‌تر یا کم‌حجم‌تر کن، یا همان ویدیو را از بخش یوتیوب وارد کن.`;
}

export interface AnalysisWindow {
  from: number;
  to: number;
}

/**
 * Split the media into windows that each fit comfortably in one answer.
 * The last window absorbs the remainder so no window is a few seconds long.
 */
export function planWindows(from: number, to: number, limit = analysisWindowSeconds): AnalysisWindow[] {
  const start = Math.max(0, Number.isFinite(from) ? from : 0);
  const end = Math.max(start, Number.isFinite(to) ? to : start);
  if (end - start <= limit) return [{ from: start, to: end }];
  const count = Math.ceil((end - start) / limit);
  const size = (end - start) / count;
  return Array.from({ length: count }, (_, index) => ({
    from: start + index * size,
    to: index === count - 1 ? end : start + (index + 1) * size,
  }));
}

/**
 * Follow-up window for the part of the media the model did not describe.
 * `covered` is the end of the last usable cue.
 */
export function nextWindow(
  covered: number,
  duration: number,
  limit = analysisWindowSeconds,
): AnalysisWindow | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const from = Math.max(0, Math.min(covered, duration - 1));
  // Ignore a tail shorter than this: the last words rarely sit in the final second.
  if (duration - from < 15) return null;
  return { from, to: Math.min(duration, from + limit) };
}

/**
 * Keep a cue list usable on the real media timeline: sorted, inside the media,
 * and never overlapping. Malformed entries are dropped instead of failing a
 * whole transcript that is otherwise fine.
 */
export function repairTimeline(cues: Cue[], duration: number, window?: AnalysisWindow): Cue[] {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const from = window ? Math.max(0, window.from) : 0;
  const cleaned = cues
    .map(cue => ({
      ...cue,
      start: Number(cue.start),
      end: Number(cue.end),
      translation: String(cue.translation ?? '').trim(),
      source: String(cue.source ?? '').trim(),
    }))
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .filter(cue => cue.translation !== '')
    // A cue that starts after the media ends, or before the analysed window,
    // belongs to a hallucinated or localised timeline; drop it.
    .filter(cue => cue.start >= from - 0.5 && cue.start < limit)
    .map(cue => ({
      ...cue,
      start: Math.max(0, Math.min(cue.start, limit)),
      end: Math.max(0, Math.min(cue.end, limit)),
    }))
    .filter(cue => cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
  // Overlapping cues make the player pick the wrong line; trim the earlier one
  // to the start of the next, exactly like `validateCues` does.
  const separated = cleaned
    .map((item, index) => ({ ...item, end: cleaned[index + 1] ? Math.min(item.end, cleaned[index + 1].start) : item.end }))
    .filter(item => item.end > item.start);
  return separated;
}

/** Merge transcripts produced for separate windows into one ordered timeline. */
export function mergeTranscripts(chunks: Cue[][], duration: number, window?: AnalysisWindow): Cue[] {
  const flat: Cue[] = [];
  for (const chunk of chunks) flat.push(...chunk);
  return repairTimeline(flat, duration, window);
}

export interface SpeechWindow {
  start: number;
  end: number;
}

export interface SpeechTimelineOptions {
  /** Linear RMS (0..1) a frame must exceed to count as speech. */
  threshold?: number;
  frameSeconds?: number;
  /** Silence that separates two spoken blocks. */
  minSilence?: number;
  /** Blocks shorter than this are noise, not speech. */
  minSpeech?: number;
}

/**
 * Turn a mono sample stream into the ranges that actually contain speech.
 * Used to verify and repair model timestamps against the real audio.
 */
export function speechTimeline(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: SpeechTimelineOptions = {},
): SpeechWindow[] {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16_000;
  const threshold = options.threshold ?? 0.012;
  const frameSeconds = Math.max(0.01, options.frameSeconds ?? 0.05);
  const minSilence = options.minSilence ?? 0.35;
  const minSpeech = options.minSpeech ?? 0.2;
  const frameSize = Math.max(1, Math.round(frameSeconds * rate));
  const frames = Math.ceil(samples.length / frameSize);
  const windows: SpeechWindow[] = [];
  let current: SpeechWindow | null = null;
  let silence = 0;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * frameSize;
    const size = Math.min(frameSize, samples.length - offset);
    let sum = 0;
    for (let index = 0; index < size; index++) {
      const value = Number(samples[offset + index]) || 0;
      sum += value * value;
    }
    const rms = size ? Math.sqrt(sum / size) : 0;
    const at = offset / rate;
    if (rms >= threshold) {
      silence = 0;
      if (!current) current = { start: at, end: at + frameSeconds };
      else current.end = at + frameSeconds;
      continue;
    }
    if (!current) continue;
    silence += frameSeconds;
    if (silence >= minSilence) {
      if (current.end - current.start >= minSpeech) windows.push(current);
      current = null;
      silence = 0;
    }
  }
  if (current && current.end - current.start >= minSpeech) windows.push(current);
  return windows;
}

/**
 * Move cue boundaries onto measured speech. A cue is only shifted when a nearby
 * spoken block exists, so silent gaps (intros, music, pauses) stay untouched.
 */
export function snapCuesToSpeech(cues: Cue[], speech: SpeechWindow[], tolerance = 1.2): Cue[] {
  if (!cues.length || !speech.length) return cues;
  const sorted = [...speech].sort((a, b) => a.start - b.start);
  return cues.map(cue => {
    let best: SpeechWindow | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const window of sorted) {
      const distance =
        window.end <= cue.start
          ? cue.start - window.end
          : window.start >= cue.end
            ? window.start - cue.end
            : 0;
      // Ties go to the earlier block so a cue never jumps into the next sentence.
      if (distance < bestDistance || (distance === bestDistance && best && window.start < best.start)) {
        best = window;
        bestDistance = distance;
      }
    }
    if (!best || bestDistance > tolerance) return cue;
    const start = best.start >= cue.start - tolerance ? best.start : cue.start;
    const end = cue.end > best.end + tolerance ? best.end : Math.max(best.end, cue.end);
    if (end - start < 0.2) return cue;
    return { ...cue, start, end };
  });
}

/** How much of the media the transcript describes (0..1). */
export function transcriptCoverage(cues: Cue[], duration: number): number {
  if (!cues.length || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, cues.at(-1)!.end / duration));
}

/** True when a transcript stops well before the end of the media. */
export function isTranscriptIncomplete(cues: Cue[], duration: number, slack = 20): boolean {
  if (!cues.length) return true;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return duration - cues.at(-1)!.end > slack;
}
