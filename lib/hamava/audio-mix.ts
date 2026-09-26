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
}

/**
 * Place every clip at its cue position on a silent timeline.
 *
 * Generated speech keeps its natural duration and starts at the cue boundary.
 * Per-cue time fitting made adjacent TTS chunks sound like they changed speed.
 */
export function mixClipsOnTimeline(clips: TimelineClip[], options: MixOptions): Float32Array {
  const rate =
    options.sampleRate && Number.isFinite(options.sampleRate) && options.sampleRate > 0
      ? options.sampleRate
      : exportSampleRate;
  const duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 0;
  const valid = clips.filter(clip => Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.start >= 0 && clip.end > clip.start);
  const longest = valid.reduce((end, clip) => Math.max(end, clip.start + clip.samples.length / Math.max(1, clip.sampleRate)), 0);
  const length = Math.ceil(Math.max(duration, longest) * rate);
  if (length > rate * 60 * 60) throw new Error('خروجی صوتی بیش از یک ساعت است؛ برای جلوگیری از پرشدن حافظه، فایل را به بخش‌های کوتاه‌تر تقسیم کن.');
  const output = new Float32Array(Math.max(1, length));
  const ordered = [...valid]
    .filter(clip => clip.samples.length > 0 && clip.end > clip.start)
    .sort((a, b) => a.start - b.start);
  for (const clip of ordered) {
    const from = Math.max(0, Math.round(clip.start * rate));
    const natural = resamplePCM(clip.samples, clip.sampleRate, rate);
    for (let index = 0; index < natural.length; index++) {
      const at = from + index;
      if (at >= output.length) break;
      // Keep the generated tempo; mix any unavoidable overlap without clipping.
      output[at] = softLimit(output[at] + natural[index]);
    }
  }
  return output;
}

/** Resample while preserving playback duration and pitch. */
export function resamplePCM(samples: ArrayLike<number>, sourceRate: number, targetRate: number): Float32Array {
  const source = Math.max(1, Number.isFinite(sourceRate) && sourceRate > 0 ? sourceRate : targetRate);
  const target = Math.max(1, Number.isFinite(targetRate) && targetRate > 0 ? targetRate : source);
  const length = Math.max(0, Math.round(samples.length * target / source));
  if (source === target) return Float32Array.from(samples);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = index * source / target;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    const a = Number(samples[left]) || 0;
    const b = Number(samples[right]) || 0;
    output[index] = a + (b - a) * fraction;
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
  const naturalLength = Math.max(1, Math.round(samples.length * targetRate / source));
  const natural = new Float32Array(naturalLength);
  const ratio = source / targetRate;
  for (let index = 0; index < natural.length; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    if (left >= samples.length) break;
    const a = Number(samples[left]) || 0;
    const b = Number(samples[right]) || 0;
    natural[index] = a + (b - a) * fraction;
  }
  return stretchPCM(natural, out.length, targetRate);
}

/** Waveform-similarity overlap/add: fit speech without resampling its pitch. */
export function stretchPCM(input: Float32Array, length: number, rate: number): Float32Array {
  const output = new Float32Array(length);
  const frame = Math.max(4, Math.round(rate * .04 / 2) * 2);
  const hop = frame / 2, search = Math.round(rate * .01);
  if (input.length === length) return input.slice();
  if (input.length < frame || length < frame) {
    // Tiny clips contain no complete speech window; retain all samples.
    for (let i = 0; i < length; i++) output[i] = input[Math.min(input.length - 1, Math.floor(i * input.length / length))] || 0;
    return output;
  }
  output.set(input.subarray(0, frame));
  let previous = 0;
  for (let at = hop; at < length; at += hop) {
    const expected = Math.min(input.length - frame, Math.round(at * input.length / length));
    let best = expected, score = -Infinity;
    const lo = Math.max(previous, expected - search), hi = Math.min(input.length - frame, expected + search);
    for (let candidate = lo; candidate <= hi; candidate += 4) {
      let dot = 0, aa = 0, bb = 0;
      for (let j = 0; j < hop && at + j < length; j += 8) {
        const a = output[at + j], b = input[candidate + j];
        dot += a * b; aa += a * a; bb += b * b;
      }
      const correlation = dot / Math.sqrt(aa * bb + 1e-12) - Math.abs(candidate - expected) * 1e-7;
      if (correlation > score) { score = correlation; best = candidate; }
    }
    // Include the end of the utterance, even when heavily compressed.
    if (at + frame >= length) best = Math.max(0, input.length - (length - at));
    for (let j = 0; j < frame && at + j < length && best + j < input.length; j++) {
      const blend = j < hop ? j / hop : 1;
      output[at + j] = output[at + j] * (1 - blend) + input[best + j] * blend;
    }
    previous = best;
  }
  return output;
}

function softLimit(value: number): number {
  return Math.max(-1, Math.min(1, value));
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
