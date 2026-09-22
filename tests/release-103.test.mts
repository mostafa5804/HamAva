import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportCaptions } from '../lib/hamava/shared.js';
import { fitToWindow, mixClipsOnTimeline } from '../lib/hamava/audio-mix.ts';
import { renderDubbingTrack } from '../lib/hamava/media-export.ts';
import { LiveClient } from '../lib/hamava/live-client.js';

const cue = { start: 1, end: 3, translation: 'سلام', source: 'Hello' };
test('SRT/VTT sort, replace repeated live passes, remove invalid cues and trim overlaps', () => {
  const input = [{...cue,start:4,end:5}, {...cue,translation:'قدیمی'}, {...cue,translation:'جدید',end:6}, {...cue,start:NaN}, {...cue,start:-4,end:-1}];
  const srt = exportCaptions(input);
  assert.ok(!srt.includes('NaN')&&!srt.includes('قدیمی'));
  assert.match(srt,/1\n00:00:01,000 --> 00:00:04,000\nجدید/);
  assert.match(srt,/2\n00:00:04,000 --> 00:00:05,000/);
  const vtt = exportCaptions([cue],{format:'vtt',bilingual:true,offset:-2});
  assert.match(vtt,/^WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nسلام\nHello/);
});
test('compressed speech includes its final sound and approximately preserves pitch', () => {
  const rate=24000, input=Float32Array.from({length:rate*2},(_,i)=>.5*Math.sin(2*Math.PI*220*i/rate));
  const output=fitToWindow(input,rate,1,rate);
  assert.equal(output.length,rate);
  let crossings=0;for(let i=1;i<output.length;i++)if(output[i-1]<0&&output[i]>=0)crossings++;
  assert.ok(Math.abs(crossings-220)<15,`pitch was ${crossings}Hz`);
  const ending=new Float32Array(rate*2);ending.fill(.5,rate*1.8);
  const fitted=fitToWindow(ending,rate,1,rate);
  assert.ok(fitted.slice(-100).every(value=>Math.abs(value-.5)<.01),'last syllable must not be truncated');
});
test('mixing overlapping speech does not fold overload back toward silence', () => {
  const clip={start:0,end:1,sampleRate:1000,samples:new Float32Array(1000).fill(.6)};
  const mixed=mixClipsOnTimeline([clip,clip],{duration:1,sampleRate:1000});
  assert.equal(mixed[100],1);
  assert.throws(()=>mixClipsOnTimeline([],{duration:3601}),/یک ساعت/);
});
test('audio export refuses missing clips instead of silently producing a partial file', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:404}));
  await assert.rejects(renderDubbingTrack({clips:[{start:0,end:1,url:'https://example.com/missing'}],duration:1,decodeAudio:async()=>{throw new Error('should not decode');}}),/بخش 1/);
});
test('cancellation during decoding is preserved by audio export', async t => {
  const controller=new AbortController();
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(4)));
  await assert.rejects(renderDubbingTrack({clips:[{start:0,end:1,url:'https://example.com/audio'}],duration:1,signal:controller.signal,decodeAudio:async()=>{controller.abort();throw controller.signal.reason;}}),{name:'AbortError'});
});
test('live input end sends the finalization signal only on a ready socket',()=>{
  const messages:unknown[]=[];
  const client=new LiveClient({key:'test',settings:{},onContent:()=>{},onState:()=>{},onFatal:()=>{},onUsage:()=>{}});
  client.ws={readyState:1,send:(value:string)=>messages.push(JSON.parse(value))};
  client.finishInput();assert.equal(messages.length,0);
  client.ready=true;client.finishInput();assert.deepEqual(messages,[{realtimeInput:{audioStreamEnd:true}}]);
});
