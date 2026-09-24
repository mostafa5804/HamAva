import {
  encodeWav,
  exportSampleRate,
  mixClipsOnTimeline,
  monoFromAudioBuffer,
  type TimelineClip,
} from './audio-mix.ts';

export { downloadName } from './audio-mix.ts';

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox needs the URL to exist for a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface DubTrackRequest {
  clips: { start: number; end: number; url: string; blob?: Blob }[];
  duration: number;
  /** Decoder from the live engine or a temporary context. */
  decodeAudio: (buffer: ArrayBuffer) => Promise<AudioBuffer>;
  sampleRate?: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Render every prepared clip into a single, timeline-accurate audio file.
 * Works for YouTube as well, where nothing else can be captured.
 */
export async function renderDubbingTrack(request: DubTrackRequest): Promise<{ blob: Blob; seconds: number }> {
  const rate = request.sampleRate ?? exportSampleRate;
  const timeline: TimelineClip[] = [];
  for (let index = 0; index < request.clips.length; index++) {
    request.signal?.throwIfAborted();
    const clip = request.clips[index];
    try {
      const data = clip.blob ? await clip.blob.arrayBuffer() : await (async () => {
        const response = await fetch(clip.url, { signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })();
      const buffer = await request.decodeAudio(data);
      timeline.push({
        start: clip.start,
        end: clip.end,
        samples: monoFromAudioBuffer(buffer),
        sampleRate: buffer.sampleRate,
      });
    } catch (error) {
      request.signal?.throwIfAborted();
      throw new Error(`خواندن بخش ${index + 1} دوبله ممکن نشد؛ فایل ناقص صادر نشد.`, { cause: error });
    }
    request.onProgress?.(((index + 1) / Math.max(1, request.clips.length)) * 100);
  }
  request.signal?.throwIfAborted();
  if (!timeline.length) throw new Error('صدای دوبله‌ای برای دانلود آماده نشده است. اول دوبله را آماده کن.');
  const samples = mixClipsOnTimeline(timeline, { duration: request.duration, sampleRate: rate });
  return { blob: encodeWav(samples, rate), seconds: samples.length / rate };
}
