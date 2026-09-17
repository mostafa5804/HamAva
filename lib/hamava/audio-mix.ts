/**
 * Offline audio assembly for downloads.
 *
 * The player mixes the dub in real time while the video plays, which cannot be
 * turned into a file for a YouTube video (its media lives in a cross-origin
 * iframe). The functions here build the Persian dubbing track from the prepared
 * clips instead, so an accurate audio file can be downloaded for any source and
 * then muxed with the video the user already owns.
 */

export const exportSampleRate = 24_000;

export interface TimelineClip {
  start: number;
  end: number;
  samples: ArrayLike<number>;
  /** Sample rate of `samples`; resampled to the output rate when it differs. */
  sampleRate: number;
}

export interface MixOptions {
  duration: number;
  sampleRate?: number;
  /** Safety margin so a slightly long clip never crosses into the next one. */
  clipGapSeconds?: number;
}

/**
 * Place every clip at its cue position on a silent timeline.
 *
 * A clip is time-fitted to its cue window, exactly like playback does, so the
 * exported audio stays aligned with the video even when the synthesised speech
 * is longer or shorter than the original sentence.
 */
export function mixClipsOnTimeline(clips: TimelineClip[], options: MixOptions): Float32Array {
  const rate =
    options.sampleRate && Number.isFinite(options.sampleRate) && options.sampleRate > 0
      ? options.sampleRate
      : exportSampleRate;
  const gap = Math.max(0, options.clipGapSeconds ?? 0.05);
  const duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 0;
  const longest = clips.reduce((end, clip) => Math.max(end, clip.end), 0);
  const length = Math.ceil(Math.max(duration, longest) * rate);
  const output = new Float32Array(Math.max(1, length));
  const ordered = [...clips]
    .filter(clip => clip.samples.length > 0 && clip.end > clip.start)
    .sort((a, b) => a.start - b.start);
  for (const clip of ordered) {
    const from = Math.max(0, Math.round(clip.start * rate));
    const windowSeconds = Math.max(0.05, clip.end - clip.start - gap);
    const fitted = fitToWindow(clip.samples, clip.sampleRate, windowSeconds, rate);
    for (let index = 0; index < fitted.length; index++) {
      const at = from + index;
      if (at >= output.length) break;
      // Overlapping clips are summed with a soft limiter instead of clipping.
      output[at] = softLimit(output[at] + fitted[index]);
    }
  }
  return output;
}

/** Resample to the output rate and squeeze or pad the clip into its window. */
export function fitToWindow(
  samples: ArrayLike<number>,
  sourceRate: number,
  windowSeconds: number,
  targetRate: number,
): Float32Array {
  const source = Math.max(1, Number.isFinite(sourceRate) && sourceRate > 0 ? sourceRate : targetRate);
  const target = Math.max(1, windowSeconds * targetRate);
  const out = new Float32Array(Math.ceil(target));
  if (!samples.length) return out;
  const ratio = source / targetRate;
  for (let index = 0; index < out.length; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    if (left >= samples.length) break;
    const a = Number(samples[left]) || 0;
    const b = Number(samples[right]) || 0;
    out[index] = a + (b - a) * fraction;
  }
  return out;
}

function softLimit(value: number): number {
  if (value > 1) return 1 - 1 / (1 + (value - 1) * 4);
  if (value < -1) return -1 + 1 / (1 + (-value - 1) * 4);
  return value;
}

/** Mono mixdown of a decoded buffer, ready for the exporter. */
export function monoFromAudioBuffer(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return Float32Array.from(buffer.getChannelData(0));
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) out[index] += data[index] / channels;
  }
  return out;
}

/**
 * 16-bit PCM WAV. Written by hand because `MediaRecorder` cannot emit WAV and
 * an audio file is far smaller than a re-encoded video.
 */
export function encodeWav(samples: ArrayLike<number>, sampleRate = exportSampleRate, channels = 1): Blob {
  const count = Math.max(0, samples.length);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, Math.max(1, channels), true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * Math.max(1, channels) * 2, true);
  view.setUint16(32, Math.max(1, channels) * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Keep a download name safe on every platform without losing the media name. */
export function downloadName(base: string, suffix: string, extension: string): string {
  const stem =
    String(base ?? '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'HamAva';
  return `${stem} - ${suffix}.${extension}`;
}

/** `mm:ss` used in download names and progress notices. */
export function clockLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}