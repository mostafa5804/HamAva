import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSendInline,
  inlineTooLargeMessage,
  isTranscriptIncomplete,
  mergeTranscripts,
  nextWindow,
  planWindows,
  probeMediaFile,
  repairTimeline,
  snapCuesToSpeech,
  speechTimeline,
  transcriptCoverage,
} from '../lib/hamava/timeline.ts';
import { syncCuesToAudio } from '../lib/hamava/sync.ts';
import { encodeWav, fitToWindow, mixClipsOnTimeline, downloadName, clockLabel } from '../lib/hamava/audio-mix.ts';
import { collectCues, translateMedia } from '../lib/hamava/gemini.ts';
import { defaults, type Cue } from '../lib/hamava/types.ts';

const cue = { start: 0, end: 2, source: 'Hello', translation: 'سلام', speaker: 'a', voice: 'female' } as Cue;

test('media probe classifies audio and video files and keeps unknown types', () => {
  assert.equal(probeMediaFile({ name: 'song.mp3', size: 10, type: '' }).kind, 'audio');
  assert.equal(probeMediaFile({ name: 'clip.mkv', size: 10, type: '' }).mime, 'video/x-matroska');
  assert.equal(probeMediaFile({ name: 'movie.mp4', size: 5, type: 'video/mp4' }).mime, 'video/mp4');
  assert.equal(probeMediaFile({ name: 'noext', size: 0 }).mime, 'application/octet-stream');
  assert.ok(canSendInline(probeMediaFile({ name: 'a.mp4', size: 1_000_000 })));
  assert.ok(!canSendInline(probeMediaFile({ name: 'a.mp4', size: 40_000_000 })));
  assert.ok(inlineTooLargeMessage(40_000_000).includes('بزرگ'));
});

test('planned windows cover the media once and continuation never repeats work', () => {
  assert.deepEqual(planWindows(0, 30), [{ from: 0, to: 30 }]);
  const windows = planWindows(0, 1900);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].from, 0);
  assert.equal(windows.at(-1)!.to, 1900);
  assert.ok(windows.every(w => w.to > w.from));
  assert.equal(nextWindow(28, 30), null, 'a 2s tail is not worth another request');
  assert.deepEqual(nextWindow(20, 100), { from: 20, to: 100 });
});

test('repairTimeline clamps to the media, drops empties and resolves overlaps', () => {
  const repaired = repairTimeline([
    { ...cue, start: 12, end: 20 },
    { ...cue, start: 5, end: 4 },
    { ...cue, start: 2, end: 3, translation: '  ' },
    { ...cue, start: 1, end: 13 },
    { ...cue, start: 900, end: 950 },
  ], 100);
  assert.deepEqual(repaired.map(item => [item.start, item.end]), [[1, 12], [12, 20]]);
  assert.ok(repaired.every(item => item.end <= 100));
});

test('mergeTranscripts joins chunked analysis into one ordered timeline', () => {
  const merged = mergeTranscripts([[{ ...cue, start: 10, end: 12 }], [{ ...cue, start: 0, end: 9 }]], 30);
  assert.equal(merged.length, 2);
  assert.ok(merged[0].start < merged[1].start);
});

test('speechTimeline finds spoken blocks separated by silence', () => {
  const rate = 1000; // 1 kHz for easy sample arithmetic
  const samples = new Float32Array(10_000);
  const speak = (from: number, to: number) => { for (let i = from; i < to; i++) samples[i] = 0.5; };
  speak(500, 1500); // 0.5s..1.5s
  speak(4000, 6000); // 4s..6s
  const windows = speechTimeline(samples, rate, { threshold: 0.05, frameSeconds: 0.05, minSilence: 0.4, minSpeech: 0.3 });
  assert.equal(windows.length, 2);
  assert.ok(Math.abs(windows[0].start - 0.5) < 0.1);
  assert.ok(Math.abs(windows[1].end - 6) < 0.15);
  assert.equal(speechTimeline(new Float32Array(1000), rate).length, 0);
});

test('cues snap onto measured speech without inventing movement in silence', () => {
  const speech = [{ start: 10, end: 14 }, { start: 20, end: 24 }];
  const snapped = snapCuesToSpeech([cue, { ...cue, start: 10.6, end: 13.4 }], speech, 1.5);
  assert.equal(snapped[0].start, 0, 'no spoken block nearby: untouched');
  assert.equal(snapped[1].start, 10, 'pulled back onto the spoken block');
  assert.equal(snapped[1].end, 14);
  assert.equal(snapCuesToSpeech([], speech).length, 0);
});

test('coverage reports how much of the media the transcript explains', () => {
  assert.equal(transcriptCoverage([], 100), 0);
  assert.equal(transcriptCoverage([{ ...cue, start: 0, end: 80 }], 100), 0.8);
  assert.ok(!isTranscriptIncomplete([{ ...cue, start: 0, end: 95 }], 100));
  assert.ok(isTranscriptIncomplete([{ ...cue, start: 0, end: 50 }], 100));
  assert.ok(isTranscriptIncomplete([], 100));
});

test('syncCuesToAudio shifts a late transcript onto the measured speech', () => {
  // Speech blocks every ~5s starting at t=5; the model reported them 2s late.
  const rate = 1000;
  const samples = new Float32Array(40_000);
  for (let block = 0; block < 7; block++) {
    const from = (5 + block * 5) * rate, to = from + 2 * rate;
    for (let i = from; i < to; i++) samples[i] = 0.6;
  }
  const cues: Cue[] = Array.from({ length: 7 }, (_, index) => ({
    ...cue,
    start: 7 + index * 5, // reported 2s later than the real speech
    end: 9 + index * 5,
    translation: `جمله ${index}`,
  }));
  const result = syncCuesToAudio(cues, samples, rate, 40);
  assert.equal(result.measured, true);
  assert.ok(Math.abs(result.offset + 2) < 0.3, `offset ${result.offset} should be about -2s`);
  assert.ok(Math.abs(result.cues[0].start - 5) < 0.6);
  // A transcript with no relation to the audio stays untouched.
  const unrelated = syncCuesToAudio([cue], samples, rate, 40);
  assert.equal(unrelated.measured, false);
});

test('the offline mixer places clips at their cues and fits them to the window', () => {
  const tone = (rate: number, seconds: number, value = 0.5) => new Float32Array(Math.round(rate * seconds)).fill(value);
  const mixed = mixClipsOnTimeline([
    { start: 1, end: 3, samples: tone(1000, 4), sampleRate: 1000 },
    { start: 4, end: 5, samples: tone(2000, 1, 0.9), sampleRate: 2000 },
  ], { duration: 6, sampleRate: 1000 });
  assert.equal(mixed.length, 6000);
  assert.equal(mixed[500], 0, 'silence before the first cue');
  assert.ok(Math.abs(mixed[1500] - 0.5) < 0.01);
  assert.ok(Math.abs(mixed[4500] - 0.9) < 0.001, 'second clip lands at its own cue');
  const fitted = fitToWindow(tone(1000, 4), 1000, 2, 1000);
  assert.equal(fitted.length, 2000);
  assert.equal(fitted[1999], 0.5);
});

test('encodeWav writes a valid mono 16-bit header and download names stay safe', () => {
  const blob = encodeWav(new Float32Array(24000).fill(0.25), 24000);
  assert.equal(blob.size, 44 + 48000);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(downloadName('my  movie?.mp4', 'دوبله', 'wav'), 'my movie - دوبله.wav');
  assert.equal(downloadName('', 'a', 'srt'), 'HamAva - a.srt');
  assert.equal(clockLabel(65), '1:05');
});

test('collectCues tolerates a partial continuation answer', () => {
  assert.deepEqual(collectCues({ complete: false, cues: [cue] }, 0, 10), [cue]);
  assert.deepEqual(collectCues({ complete: false, cues: [] }, 0, 10), []);
  assert.deepEqual(collectCues(null, 0, 10), []);
});

test('translateMedia analyses a small file in one pass with real timestamps', async t => {
  const body = JSON.stringify({ complete: true, cues: [{ ...cue, start: 1, end: 3 }, { ...cue, start: 3.5, end: 6 }] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: body }] }],
    status: 'completed',
  }));
  const file = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
  const progress: string[] = [];
  const cues = await translateMedia({
    source: { file, probe: { mime: 'video/mp4', kind: 'video', size: 1024, name: 'a.mp4' } },
    duration: 10, // the transcript reaches 6s; nothing meaningful is left after it
    key: 'dummy',
    settings: defaults,
    signal: new AbortController().signal,
    onProgress: (_p, label) => progress.push(label),
  });
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  assert.equal(calls, 1);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.ok(progress[0].includes('ترجمه'));
});

test('translateMedia continues when the model stops early', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: { body?: unknown }) => {
    const sent = JSON.parse(String(options?.body));
    const first = sent.input[1].text.includes('whole recording');
    const body = JSON.stringify({
      complete: !first,
      cues: [first ? { ...cue, start: 0, end: 10 } : { ...cue, start: 10, end: 25 }],
    });
    return Response.json({ steps: [{ type: 'model_output', content: [{ type: 'text', text: body }] }], status: 'completed' });
  });
  const file = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
  const chunks: number[] = [];
  const cues = await translateMedia({
    source: { file, probe: { mime: 'video/mp4', kind: 'video', size: 1024, name: 'a.mp4' } },
    duration: 40, // the first pass stops at 10s, far from the 40s end
    key: 'dummy',
    settings: defaults,
    signal: new AbortController().signal,
    onChunk: chunk => { chunks.push(chunk.length); },
  });
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  assert.equal(calls, 2, 'a short first pass is followed by a continuation request');
  assert.deepEqual(chunks, [1, 1]);
  assert.equal(cues.at(-1)!.end, 25);
});

test('translateMedia refuses oversized files with a human message instead of an API error', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
  const file = new Blob([new Uint8Array(64)], { type: 'video/mp4' });
  await assert.rejects(
    translateMedia({
      source: { file, probe: { mime: 'video/mp4', kind: 'video', size: 40_000_000, name: 'big.mp4' } },
      duration: 600,
      key: 'dummy',
      settings: defaults,
      signal: new AbortController().signal,
      onProgress: () => {},
    }),
    error => {
      assert.match((error as Error).message, /بزرگ است/);
      return true;
    },
  );
  assert.equal(calls, 0, 'no billable request may be sent for a known-oversized file');
});

