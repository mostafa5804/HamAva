import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults,youtubeId,directUrl,sanitizeSettings,migrateSettings,errorText,isValidApiKey } from '../lib/hamava/types.ts';
import { validateCues,groupCues,pcmWave,translateYoutube,prepareDubbing,ttsRequestBody,usesStructuredTtsSchema } from '../lib/hamava/gemini.ts';
import { fetchGeminiModels,modelsForUse } from '../lib/hamava/model-catalog.ts';
import { appAsset } from '../lib/hamava/assets.ts';

const cue={start:0,end:2,source:'Hello',translation:'سلام',speaker:'a',voice:'female'};
const translationOptions={id:'9hE5-98ZeCg',duration:10,key:'dummy',settings:defaults,onProgress:()=>{}};
function assertBrowserHeaders(url,options,key='dummy'){
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
  const headers=new Headers(options.headers);
  assert.equal(headers.get('x-goog-api-key'),key);
  assert.equal(headers.get('content-type'),'application/json');
  assert.deepEqual([...headers.keys()].sort(),['content-type','x-goog-api-key']);
  assert.equal(headers.has('api-revision'),false,'Api-Revision causes Google to reject the browser CORS preflight');
}
test('source URLs reject lookalikes and unsafe schemes',()=>{
  assert.equal(youtubeId('https://youtu.be/9hE5-98ZeCg?t=5'),'9hE5-98ZeCg');
  assert.equal(youtubeId('https://m.youtube.com/shorts/9hE5-98ZeCg'),'9hE5-98ZeCg');
  for(const u of ['https://youtube.com.evil.example/watch?v=9hE5-98ZeCg','javascript:alert(1)','http://youtu.be/9hE5-98ZeCg'])assert.throws(()=>youtubeId(u));
  assert.throws(()=>directUrl('https://user:password@example.org/video.mp4'));
  assert.throws(()=>directUrl('https://youtube.com/watch?v=9hE5-98ZeCg'));
  assert.equal(directUrl('https://example.org/movie.mp4'),'https://example.org/movie.mp4');
});
test('API keys accept new AQ. authorization format and legacy keys as opaque tokens',()=>{
  assert.equal(isValidApiKey('AQ.Ab8o-example.auth-key-2026'),true);
  assert.equal(isValidApiKey('AIzaSy-example_legacy-key-2026'),true);
  assert.equal(isValidApiKey('too-short'),false);
  assert.equal(isValidApiKey('AQ. key-with-space-123'),false);
  assert.equal(isValidApiKey('AQ.key\nwith-line-break'),false);
  assert.equal(isValidApiKey('AQ.'+'a'.repeat(2050)),false);
});
test('settings sanitize persisted data and redact key material',()=>{
  const s=sanitizeSettings({originalVolume:400,dubVolume:-10,voice:'nonsense',model:'<script>',captionSize:NaN});
  assert.equal(s.originalVolume,100);assert.equal(s.dubVolume,0);assert.equal(s.voice,'auto');assert.equal(s.model,defaults.model);assert.equal(s.captionSize,22);
  assert.ok(!errorText(new Error('bad secret-dummy-key'), 'secret-dummy-key').includes('secret-dummy-key'));
  assert.ok(!errorText(new Error('invalid AQ.Ab8o-sensitive-auth-key-2026')).includes('AQ.Ab8o-sensitive-auth-key-2026'));
});
test('settings migration upgrades only the previous built-in TTS default',()=>{
  assert.equal(migrateSettings({ttsModel:'gemini-3.1-flash-tts-preview'}).ttsModel,'gemini-3.8-flash-lite-tts');
  assert.equal(migrateSettings({ttsModel:'gemini-3.1-flash-tts-preview',model:'gemini-3.8-live'}).model,'gemini-3.8-live');
  assert.equal(migrateSettings({ttsModel:'gemini-3.8-flash-tts'}).ttsModel,'gemini-3.8-flash-tts');
});
test('model discovery uses the saved key in a header, reads all pages, and separates use cases',async()=>{
  const oldFetch=globalThis.fetch;const calls=[];const key='AQ.Ab8o-catalog-test-key-2026';
  globalThis.fetch=async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://generativelanguage.googleapis.com');assert.equal(parsed.pathname,'/v1beta/models');
    assert.equal(new Headers(options.headers).get('x-goog-api-key'),key);assert.equal(parsed.searchParams.has('key'),false);calls.push(parsed.searchParams.get('pageToken'));
    if(calls.length===1)return Response.json({models:[
      {name:'models/gemini-3.8-live',displayName:'Gemini Live',supportedGenerationMethods:['bidiGenerateContent']},
      {name:'models/gemini-3.5-live-translate-preview',displayName:'Gemini Live Translate',supportedGenerationMethods:['bidiGenerateContent']},
      {name:'models/gemini-3.8-flash-lite-tts',displayName:'Gemini TTS',supportedGenerationMethods:['generateContent']},
      {name:'models/gemini-3.8-flash',displayName:'Gemini Flash',supportedGenerationMethods:['generateContent']},
      {name:'models/gemini-3.1-flash-image',displayName:'Gemini Image',supportedGenerationMethods:['generateContent']},
    ],nextPageToken:'next'});
    return Response.json({models:[{name:'models/gemini-3.1-flash-tts-preview',displayName:'Older TTS',supportedGenerationMethods:['generateContent']}]});
  };
  try{
    const models=await fetchGeminiModels(key);assert.deepEqual(calls,[null,'next']);
    assert.deepEqual(modelsForUse(models,'live').map(x=>x.id),['gemini-3.5-live-translate-preview']);
    assert.deepEqual(modelsForUse(models,'tts').map(x=>x.id).sort(),['gemini-3.1-flash-tts-preview','gemini-3.8-flash-lite-tts']);
    assert.deepEqual(modelsForUse(models,'video').map(x=>x.id),['gemini-3.8-flash']);
  }finally{globalThis.fetch=oldFetch;}
});
test('TTS requests use verbatim transcript annotations for 3.8 and preserve the legacy 3.1 schema',()=>{
  assert.equal(usesStructuredTtsSchema('gemini-3.8-flash-lite-tts'),true);
  assert.equal(usesStructuredTtsSchema('gemini-3.1-flash-tts-preview'),false);
  const modern=ttsRequestBody('gemini-3.8-flash-lite-tts','فقط متن فارسی',2.5,'Kore');
  assert.deepEqual(modern.input[0].content[0].text,'فقط متن فارسی');
  assert.equal(modern.input[0].content[0].annotations[0].type,'speech_metadata');
  assert.match(modern.input[0].content[0].annotations[0].style,/2\.5 seconds/);
  assert.deepEqual(modern.response_format,{type:'audio',mime_type:'audio/l16',sample_rate:24000});
  const legacy=ttsRequestBody('gemini-3.1-flash-tts-preview','فقط متن فارسی',2.5,'Charon');
  assert.match(legacy.input,/Read ONLY/);assert.deepEqual(legacy.response_format,{type:'audio',sample_rate:24000});
});
test('incomplete or wrongly timed transcript is never marked ready',()=>{
  assert.throws(()=>validateCues({complete:false,cues:[cue]},0,240));
  assert.throws(()=>validateCues({complete:true,cues:[{...cue,start:300,end:310}]},0,240));
  assert.throws(()=>validateCues({complete:true,cues:[{...cue,end:NaN}]},0,240));
  assert.deepEqual(validateCues({complete:true,cues:[cue]},0,240),[cue]);
  const tolerant=validateCues({complete:true,cues:[cue,{...cue,start:'4',end:'6',voice:'not-a-voice'}]},0,240);
  assert.equal(tolerant.length,2);assert.equal(tolerant[1].start,4);assert.equal(tolerant[1].voice,'unknown');
  const millis=validateCues({complete:true,cues:[{...cue,start:4000,end:6000}]},0,240);
  assert.equal(millis[0].start,4);
  const long=validateCues({complete:true,cues:[{...cue,start:0,end:12,translation:'جمله‌ی اول برای آزمون زیرنویس. جمله‌ی دوم باید در بازه‌ی خودش نمایش داده شود و روی کل تصویر پخش نشود.'}]},0,240);
  assert.ok(long.length>1);assert.ok(long.every(item=>item.translation.length<=90));assert.ok(long.every((item,index)=>index===0||item.start>=long[index-1].end));
});
test('speech groups retain distinct speakers and fit non-overlapping windows',()=>{
  const groups=groupCues([cue,{...cue,start:2,end:4,translation:'خوش آمدید'},{...cue,start:3.8,end:6,speaker:'b',voice:'male'}]);
  assert.equal(groups.length,2);assert.equal(groups[0].end,3.8);assert.equal(groups[1].start,3.8);assert.equal(groups[1].voice,'male');
});
test('PCM becomes a valid mono 24kHz WAV with correct duration',async()=>{
  const wav=pcmWave(Buffer.alloc(48000).toString('base64'));assert.equal(wav.duration,1);
  const bytes=await wav.blob.arrayBuffer();assert.equal(Buffer.from(bytes).subarray(0,4).toString(),'RIFF');assert.equal(new DataView(bytes).getUint32(24,true),24000);assert.equal(bytes.byteLength,48044);
});
test('YouTube preparation sends a valid public URI and the new AQ key in the Google auth header',async()=>{
  const fetch=globalThis.fetch;const calls=[];
  const key='AQ.Ab8o-test-only-fake-auth-key-2026';
  globalThis.fetch=async(url,options)=>{assertBrowserHeaders(url,options,key);const body=JSON.parse(options.body);calls.push(body);return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({complete:true,cues:[cue]})}]}]});};
  try{const cues=await translateYoutube({id:'9hE5-98ZeCg',duration:260,key,settings:defaults,signal:new AbortController().signal,onProgress:()=>{}});assert.equal(calls.length,1);assert.equal(calls[0].store,false);assert.equal(calls[0].response_format.mime_type,'application/json');assert.deepEqual(calls[0].input[0],{type:'video',uri:'https://www.youtube.com/watch?v=9hE5-98ZeCg'});assert.equal(calls[0].input[0].processing,undefined);assert.equal(cues[0].start,0);}finally{globalThis.fetch=fetch;}
});
test('a completed YouTube response is streamed to the caller once',async()=>{
  const fetch=globalThis.fetch;const chunks=[];let calls=0;
  globalThis.fetch=async(url,options)=>{assertBrowserHeaders(url,options);calls++;return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({complete:true,cues:[{...cue,start:1,end:3}]})}]}]});};
  try{const cues=await translateYoutube({id:'9hE5-98ZeCg',duration:250,key:'dummy',settings:defaults,signal:new AbortController().signal,onProgress:()=>{},onChunk:chunk=>chunks.push(chunk)});assert.equal(calls,1);assert.equal(chunks.length,1);assert.equal(cues[0].start,1);}finally{globalThis.fetch=fetch;}
});
test('an incomplete interaction with a model output remains parseable',async()=>{
  const fetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{assertBrowserHeaders(url,options);const body=JSON.parse(options.body);assert.equal(body.generation_config.max_output_tokens,32768);return Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({complete:true,cues:[cue]})}]}]});};
  try{const cues=await translateYoutube({id:'9hE5-98ZeCg',duration:250,key:'dummy',settings:defaults,signal:new AbortController().signal,onProgress:()=>{}});assert.equal(cues.length,1);}finally{globalThis.fetch=fetch;}
});
test('temporary video-model overload retries once on the configured lightweight fallback',async()=>{
  const fetch=globalThis.fetch;const models=[];
  globalThis.fetch=async(url,options)=>{assertBrowserHeaders(url,options);const body=JSON.parse(options.body);models.push(body.model);if(models.length===1)return Response.json({error:{message:'gemini-3.8-flash is currently experiencing high demand'}},{status:500});return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({complete:true,cues:[cue]})}]}]});};
  try{const cues=await translateYoutube({id:'9hE5-98ZeCg',duration:10,key:'dummy',settings:defaults,signal:new AbortController().signal,onProgress:()=>{}});assert.equal(cues.length,1);assert.deepEqual(models,['gemini-3.8-flash','gemini-3.5-flash-lite']);}finally{globalThis.fetch=fetch;}
});
test('prepared dubbing uses selected voices; cancelled jobs do not issue requests',async()=>{
  const fetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{assertBrowserHeaders(url,options);calls.push(JSON.parse(options.body));return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/l16',sample_rate:24000,channels:1,data:Buffer.alloc(48000).toString('base64')}]}]});};
  try{
    const options={cues:[cue,{...cue,start:2,end:4,speaker:'b',voice:'male'}],key:'dummy',settings:defaults,signal:new AbortController().signal,onProgress:()=>{},decodeAudio:()=>{throw new Error('PCM needs no compressed decoder');}};
    const clips=await prepareDubbing(options);assert.equal(clips.length,2);assert.equal(calls[0].generation_config.speech_config[0].voice,'Kore');assert.equal(calls[1].generation_config.speech_config[0].voice,'Charon');assert.equal(calls[0].model,'gemini-3.8-flash-lite-tts');assert.equal(calls[0].input[0].content[0].text,'سلام');assert.equal(calls[0].input[0].content[0].annotations[0].type,'speech_metadata');clips.forEach(c=>URL.revokeObjectURL(c.url));
    const abort=new AbortController();abort.abort();await assert.rejects(prepareDubbing({...options,signal:abort.signal}),{name:'AbortError'});assert.equal(calls.length,2);
  }finally{globalThis.fetch=fetch;}
});
test('TTS fallback rebuilds the prompt for the fallback model schema',async()=>{
  const oldFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{
    assertBrowserHeaders(url,options);const body=JSON.parse(options.body);calls.push(body);
    if(calls.length===1)return Response.json({error:{message:'temporary overload'}},{status:503});
    return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/l16',sample_rate:24000,channels:1,data:Buffer.alloc(48000).toString('base64')}]}]});
  };
  try{
    const clips=await prepareDubbing({cues:[cue],key:'dummy',settings:defaults,signal:new AbortController().signal,onProgress:()=>{},decodeAudio:()=>{throw new Error('PCM needs no decoder');}});
    assert.equal(calls.length,2);assert.deepEqual(calls.map(x=>x.model),['gemini-3.8-flash-lite-tts','gemini-3.1-flash-tts-preview']);
    assert.equal(calls[0].input[0].content[0].text,'سلام');assert.equal(typeof calls[1].input,'string');assert.match(calls[1].input,/Read ONLY/);
    clips.forEach(clip=>URL.revokeObjectURL(clip.url));
  }finally{globalThis.fetch=oldFetch;}
});
test('Google HTTP errors retain status and details, including array-shaped key errors',async t=>{
  for(const [status,message,expected,array] of [
    [400,'API key not valid. dummy',/کلید API معتبر نیست/,true],
    [403,'User location is not supported',/منطقه/,false],
    [404,'Requested model was not found',/مدل انتخاب‌شده/,false],
    [429,'Quota exceeded',/سهمیه/,false],
    [503,'Service unavailable',/خطای موقت/,false],
  ]){
    const body={error:{code:status,message}};
    t.mock.method(globalThis,'fetch',async()=>Response.json(array?[body]:body,{status}));
    await assert.rejects(translateYoutube({...translationOptions,signal:new AbortController().signal}),e=>{
      const label=errorText(e,'dummy');
      assert.equal(e.httpStatus,status);assert.equal(e.kind,'http');
      assert.match(label,expected);assert.ok(label.includes(String(status)));
      assert.ok(label.includes(message.replaceAll('dummy','••••')));
      assert.ok(!label.includes('dummy'));assert.ok(!label.includes('اینترنت'));
      return true;
    });
    t.mock.restoreAll();
  }
});
test('a blocked network request is distinct from a Google HTTP response and is not retried',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('Failed to fetch');});
  await assert.rejects(translateYoutube({...translationOptions,signal:new AbortController().signal}),e=>{
    assert.equal(e.kind,'network');assert.equal(e.httpStatus,0);
    assert.match(errorText(e),/generativelanguage.googleapis.com/);return true;
  });assert.equal(calls,1);
});
test('cancelling an in-flight request remains cancellation and stops further work',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const controller=new AbortController();
  const pending=translateYoutube({...translationOptions,signal:controller.signal});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('a request timeout reports the preparation stage without retrying a billable call',async t=>{
  let calls=0;
  t.mock.method(globalThis,'setTimeout',callback=>{queueMicrotask(callback);return 0;});
  t.mock.method(globalThis,'fetch',(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  await assert.rejects(translateYoutube({...translationOptions,signal:new AbortController().signal}),e=>{
    assert.equal(e.kind,'timeout');assert.match(errorText(e),/ترجمه ویدیو/);assert.match(errorText(e),/۳ دقیقه/);return true;
  });assert.equal(calls,1);
});
test('unreadable or incomplete server responses cannot mark a translation ready',async t=>{
  for(const response of [new Response('<html>upstream error</html>',{status:502}),Response.json({status:'in_progress'}),new Response('not json')]){
    t.mock.method(globalThis,'fetch',async()=>response);
    await assert.rejects(translateYoutube({...translationOptions,signal:new AbortController().signal}),{name:'GeminiRequestError'});
    t.mock.restoreAll();
  }
});

test('public files follow the deployed page, not the site root',()=>{
  globalThis.document={baseURI:'https://user.github.io/HamAva/'};
  assert.equal(appAsset('audio-worklet.js'),'https://user.github.io/HamAva/audio-worklet.js');
  assert.equal(appAsset('/sw.js'),'https://user.github.io/HamAva/sw.js');
  assert.equal(appAsset('icon192.png'),'https://user.github.io/HamAva/icon192.png');
  globalThis.document={baseURI:'https://hamava.example/'};
  assert.equal(appAsset('sw.js'),'https://hamava.example/sw.js');
  delete globalThis.document;
  assert.equal(appAsset('sw.js'),'/sw.js','prerender has no document and must not throw');
});
