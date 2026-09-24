import fs from 'node:fs';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hamava-browser-'));
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=15:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libvpx','-c:a','libopus','-y',root+'/qa-source.webm']);
const server=http.createServer((req,res)=>{let pathname=new URL(req.url,'http://localhost').pathname.replace(/^\/HamAva/,'');if(pathname.endsWith('/'))pathname+='index.html';const file=path.join(repo,'out',pathname);if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],env:process.env});
const rate=24000,len=rate*3,wav=Buffer.alloc(44+len*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(len*2,40);for(let i=0;i<len;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*8000),44+i*2);
const pcm=wav.subarray(44).toString('base64');let calls=0;
try{
 const context=await browser.newContext({viewport:{width:1150,height:900},acceptDownloads:true});
 await context.addInitScript(()=>{if(!localStorage.getItem('hamava.web.key'))localStorage.setItem('hamava.web.key','AQ.Ab8o-test-only-fake-auth-key-2026');if(!localStorage.getItem('hamava.web.settings'))localStorage.setItem('hamava.web.settings',JSON.stringify({mode:'both',dubVolume:0}));window.__hamavaBufferStarts=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.__hamavaBufferStarts++;return start.apply(this,args);};});
 await context.route('https://generativelanguage.googleapis.com/**',async route=>{
   if(route.request().method()==='GET'){
     await route.fulfill({json:{models:[
       {name:'models/gemini-3.8-live',displayName:'Gemini 3.8 Live',supportedGenerationMethods:['bidiGenerateContent']},
       {name:'models/gemini-3.5-live-translate-preview',displayName:'Gemini 3.5 Live Translate',supportedGenerationMethods:['bidiGenerateContent']},
       {name:'models/gemini-3.8-flash',displayName:'Gemini 3.8 Flash',supportedGenerationMethods:['generateContent']},
       {name:'models/gemini-3.8-flash-lite-tts',displayName:'Gemini 3.8 Flash-Lite TTS',supportedGenerationMethods:['generateContent']},
       {name:'models/gemini-3.1-flash-tts-preview',displayName:'Gemini 3.1 Flash TTS Preview',supportedGenerationMethods:['generateContent']},
     ]}});return;
   }
   calls++;const body=route.request().postDataJSON();
   const content=body.model.includes('tts')?[{type:'audio',mime_type:'audio/l16',sample_rate:24000,channels:1,data:pcm}]:[{type:'text',text:JSON.stringify({complete:true,cues:[{start:0,end:3,source:'Hello world',translation:'سلام دنیا',speaker:'a',voice:'female'}]})}];
   await route.fulfill({json:{status:'completed',steps:[{type:'model_output',content}]}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,500));});
 await page.goto(`http://127.0.0.1:${server.address().port}/HamAva/`);await page.waitForSelector('.key-ready');await page.getByText('نسخه ۱.۰.۷',{exact:false}).first().waitFor();assert.equal(await page.getByRole('link',{name:'کد منبع هم‌آوا در GitHub'}).getAttribute('href'),'https://github.com/mostafa5804/HamAva');
 await page.getByRole('button',{name:'تنظیمات'}).click();await page.getByRole('button',{name:'بررسی مدل‌های API Key'}).click();await page.getByText(/مدل دریافت شد/).waitFor();assert.equal(await page.locator('#ttsModel').getAttribute('list'),'tts-model-options');assert.ok(await page.locator('#tts-model-options option[value="gemini-3.8-flash-lite-tts"]').count());console.log('PASS model catalog discovery is available in settings');await page.getByRole('button',{name:'بستن تنظیمات'}).click();
 fs.writeFileSync(root+'/qa-source.wav',wav);await page.locator('input[type=file]').setInputFiles(root+'/qa-source.wav');
 await page.waitForFunction(()=>document.querySelector('video').readyState>=1).catch(async e=>{console.log(await page.locator('video').evaluate(v=>({src:v.src,state:v.readyState,error:v.error?.message})),await page.locator('body').innerText());throw e;});
 await page.locator('.desktop-translation-controls button').filter({hasText:'شروع ترجمه'}).click();
 await page.waitForSelector('.cue-row');await page.locator('.desktop-translation-controls button').filter({hasText:'پخش با ترجمه'}).click();await page.waitForFunction(()=>window.__hamavaBufferStarts>0);assert.equal(await page.locator('.error-message').count(),0);
 await page.waitForSelector('.caption');assert.match(await page.locator('.caption').innerText(),/سلام دنیا/);console.log('PASS local prepared captions visible');
 await page.getByRole('button',{name:'مکث',exact:true}).click();
 for(const [label,extension] of [['SRT','srt'],['VTT','vtt'],['صدای دوبله','wav']]){
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const dl=await wait;await dl.saveAs(root+'/qa-web-output.'+extension);
 }
 assert.match(fs.readFileSync(root+'/qa-web-output.vtt','utf8'),/^WEBVTT/);const audio=fs.readFileSync(root+'/qa-web-output.wav');assert.ok(audio.subarray(44).some(v=>v!==0));console.log('PASS SRT/VTT and non-silent WAV with listening volume zero');
 await page.waitForTimeout(900);const before=calls;await page.reload();await page.waitForSelector('.key-ready');await page.locator('input[type=file]').setInputFiles(root+'/qa-source.wav');
 await page.waitForSelector('.cue-row');assert.equal(calls,before);console.log('PASS IndexedDB transcript and clip restoration without API calls');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:root+'/qa-web-mobile.png',fullPage:true});console.log('PASS mobile layout');

 await page.setViewportSize({width:1150,height:900});
 await page.locator('input[type=file]').setInputFiles(root+'/qa-source.webm');await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
 await page.locator('.desktop-translation-controls button').filter({hasText:'شروع ترجمه'}).click();await page.locator('.desktop-translation-controls button').filter({hasText:'پخش با ترجمه'}).waitFor();
 const beforeVideo=calls;await page.getByRole('button',{name:'ساخت خروجی دوبله',exact:true}).click();
 await page.getByRole('link',{name:'دانلود ویدیوی دوبله',exact:true}).waitFor({timeout:15000});assert.equal(calls,beforeVideo);
 const vwait=page.waitForEvent('download');await page.getByRole('link',{name:'دانلود ویدیوی دوبله',exact:true}).click();await (await vwait).saveAs(root+'/qa-web-video.webm');assert.ok(fs.statSync(root+'/qa-web-video.webm').size>1000);console.log('PASS prepared video export without another API call');
 await page.evaluate(()=>{
   window.__sent=0;window.__endedInput=false;window.WebSocket=class{
    constructor(){this.readyState=0;this.bufferedAmount=0;setTimeout(()=>{this.readyState=1;this.onopen?.();},10);}
    send(raw){const m=JSON.parse(raw);if(m.setup){setTimeout(()=>this.onmessage?.({data:JSON.stringify({setupComplete:{}})}),10);return;}
      if(m.realtimeInput?.audio){window.__sent++;if(window.__sent%3)return;const pcm=new Int16Array(4800);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i*.12)*8000;let str='';for(const b of new Uint8Array(pcm.buffer))str+=String.fromCharCode(b);setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify({serverContent:{outputTranscription:{text:'سلام زنده '},modelTurn:{parts:[{inlineData:{data:btoa(str),mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}})});},10);}
      if(m.realtimeInput?.audioStreamEnd){window.__endedInput=true;setTimeout(()=>this.onmessage?.({data:JSON.stringify({serverContent:{turnComplete:true}})}),100);}
    }
    close(){this.readyState=3;}
   };
 });
 await page.locator('input[type=file]').setInputFiles({name:'large.wav',mimeType:'audio/wav',buffer:Buffer.concat([wav,Buffer.alloc(11_000_000)])});await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
 await page.locator('.desktop-translation-controls button').filter({hasText:'شروع ترجمه'}).click();await page.waitForFunction(()=>window.__sent>5,{},{timeout:15000});
 await page.getByRole('link',{name:'دانلود صدای آخرین بخش ترجمه زنده',exact:true}).waitFor({timeout:15000});assert.ok(await page.evaluate(()=>window.__endedInput));
 const lwait=page.waitForEvent('download');await page.getByRole('link',{name:'دانلود صدای آخرین بخش ترجمه زنده',exact:true}).click();await (await lwait).saveAs(root+'/qa-web-live.webm');
 const audible=await page.evaluate(async()=>{const ctx=new AudioContext();const blob=await (await fetch(document.querySelector('a[download="HamAva-live-dub.webm"]').href)).arrayBuffer();const data=await ctx.decodeAudioData(blob);const peak=Math.max(...data.getChannelData(0).subarray(0,24000));await ctx.close();return peak;});assert.ok(audible>.01);console.log('PASS real AudioWorklet input, final live drain and non-silent audio export with listening volume zero');
 await page.reload();await page.getByRole('link',{name:'دانلود صدای آخرین بخش ترجمه زنده',exact:true}).waitFor();await page.getByRole('link',{name:'دانلود آخرین ویدیوی ذخیره‌شده',exact:true}).waitFor();console.log('PASS live audio and video archive survive reload');
 assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});}
