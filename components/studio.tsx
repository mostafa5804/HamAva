'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Settings2, Upload, Link2, Video as Youtube, Play, Pause, Maximize, Volume2, Mic2, Subtitles, KeyRound, Check, X, Eye, EyeOff, Download, RotateCcw, SkipBack, SkipForward, Smartphone, ChevronLeft, CircleHelp, RefreshCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetClose } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { TranslationControls } from '@/components/translation-controls';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { defaults, sanitizeSettings, migrateSettings, isValidApiKey, youtubeId, directUrl, errorText, formatTime, type Settings, type SourceKind, type Cue, type AudioClip, type Mode } from '@/lib/hamava/types';
import { MediaEngine } from '@/lib/hamava/engine';
import { appAsset } from '@/lib/hamava/assets';
import { translateYoutube, translateMedia, prepareDubbing } from '@/lib/hamava/gemini';
import { canSendInline, probeMediaFile, type MediaProbe } from '@/lib/hamava/timeline';
import { decodeMediaAudio, syncCuesToAudio } from '@/lib/hamava/sync';
import { downloadName, renderDubbingTrack, saveBlob } from '@/lib/hamava/media-export';
import { loadYoutube, type YouTubePlayer } from '@/lib/hamava/youtube';
import { clearArchive, fileIdentity, loadSession, loadVideo, loadLiveAudio, restoreClips, saveSession, saveVideo, saveLiveAudio } from '@/lib/hamava/session-store';
import { exportCaptions } from '@/lib/hamava/shared.js';
import { fetchGeminiModels, modelsForUse, type GeminiApiModel, type GeminiModelUse } from '@/lib/hamava/model-catalog';

type Media = { kind:SourceKind; url:string; name:string; id?:string; revision:number; identity:string };
type InstallPrompt = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const APP_VERSION = '۱.۰.۵';

function Range({label,value,min=0,max=100,step=1,suffix='٪',onChange,icon}:{label:string;value:number;min?:number;max?:number;step?:number;suffix?:string;onChange:(v:number)=>void;icon?:React.ReactNode}) {
  const id=label.replaceAll(' ','-');
  return <div className="range-field"><div className="field-line"><label id={id}>{icon}{label}</label><output>{value.toLocaleString('fa-IR')}{suffix}</output></div><Slider dir="ltr" aria-labelledby={id} value={[value]} onValueChange={v=>onChange(v[0])} min={min} max={max} step={step}/></div>;
}
function Choice({label,value,onChange,items,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;items:[string,string][];disabled?:boolean}) {
  return <div className="choice-field"><label>{label}</label><Select dir="rtl" value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{items.map(([v,text])=><SelectItem value={v} key={v}>{text}</SelectItem>)}</SelectContent></Select></div>;
}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <div className="toggle-row"><span>{label}</span><Switch dir="ltr" aria-label={label} checked={checked} onCheckedChange={onChange}/></div>;}

// Prerender has no localStorage; lazily restore what this browser saved last time.
function storedSettings(): Settings {
  if (typeof localStorage === 'undefined') return defaults;
  try { const saved = localStorage.getItem('hamava.web.settings'); return saved ? migrateSettings(JSON.parse(saved)) : defaults; } catch { return defaults; }
}
function storedKey(): string {
  if (typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem('hamava.web.key') || ''; } catch { return ''; }
}

export default function Studio(){
  const [settings,setSettings]=useState<Settings>(defaults);
  const [hydrated,setHydrated]=useState(false);
  const [tab,setTab]=useState<SourceKind>('file'),[url,setUrl]=useState(''),[ytUrl,setYtUrl]=useState('');
  const [media,setMedia]=useState<Media|null>(null),[duration,setDuration]=useState(0),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[mediaReady,setMediaReady]=useState(false);
  const [key,setKey]=useState(''),[keyDraft,setKeyDraft]=useState(''),[remember,setRemember]=useState(true),[showKey,setShowKey]=useState(false),[sheet,setSheet]=useState(false),[keyNote,setKeyNote]=useState('');
  const [modelCatalog,setModelCatalog]=useState<GeminiApiModel[]>([]),[modelCatalogNote,setModelCatalogNote]=useState(''),[loadingModels,setLoadingModels]=useState(false);
  const [status,setStatus]=useState('idle'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[talking,setTalking]=useState(false);
  const [preparing,setPreparing]=useState(false),[progress,setProgress]=useState(0),[progressLabel,setProgressLabel]=useState(''),[partialReady,setPartialReady]=useState(false);
  const [cues,setCues]=useState<Cue[]>([]),[clips,setClips]=useState<AudioClip[]>([]),[liveCaption,setLiveCaption]=useState<Cue|null>(null),[translationEnabled,setTranslationEnabled]=useState(false),[recording,setRecording]=useState(false),[recordedUrl,setRecordedUrl]=useState(''),[exportingAudio,setExportingAudio]=useState(false);
  const [liveAudioUrl,setLiveAudioUrl]=useState(''),[liveAudioExt,setLiveAudioExt]=useState('webm');
  const liveAudioUrlRef=useRef('');
  const [installPrompt,setInstallPrompt]=useState<InstallPrompt|null>(null);
  const video=useRef<HTMLVideoElement>(null),stage=useRef<HTMLDivElement>(null),ytHost=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null);
  const engine=useRef<MediaEngine|null>(null),yt=useRef<YouTubePlayer|null>(null),abort=useRef<AbortController|null>(null),blob=useRef(''),epoch=useRef(0),liveEnabled=useRef(false),captionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const dragging=useRef(false),startingTranslation=useRef(false),recorder=useRef<MediaRecorder|null>(null),recordedChunks=useRef<Blob[]>([]),recordedUrlRef=useRef('');
  const sourceFile=useRef<File|null>(null),mediaProbe=useRef<MediaProbe|null>(null),syncDone=useRef(false),durationRef=useRef(0);
  const settingsRef=useRef(settings),keyRef=useRef(key),clipsRef=useRef(clips),mediaRef=useRef(media),cuesRef=useRef(cues);
  useEffect(()=>{settingsRef.current=settings;keyRef.current=key;clipsRef.current=clips;mediaRef.current=media;cuesRef.current=cues;durationRef.current=duration;});
  useEffect(()=>{void Promise.resolve().then(()=>{setSettings(storedSettings());const saved=storedKey();setKey(saved);setKeyDraft(saved);setHydrated(true);});},[]);
  const report=useCallback((e:unknown)=>setError(errorText(e,keyRef.current)),[]);
  const update=useCallback((patch:Partial<Settings>)=>setSettings(s=>sanitizeSettings({...s,...patch})),[]);
  const showLiveAudio=useCallback((output:Blob)=>{if(liveAudioUrlRef.current)URL.revokeObjectURL(liveAudioUrlRef.current);const u=URL.createObjectURL(output);liveAudioUrlRef.current=u;setLiveAudioUrl(u);setLiveAudioExt(output.type.includes('mp4')?'m4a':'webm');},[]);
  const ensureEngine=useCallback(()=>{
    if(engine.current)return engine.current;
    const e=new MediaEngine(settingsRef.current,report,setTalking);
    e.onRecorded=output=>{showLiveAudio(output);void saveLiveAudio(output).catch(()=>setNotice('صدای زنده آماده دانلود است؛ ذخیره مرورگر ممکن نشد.'));};
    engine.current=e;return e;
  },[report,showLiveAudio]);
  const caption=translationEnabled?liveCaption:cues.find(c=>time>=c.start+settings.captionOffset&&time<c.end+settings.captionOffset)||null;

  useEffect(()=>{
    if('serviceWorker' in navigator)void navigator.serviceWorker.register(appAsset('sw.js')).catch(()=>{});
    const prompt=(e:Event)=>{e.preventDefault();setInstallPrompt(e as InstallPrompt);};
    window.addEventListener('beforeinstallprompt',prompt);
    return()=>{window.removeEventListener('beforeinstallprompt',prompt);abort.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();if(engine.current)engine.current.onRecorded=undefined;engine.current?.dispose();yt.current?.destroy();if(blob.current)URL.revokeObjectURL(blob.current);if(recordedUrlRef.current)URL.revokeObjectURL(recordedUrlRef.current);clipsRef.current.forEach(c=>URL.revokeObjectURL(c.url));if(liveAudioUrlRef.current)URL.revokeObjectURL(liveAudioUrlRef.current);clearTimeout(captionTimer.current);};
  },[]);
  useEffect(()=>{if(!hydrated)return;try{localStorage.setItem('hamava.web.settings',JSON.stringify(settings));}catch{}engine.current?.apply(settings,talking);if(video.current&&!engine.current?.source)video.current.volume=(settings.mode==='subtitle'?1:settings.originalVolume/100);yt.current?.setVolume((settings.mode==='subtitle'?100:settings.originalVolume)*(settings.duck&&talking&&settings.mode!=='subtitle'?.2:1));},[settings,talking,hydrated]);
  useEffect(()=>{
    const hidden=()=>{if(!document.hidden)return;if(recorder.current?.state==='recording')recorder.current.stop();if(liveEnabled.current){engine.current?.stopLive();setStatus('paused');}video.current?.pause();yt.current?.pauseVideo();engine.current?.clearSound();setPlaying(false);};
    document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);
  },[]);

  const [restoredSource,setRestoredSource]=useState('');
  const archiveWrites=useRef<Promise<unknown>>(Promise.resolve());
  useEffect(()=>{
    let cancelled=false;
    void loadLiveAudio().then(saved=>{if(!cancelled&&saved)showLiveAudio(saved);}).catch(()=>{});
    void loadVideo().then(saved=>{if(cancelled||!saved)return;const u=URL.createObjectURL(saved);recordedUrlRef.current=u;setRecordedUrl(u);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[showLiveAudio]);
  useEffect(()=>{
    if(!media?.identity)return;let cancelled=false;const identity=media.identity;
    void loadSession().then(saved=>{
      if(cancelled)return;
      if(saved?.source===identity){const restored=saved.voiceKey===`${settingsRef.current.voice}:${settingsRef.current.ttsModel}`?restoreClips(saved):[];clipsRef.current=restored;setClips(restored);setCues(saved.cues);setNotice('ترجمه ذخیره‌شده این فایل بازیابی شد.');}
      setRestoredSource(identity);
    }).catch(()=>{if(!cancelled)setRestoredSource(identity);});
    return()=>{cancelled=true;};
  },[media?.identity,media?.revision]);
  useEffect(()=>{
    if(!media||restoredSource!==media.identity||!cues.length)return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      archiveWrites.current=archiveWrites.current.catch(()=>{}).then(async()=>{
        if(cancelled)return;
        const savedClips=await Promise.all(clips.map(async({url,...clip})=>({...clip,blob:await (await fetch(url)).blob()})));
        if(cancelled)return;
        await saveSession({source:media.identity,name:media.name,cues,clips:savedClips,voiceKey:`${settings.voice}:${settings.ttsModel}`});
      }).catch(()=>{if(!cancelled)setNotice('ذخیره ترجمه در مرورگر ممکن نشد؛ خروجی‌ها را قبل از بستن صفحه دانلود کن.');});
    },600);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[media,cues,clips,restoredSource,settings.voice,settings.ttsModel]);
  useEffect(()=>{
    if(media?.kind==='youtube')return;
    let frame:number;
    const tick=()=>{const v=video.current;if(v&&!v.paused){engine.current?.syncPrepared(clipsRef.current,v.currentTime,true);}frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[media?.kind]);

  /**
   * Live sessions answer with the network's delay, so their cues inherit that
   * latency. When the session ends, measured speech shifts the transcript back
   * onto the media once; batch analysis does not need this.
   */
  const refineTiming=useCallback(async()=>{
    const m=mediaRef.current,own=epoch.current;
    if(!m||m.kind==='youtube'||syncDone.current)return;
    syncDone.current=true;
    try{
      const list=cuesRef.current;if(list.length<3)return;
      const buffer=await decodeMediaAudio(ensureEngine().ctx,{file:sourceFile.current,url:m.kind==='url'?m.url:null});
      const result=syncCuesToAudio(list,buffer.getChannelData(0),buffer.sampleRate,durationRef.current);
      if(own!==epoch.current||!result.measured)return;
      setCues(result.cues);
      setNotice(result.offset?`زمان‌بندی زیرنویس با صدای واقعی تنظیم شد (${result.offset>0?'+':''}${result.offset.toFixed(1).replace('.','٫')} ثانیه).`:'');
    }catch{/* مدل زمان‌بندی خودش معتبر است؛ سکوت در برابر خطای اندازه‌گیری */}
  },[ensureEngine]);
  const stopLive=useCallback(()=>{liveEnabled.current=false;setTranslationEnabled(false);engine.current?.stopLive();setStatus('idle');setLiveCaption(null);clearTimeout(captionTimer.current);void refineTiming();},[refineTiming]);
  function clearPrepared(){clipsRef.current.forEach(c=>URL.revokeObjectURL(c.url));clipsRef.current=[];setClips([]);engine.current?.clearSound();}
  function cancelPreparation(){epoch.current++;abort.current?.abort();abort.current=null;setPreparing(false);setProgressLabel('');setStatus(cues.length?'captions':'idle');setNotice('آماده‌سازی متوقف شد. درخواست ارسال‌شده ممکن است توسط گوگل محاسبه شود.');}
  function resetMedia(){
    epoch.current++;abort.current?.abort();abort.current=null;setPreparing(false);if(recorder.current?.state==='recording')recorder.current.stop();stopLive();video.current?.pause();yt.current?.destroy();yt.current=null;
    clearPrepared();setCues([]);setError('');setNotice('');setTime(0);setDuration(0);setPlaying(false);setMediaReady(false);
    sourceFile.current=null;mediaProbe.current=null;syncDone.current=false;
    if(blob.current){URL.revokeObjectURL(blob.current);blob.current='';}
    if(recordedUrlRef.current){URL.revokeObjectURL(recordedUrlRef.current);recordedUrlRef.current='';setRecordedUrl('');}
  }
  function selectFile(f:File|undefined){if(!f)return;if(!f.type.startsWith('video/')&&!f.type.startsWith('audio/')&&!/\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg|mkv)$/i.test(f.name)){setError('یک فایل ویدیویی یا صوتی قابل پخش انتخاب کن.');return;}resetMedia();blob.current=URL.createObjectURL(f);sourceFile.current=f;mediaProbe.current=probeMediaFile(f);setMedia({kind:'file',url:blob.current,name:f.name,revision:epoch.current,identity:fileIdentity(f)});}
  function loadLink(){try{const input=tab==='youtube'?ytUrl:url;if(tab==='youtube'){const id=youtubeId(input);resetMedia();sourceFile.current=null;mediaProbe.current=null;setMedia({kind:'youtube',url:`https://www.youtube.com/watch?v=${id}`,id,name:'ویدیوی یوتیوب',revision:epoch.current,identity:`youtube:${id}`});}else{const link=directUrl(input);resetMedia();sourceFile.current=null;mediaProbe.current=probeMediaFile({name:decodeURIComponent(new URL(link).pathname.split('/').pop()||'media')});setMedia({kind:'url',url:link,name:decodeURIComponent(new URL(link).pathname.split('/').pop()||'ویدیوی آنلاین'),revision:epoch.current,identity:`url:${link}`});}}catch(e){report(e);}}

  useEffect(()=>{
    if(media?.kind!=='youtube'||!media.id||!ytHost.current)return;
    let cancelled=false;const ownEpoch=epoch.current;let player:YouTubePlayer|undefined;
    const node=document.createElement('div');ytHost.current.replaceChildren(node);
    void loadYoutube().then(api=>{
      if(cancelled||ownEpoch!==epoch.current)return;
      player=new api.Player(node,{videoId:media.id,width:'100%',height:'100%',playerVars:{playsinline:1,origin:location.origin,rel:0,fs:0},events:{
        onReady:()=>{if(cancelled)return;yt.current=player!;setMediaReady(true);player!.setVolume(settingsRef.current.mode==='subtitle'?100:settingsRef.current.originalVolume);setDuration(player!.getDuration()||0);const title=player!.getVideoData().title;if(title)setMedia(m=>m&&m.id===media.id?{...m,name:title}:m);},
        onStateChange:(event:{data:number})=>{if(cancelled)return;setPlaying(event.data===1);if(event.data!==1)engine.current?.clearSound();},
        onError:(event:{data:number})=>{if(cancelled)return;setMediaReady(false);setPlaying(false);engine.current?.clearSound();setError([101,150].includes(event.data)?'صاحب ویدیو پخش در سایت‌های دیگر را بسته است. فایل ویدیو را از بخش فایل وارد کن.':`پخش یوتیوب ممکن نشد (کد ${event.data}). ویدیوی عمومی دیگری امتحان کن.`);},
        onAutoplayBlocked:()=>{setPlaying(false);setNotice('برای پخش، دکمه داخل ویدیوی یوتیوب را لمس کن.');}
      }});
    }).catch(report);
    return()=>{cancelled=true;player?.destroy();if(yt.current===player)yt.current=null;};
  },[media?.id,media?.kind,media?.revision,report]);

  useEffect(()=>{
    if(media?.kind!=='youtube')return;
    const timer=setInterval(()=>{const p=yt.current;if(!p)return;const t=p.getCurrentTime()||0;if(!dragging.current)setTime(t);const d=p.getDuration();if(d>0)setDuration(d);const isPlaying=p.getPlayerState()===1;setPlaying(isPlaying);engine.current?.syncPrepared(clipsRef.current,t,isPlaying);},120);
    return()=>clearInterval(timer);
  },[media?.kind,media?.id]);

  async function beginLive(){
    if(!keyRef.current.trim()){setSheet(true);setKeyNote('برای ترجمه، کلید Gemini را وارد و ذخیره کن.');return;}
    if(!video.current||!media||media.kind==='youtube')return;
    const sessionEpoch=epoch.current;
    try{setError('');const e=ensureEngine();await e.attach(video.current);if(sessionEpoch!==epoch.current)return;
      liveEnabled.current=true;setTranslationEnabled(true);
      await e.startLive(keyRef.current,s=>{setStatus(s);if(s==='error'){liveEnabled.current=false;setTranslationEnabled(false);video.current?.pause();}},cue=>{
        setLiveCaption(cue);clearTimeout(captionTimer.current);captionTimer.current=setTimeout(()=>setLiveCaption(null),6500);
        setCues(list=>{const i=list.findIndex(c=>c.start===cue.start);return i<0?[...list,cue]:list.map((c,j)=>j===i?cue:c);});
      });
    }catch(e){stopLive();report(e);}
  }
  async function startTranslation(){
    if(startingTranslation.current)return;
    startingTranslation.current=true;
    try{
      if(media?.kind==='youtube'){await prepare();return;}
      if(translationEnabled){stopLive();return;}
      const probe=mediaProbe.current;
      // Files too large for inline analysis keep the live translator; its
      // timing is corrected against measured speech when the session stops.
      if(probe&&probe.size>0&&!canSendInline(probe)){
        video.current?.pause();
        setNotice('این فایل برای تحلیل کامل بزرگ است؛ ترجمه زنده اجرا می‌شود و زمان‌بندی آن در پایان تنظیم می‌شود.');
        await beginLive();
        return;
      }
      await prepare();
    }finally{startingTranslation.current=false;}
  }
  useEffect(()=>{if(status==='live'&&liveEnabled.current&&video.current?.paused)void video.current.play().catch(report);},[status,report]);

  async function prepare(){
    if(abort.current&&!abort.current.signal.aborted)return;
    if(!media)return;
    if(media.kind==='youtube'&&!media.id)return;
    if(!key.trim()){setSheet(true);setKeyNote('برای آماده‌سازی، کلید Gemini را وارد و ذخیره کن.');return;}
    if(!duration||!Number.isFinite(duration)){setError('ابتدا چند لحظه ویدیو را پخش کن تا مدت آن مشخص شود. پخش زنده یوتیوب برای آماده‌سازی پشتیبانی نمی‌شود.');return;}
    const thisEpoch=++epoch.current;const controller=new AbortController();abort.current=controller;
    stopLive();video.current?.pause();yt.current?.pauseVideo();engine.current?.clearSound();setPlaying(false);setError('');setNotice('');setPreparing(true);setPartialReady(false);setStatus('preparing');setProgress(0);
    const s={...settings};let textCues=cues;
    try{
      // Resume audio from this gesture now, before asynchronous preparation.
      await ensureEngine().resume();
      const addCues=(chunk:Cue[])=>{textCues=[...textCues,...chunk].sort((a,b)=>a.start-b.start);setCues(list=>[...list,...chunk].sort((a,b)=>a.start-b.start));};
      const addClip=(clip:AudioClip)=>{if(epoch.current!==thisEpoch||controller.signal.aborted){URL.revokeObjectURL(clip.url);return;}clipsRef.current=[...clipsRef.current,clip].sort((a,b)=>a.start-b.start);setClips(list=>[...list,clip].sort((a,b)=>a.start-b.start));setPartialReady(true);};
      const dubChunk=async(chunk:Cue[])=>{
        if(s.mode==='subtitle')return;
        chunk=chunk.filter(c=>!clipsRef.current.some(clip=>clip.start<=c.start&&clip.end>=c.end));
        if(!chunk.length)return;
        try{await prepareDubbing({cues:chunk,key,settings:s,signal:controller.signal,decodeAudio:b=>ensureEngine().ctx.decodeAudioData(b),retainOnError:true,onClip:addClip,onProgress:(p,label)=>{if(epoch.current===thisEpoch){setProgress(Math.min(98,45+p*.45));setProgressLabel(label);}}});}
        catch(e){if(!controller.signal.aborted){report(e);setNotice('بخش‌های آماده‌شده قابل پخش‌اند؛ ساخت دوبله برای بخش بعدی متوقف شد.');}}
      };
      if(!textCues.length&&media.kind!=='youtube'){
        const probe=mediaProbe.current||probeMediaFile({name:media.name});
        textCues=await translateMedia({source:{file:sourceFile.current,url:media.kind==='url'?media.url:null,probe},duration,key,settings:s,signal:controller.signal,onProgress:(p,label)=>{if(epoch.current===thisEpoch){setProgress(p*(s.mode==='subtitle'?1:.45));setProgressLabel(label);}},onChunk:async chunk=>{if(epoch.current!==thisEpoch)return;addCues(chunk);if(s.mode==='subtitle')setPartialReady(true);}});
        if(epoch.current!==thisEpoch)return;
        // Batch timestamps already belong to the media; measured speech snaps
        // away any small model drift before the dubbing is built.
        syncDone.current=true;
        try{
          const buffer=await decodeMediaAudio(ensureEngine().ctx,{file:sourceFile.current,url:media.kind==='url'?media.url:null});
          const result=syncCuesToAudio(textCues,buffer.getChannelData(0),buffer.sampleRate,duration);
          if(result.measured){textCues=result.cues;setCues(textCues);}
        }catch{/* مدل زمان‌بندی خودش معتبر است */}
        await dubChunk(textCues);
      } else if(!textCues.length){
        textCues=await translateYoutube({id:media.id!,duration,key,settings:s,signal:controller.signal,onProgress:(p,label)=>{if(epoch.current===thisEpoch){setProgress(p*(s.mode==='subtitle'?1:.45));setProgressLabel(label);}},onChunk:async chunk=>{if(epoch.current!==thisEpoch)return;addCues(chunk);if(s.mode==='subtitle')setPartialReady(true);else await dubChunk(chunk);}});
      } else {
        setCues(textCues);await dubChunk(textCues);
      }
      if(epoch.current!==thisEpoch)return;setProgress(100);setStatus('ready');setNotice('ترجمه آماده است. پخش را بزن؛ برای نگهداری مستقل، خروجی‌ها را دانلود کن.');yt.current?.seekTo(0,true);
    }catch(e){if(epoch.current===thisEpoch&&!controller.signal.aborted){report(e);setStatus(textCues.length?'captions':'error');}}
    finally{if(epoch.current===thisEpoch){setPreparing(false);abort.current=null;}}
  }
  async function togglePlay(){
    if(!media||!mediaReady)return;
    try{
      const e=ensureEngine();await e.resume();
      if(media.kind==='youtube'){if(playing){yt.current?.pauseVideo();e.clearSound();}else{yt.current?.playVideo();}}
      else if(video.current){await e.attach(video.current);if(video.current.paused){if(liveEnabled.current&&!e.active)await beginLive();else await video.current.play();}else video.current.pause();}
    }catch(e){report(e);}
  }
  function seek(t:number){const n=Math.max(0,Math.min(duration,t));engine.current?.clearSound();setLiveCaption(null);if(media?.kind==='youtube'){yt.current?.seekTo(n,true);setTime(n);}else if(video.current){video.current.currentTime=n;setTime(n);}}
  function onPause(){if(video.current?.ended)return;setPlaying(false);engine.current?.clearSound();if(liveEnabled.current){engine.current?.stopLive();setStatus('paused');}}
  function onSeek(){engine.current?.clearSound();setLiveCaption(null);if(liveEnabled.current)engine.current?.stopLive();}
  function onSeeked(){if(liveEnabled.current&&!video.current?.paused)void beginLive();}
  function saveKey(){
    const clean=keyDraft.trim();if(clean&&!isValidApiKey(clean)){setKeyNote('کلید را کامل، بدون فاصله یا شکست خط وارد کن؛ اعتبار خود کلید را گوگل بررسی می‌کند.');return;}
    if(clean!==key){setModelCatalog([]);setModelCatalogNote('');}
    stopLive();setKey(clean);try{if(remember&&clean)localStorage.setItem('hamava.web.key',clean);else localStorage.removeItem('hamava.web.key');setKeyNote(clean?(remember?'کلید در همین مرورگر ذخیره شد.':'کلید فقط برای این بار فعال شد.'):'کلید حذف شد.');}catch{setKeyNote('کلید فعال شد، اما مرورگر اجازه ذخیره نداد.');}
  }
  async function discoverModels(){
    if(!key){setModelCatalogNote('ابتدا کلید API را ذخیره کن.');return;}
    setLoadingModels(true);setModelCatalogNote('در حال دریافت مدل‌های همین API Key…');
    try{
      const found=await fetchGeminiModels(key);
      setModelCatalog(found);
      const counts=(['live','video','tts'] as GeminiModelUse[]).map(use=>modelsForUse(found,use).length);
      setModelCatalogNote(`${found.length.toLocaleString('fa-IR')} مدل دریافت شد؛ Live: ${counts[0].toLocaleString('fa-IR')}، تحلیل: ${counts[1].toLocaleString('fa-IR')}، TTS: ${counts[2].toLocaleString('fa-IR')}.`);
    }catch(e){setModelCatalog([]);setModelCatalogNote(errorText(e,key));}
    finally{setLoadingModels(false);}
  }
  function changeVoice(v:string){update({voice:v as Settings['voice']});if(clips.length){clearPrepared();setStatus('captions');setNotice('برای اعمال صدای جدید، دوبله را دوباره آماده کن.');}}
  function stopRecording(){if(recorder.current?.state==='recording'){video.current?.pause();recorder.current.stop();}}
  async function recordDubbedVideo(){
    if(!media||media.kind==='youtube'||!video.current)return;
    if(!clips.length){setNotice('اول دوبله را آماده کن؛ خروجی ویدیو از همان صدای آماده ساخته می‌شود.');return;}
    if(typeof MediaRecorder==='undefined'){setError('این مرورگر ضبط ویدیو را پشتیبانی نمی‌کند؛ خروجی WAV و زیرنویس را دانلود کن.');return;}
    const own=epoch.current;let stream:MediaStream|undefined;
    try{
      stopLive();video.current.pause();
      const e=ensureEngine();await e.attach(video.current);
      if(own!==epoch.current)return;
      const source=video.current as HTMLVideoElement & {captureStream?:()=>MediaStream};
      source.currentTime=0;setTime(0);
      if(source.seeking)await new Promise<void>((resolve,reject)=>{
        const done=()=>{clearTimeout(timer);source.removeEventListener('seeked',done);resolve();};
        const timer=setTimeout(()=>{source.removeEventListener('seeked',done);reject(new Error('بازگشت ویدیو به ابتدا ممکن نشد.'));},5000);
        source.addEventListener('seeked',done,{once:true});
      });
      if(own!==epoch.current)return;
      const capture=source.captureStream?.();
      if(!capture||!capture.getVideoTracks().length)throw new Error('ضبط تصویر در این مرورگر یا برای این فایل ممکن نیست؛ خروجی WAV و زیرنویس را دانلود کن.');
      stream=new MediaStream(capture.getVideoTracks().map(track=>track.clone()));
      const audio=e.recordingAudioTrack();if(audio)stream.addTrack(audio.clone());
      const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw new Error('مرورگر خروجی ویدیویی WebM را پشتیبانی نمی‌کند.');
      recordedChunks.current=[];let bytes=0;let limited=false;let failed=false;
      const tracks=stream.getTracks();
      const r=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4_000_000});recorder.current=r;
      r.ondataavailable=event=>{if(!event.data.size)return;recordedChunks.current.push(event.data);bytes+=event.data.size;if(bytes>=64*1024*1024&&r.state==='recording'){limited=true;source.pause();r.stop();}};
      r.onerror=()=>{failed=true;setRecording(false);setError('ساخت فایل ویدیویی متوقف شد. خروجی ناقص را دوباره بساز.');};
      r.onstop=()=>{
        tracks.forEach(track=>track.stop());const output=new Blob(recordedChunks.current,{type:mime});recordedChunks.current=[];
        if(recorder.current===r){recorder.current=null;setRecording(false);}
        if(failed||own!==epoch.current||!output.size)return;
        if(recordedUrlRef.current)URL.revokeObjectURL(recordedUrlRef.current);
        const u=URL.createObjectURL(output);recordedUrlRef.current=u;setRecordedUrl(u);
        setNotice(limited?'ضبط در سقف ۶۴ مگابایت متوقف شد؛ فایل این بخش قابل دانلود است.':source.ended?'فایل ویدیوی دوبله‌شده آماده دانلود است.':'ضبط پیش از پایان ویدیو متوقف شد؛ بخش ضبط‌شده قابل دانلود است.');
        void saveVideo(output).catch(()=>setNotice('ویدیو آماده دانلود است، اما ذخیره مرورگر جا ندارد؛ همین حالا دانلود کن.'));
      };
      setRecording(true);r.start(1000);await source.play();
    }catch(error){if(recorder.current?.state==='recording')recorder.current.stop();stream?.getTracks().forEach(track=>track.stop());setRecording(false);report(error);}
  }
  function download(format:'srt'|'vtt'='srt'){
    const content=exportCaptions(cues,{format,bilingual:settings.bilingual,offset:settings.captionOffset});
    saveBlob(new Blob([format==='srt'?'\ufeff':'',content],{type:format==='vtt'?'text/vtt;charset=utf-8':'text/plain;charset=utf-8'}),downloadName(mediaRef.current?.name||'HamAva','زیرنویس فارسی',format));
  }
  /**
   * Render the prepared dubbing clips into one timeline-accurate WAV.
   * This works for every source, including YouTube, whose picture cannot be
   * captured by the browser but whose dubbed audio can be rebuilt offline.
   */
  async function downloadDubAudio(){
    if(!media)return;
    if(settings.mode==='subtitle'){setNotice('در حالت «زیرنویس» صدای دوبله ساخته نمی‌شود؛ حالت «هر دو» یا «دوبله» را انتخاب کن.');return;}
    if(!clips.length){setNotice('اول دوبله را آماده کن تا فایل صدای دوبله ساخته شود.');return;}
    setExportingAudio(true);
    try{
      const ctx=new AudioContext();
      try{
        const {blob}=await renderDubbingTrack({clips:clipsRef.current.map(c=>({start:c.start,end:c.end,url:c.url})),duration:duration||cues.at(-1)?.end||0,decodeAudio:b=>ctx.decodeAudioData(b)});
        saveBlob(blob,downloadName(media.name,'صدای دوبله','wav'));
        setNotice('فایل صدای دوبله آماده شد؛ می‌توانی آن را روی ویدیوی اصلی در یک ویرایشگر میکس کنی.');
      }finally{void ctx.close();}
    }catch(e){report(e);}
    finally{setExportingAudio(false);}
  }
  async function fullscreen(){if(!stage.current)return;try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.current.requestFullscreen();}catch{setNotice('مرورگر اجازه تمام‌صفحه نداد. می‌توانی گوشی را افقی بگیری.');}}
  async function install(){if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);}else setNotice('در Chrome گوشی، منوی سه‌نقطه ← «افزودن به صفحه اصلی» را بزن. اینترنت برای ترجمه لازم است.');}

  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:unknown)=>void}}).modelContext;
    if(!context)return;const lifecycle=new AbortController();
    try{context.registerTool({name:'configure_audio_mix',title:'تنظیم صدای هم‌آوا',description:'Set original and Persian dubbing volume in the current player. Does not start playback or contact Gemini.',inputSchema:{type:'object',properties:{originalVolume:{type:'number',minimum:0,maximum:100},dubVolume:{type:'number',minimum:0,maximum:150}},required:['originalVolume','dubVolume'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const v=input as {originalVolume:number;dubVolume:number};if(!v||!Number.isFinite(v.originalVolume)||!Number.isFinite(v.dubVolume)||v.originalVolume<0||v.originalVolume>100||v.dubVolume<0||v.dubVolume>150)throw new Error('Invalid volume');update({originalVolume:v.originalVolume,dubVolume:v.dubVolume});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {originalVolume:settingsRef.current.originalVolume,dubVolume:settingsRef.current.dubVolume};}},{signal:lifecycle.signal});}catch{}
    return()=>lifecycle.abort();
  },[update]);

  const youtube=media?.kind==='youtube';
  const ready=cues.length>0&&(settings.mode==='subtitle'||clips.length>0);
  const statusLabel=preparing?'آماده‌سازی ترجمه':translationEnabled?(status==='live'?'ترجمه فعال':status==='paused'?'ترجمه مکث شده':status==='reconnecting'?'اتصال دوباره':'اتصال به Gemini'):ready?'آماده پخش':media?'ویدیو انتخاب شده':'منتظر ویدیو';
  const connected=translationEnabled&&status==='live';
  const translationControls={
    mode:settings.mode,onMode:(mode:Mode)=>{if(!recording)update({mode});},preparing,progress,progressLabel,
    disabled:!mediaReady||recording||restoredSource!==media?.identity,
    action:translationEnabled?'stop' as const:ready?(playing?'pause' as const:'play' as const):'translate' as const,
    label:!media?'اول ویدیو را انتخاب کن':translationEnabled?'توقف ترجمه':ready?(playing?'مکث پخش':'پخش با ترجمه'):youtube?(cues.length&&settings.mode!=='subtitle'?'آماده‌سازی دوبله':'شروع ترجمه'):'شروع ترجمه',
    onAction:()=>{if(translationEnabled){stopLive();return;}void (ready?togglePlay():startTranslation());},onCancel:cancelPreparation,partialReady,onPartialAction:()=>{void togglePlay();},
  };
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="./" aria-label="هم‌آوا، صفحه اصلی"><img src="favicon.svg" alt="" width="42" height="42"/><div><h1>هم‌آوا<span>نسخه {APP_VERSION}</span></h1><p>ویدیو به زبان تو</p></div></a><div className="header-actions"><button className="icon-button install-button" onClick={install} title="افزودن به صفحه اصلی" aria-label="افزودن به صفحه اصلی"><Smartphone size={20}/></button><button className="settings-button" onClick={()=>{setSheet(true);setKeyNote('');}}><Settings2 size={19}/><span>تنظیمات</span></button></div></header>
    <main className="workspace">
      <section className="source-panel card" aria-labelledby="source-title"><div className="section-heading"><h2 id="source-title">چی تماشا می‌کنی؟</h2><span className="language-badge">فارسی <span>FA</span></span></div>
        <Tabs dir="rtl" value={tab} onValueChange={v=>setTab(v as SourceKind)}><TabsList className="source-tabs"><TabsTrigger value="file"><Upload/>فایل من</TabsTrigger><TabsTrigger value="url"><Link2/>لینک مستقیم</TabsTrigger><TabsTrigger value="youtube"><Youtube/>یوتیوب</TabsTrigger></TabsList>
          <TabsContent value="file"><div className="file-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!preparing&&!recording)selectFile(e.dataTransfer.files[0]);}}><input ref={file} type="file" accept="video/*,audio/*,.mkv,.mov" aria-label="انتخاب ویدیو از گوشی" onChange={e=>{selectFile(e.target.files?.[0]);e.target.value='';}} disabled={preparing||recording} className="sr-only"/><div className="upload-icon"><Upload size={22}/></div><div><strong>ویدیو را از گوشی انتخاب کن</strong><p>فایل در همین دستگاه پخش می‌شود</p></div><button className="outline-button" disabled={preparing||recording} onClick={()=>file.current?.click()}>انتخاب فایل<ChevronLeft size={16}/></button></div></TabsContent>
          <TabsContent value="url"><form className="link-form" onSubmit={e=>{e.preventDefault();loadLink();}}><label className="sr-only" htmlFor="direct-link">لینک مستقیم ویدیو</label><input id="direct-link" dir="ltr" type="url" placeholder="https://example.com/video.mp4" value={url} onChange={e=>setUrl(e.target.value)} required/><button className="outline-button" disabled={preparing||recording}>باز کردن</button></form><p className="hint">لینک خود فایل، مثل MP4 یا WebM؛ میزبان باید دسترسی صوتی مرورگر را مجاز کرده باشد.</p></TabsContent>
          <TabsContent value="youtube"><form className="link-form" onSubmit={e=>{e.preventDefault();loadLink();}}><label className="sr-only" htmlFor="youtube-link">لینک ویدیوی یوتیوب</label><input id="youtube-link" dir="ltr" type="url" placeholder="https://youtube.com/watch?v=..." value={ytUrl} onChange={e=>setYtUrl(e.target.value)} required/><button className="outline-button" disabled={preparing||recording}>باز کردن</button></form><p className="hint">ویدیوی عمومی: اول ترجمه و دوبله آماده می‌شود، بعد پخش می‌کنی.</p></TabsContent>
        </Tabs>
      </section>

      <section className="viewing-column">
        <div className="player-card"><div className="stage" ref={stage}>
          <video ref={video} src={!youtube?media?.url:undefined} crossOrigin="anonymous" playsInline preload="metadata" className={media&&!youtube?'':'hidden'} onLoadedMetadata={()=>{setDuration(video.current?.duration||0);setMediaReady(true);if(video.current&&!engine.current?.source)video.current.volume=settingsRef.current.mode==='subtitle'?1:settingsRef.current.originalVolume/100;}} onTimeUpdate={()=>{if(!dragging.current)setTime(video.current?.currentTime||0);const v=video.current;if(v)engine.current?.syncPrepared(clipsRef.current,v.currentTime,!v.paused);}} onPlay={()=>{setPlaying(true);if(liveEnabled.current&&!engine.current?.active)void beginLive();}} onPause={onPause} onSeeking={onSeek} onSeeked={onSeeked} onEnded={()=>{setPlaying(false);if(recorder.current?.state==='recording')recorder.current.stop();const own=epoch.current;void engine.current?.finishLive().then(()=>{if(own===epoch.current)stopLive();});}} onError={()=>{if(mediaRef.current?.kind!=='youtube'&&mediaRef.current){setMediaReady(false);stopLive();setError(mediaRef.current.kind==='url'?'ویدیو باز نشد. لینک باید مستقیم، قابل پخش و دارای مجوز CORS باشد. می‌توانی فایل را دانلود و از بخش فایل وارد کنی.':'این فرمت در مرورگر قابل پخش نیست. نسخه MP4 با کدک H.264 یا WebM را امتحان کن.');}}}/>
          <div ref={ytHost} className={`youtube-host ${youtube?'':'hidden'}`}/>
          {!media&&<Empty className="player-empty"><EmptyHeader><EmptyMedia><AudioLines size={48} strokeWidth={1.2}/></EmptyMedia><EmptyTitle>از اینجا، فارسی ببین.</EmptyTitle><EmptyDescription>یک فایل یا لینک انتخاب کن تا شروع کنیم</EmptyDescription></EmptyHeader><div className="empty-tags"><span><Subtitles size={15}/>زیرنویس</span><span><Mic2 size={15}/>دوبله فارسی</span></div></Empty>}
          {!!media&&!youtube&&!playing&&<button className="stage-play" disabled={!mediaReady||status==='connecting'} onClick={togglePlay} aria-label="پخش ویدیو"><Play size={28} fill="currentColor"/></button>}
          {caption&&settings.mode!=='dub'&&<div className={`caption caption-${settings.captionPosition}`} style={{fontSize:`${settings.captionSize}px`,color:settings.captionColor}}><span style={{backgroundColor:`rgba(3,12,17,${settings.captionOpacity/100})`}}>{caption.translation}{settings.bilingual&&caption.source&&<small dir="auto">{caption.source}</small>}</span></div>}
          {media&&<button className="fullscreen-button" onClick={fullscreen} aria-label="نمایش تمام‌صفحه"><Maximize size={18}/></button>}
        </div>
        <div className="transport"><div className="timeline" dir="ltr"><time>{formatTime(time)}</time><Slider dir="ltr" aria-label="زمان ویدیو" value={[Math.min(time,duration||0)]} min={0} max={duration||1} step={.1} disabled={!mediaReady||preparing||recording} onValueChange={v=>{dragging.current=true;setTime(v[0]);}} onValueCommit={v=>{dragging.current=false;seek(v[0]);}}/><time>{formatTime(duration)}</time></div><div className="transport-bottom"><div className="track-info"><span className={`status-light ${connected?'is-live':''}`}/><span>{statusLabel}</span></div><div className="play-controls" dir="ltr"><button aria-label="۱۰ ثانیه عقب" onClick={()=>seek(time-10)} disabled={!mediaReady||preparing||recording}><SkipBack size={18}/></button><button className="main-play" aria-label={playing?'مکث':'پخش'} disabled={!mediaReady||preparing||recording} onClick={togglePlay}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button aria-label="۱۰ ثانیه جلو" onClick={()=>seek(time+10)} disabled={!mediaReady||preparing||recording}><SkipForward size={18}/></button></div></div></div></div>
        {media&&<div className="media-name" dir="auto">{media.name}</div>}

        {error&&<div className="message error-message" role="alert"><CircleHelp size={20}/><p>{error}</p><button onClick={()=>setError('')} aria-label="بستن خطا"><X size={17}/></button></div>}
        {notice&&<div className="message notice-message" role="status"><p>{notice}</p><button onClick={()=>setNotice('')} aria-label="بستن پیام"><X size={17}/></button></div>}
        <section className="transcript card">{liveAudioUrl&&<a className="text-button" href={liveAudioUrl} download={`HamAva-live-dub.${liveAudioExt}`}>دانلود صدای آخرین بخش ترجمه زنده</a>}{recordedUrl&&<a className="text-button" href={recordedUrl} download="HamAva-dubbed.webm">دانلود آخرین ویدیوی ذخیره‌شده</a>}<p className="hint">آخرین ترجمه در این مرورگر نگهداری می‌شود؛ برای بازیابی، همان فایل یا لینک را دوباره انتخاب کن. پاک‌کردن داده‌های مرورگر آن را حذف می‌کند.</p><div className="section-heading"><h2><Subtitles size={19}/>متن ترجمه</h2><button className="text-button" disabled={!cues.length} onClick={()=>download('srt')}><Download size={16}/>SRT</button><button className="text-button" disabled={!cues.length} onClick={()=>download('vtt')}>VTT</button></div>{cues.length?<div className="cue-list">{cues.map((c,i)=><button key={`${c.start}-${i}`} className={`cue-row ${caption===c||caption?.start===c.start?'current':''}`} onClick={()=>seek(c.start+settings.captionOffset)}><time dir="ltr">{formatTime(c.start)}</time><span>{c.translation}{settings.bilingual&&<small dir="auto">{c.source}</small>}</span></button>)}</div>:<div className="transcript-empty"><span className="caption-mark">Aa</span><p>ترجمه‌ها اینجا ظاهر می‌شوند<span>زیرنویس فارسی را هنگام تماشا دنبال کن</span></p></div>}</section>
      </section>

      <aside className="controls-column">
        <section className="translation-card card"><div className="section-heading"><h2><AudioLines size={20}/>ترجمه و دوبله</h2><span className="mini-label">GEMINI</span></div>
          <Choice label="صدای دوبله آماده" value={settings.voice} disabled={preparing||recording} onChange={changeVoice} items={[["auto","خودکار · متناسب با گوینده"],["female","صدای زن · Kore"],["male","صدای مرد · Charon"]]}/><p className="hint voice-hint">صدای آماده، کپی صدای اصلی نیست. انتخاب زن و مرد برای فایل، لینک و یوتیوب اعمال می‌شود؛ ترجمه زنده تنظیم صدای جداگانه دارد.</p>
          <div className="desktop-translation-controls"><TranslationControls {...translationControls}/></div>
          {!key?<button className="key-reminder" onClick={()=>setSheet(true)}><KeyRound size={16}/>کلید Gemini را در تنظیمات وارد کن<ChevronLeft size={14}/></button>:<div className="key-ready"><Check size={14}/>کلید شخصی وارد شده است</div>}
          {ready&&!preparing&&<button className="text-button redo" onClick={()=>{clearPrepared();setCues([]);setStatus('idle');setNotice('برای ترجمه دوباره، آماده‌سازی را بزن.');}}><RotateCcw size={14}/>آماده‌سازی دوباره</button>}
          {!youtube&&media&&<div className="export-actions card"><div><strong>خروجی ویدیوی دوبله</strong><small>خروجی WebM از دوبله آماده، با صدای اصلی ۲۵٪ و دوبله کامل ساخته می‌شود؛ ولوم شنیدن روی فایل اثر ندارد. صفحه را باز نگه دار. سقف هر ضبط ۶۴ مگابایت است.</small></div>{recordedUrl?<a className="primary-button" href={recordedUrl} download="HamAva-dubbed.webm"><Download size={17}/>دانلود ویدیوی دوبله</a>:<button className="outline-button" disabled={!mediaReady||!clips.length||preparing||recording||settings.mode==='subtitle'} onClick={()=>{void recordDubbedVideo();}}>{recording?'در حال ضبط…':'ساخت خروجی دوبله'}</button>}<button className="outline-button" disabled={exportingAudio||preparing||!clips.length} onClick={()=>{void downloadDubAudio();}}><AudioLines size={17}/>صدای دوبله</button>{recording&&<button className="text-button" onClick={stopRecording}>توقف و آماده‌سازی فایل</button>}</div>}
          {youtube&&media&&<div className="export-actions card"><div><strong>خروجی دوبله یوتیوب</strong><small>مرورگر اجازه ضبط تصویر یوتیوب را نمی‌دهد؛ صدای دوبله و زیرنویس را دانلود کن و روی ویدیوی اصلی در یک ویرایشگر میکس کن.</small></div><button className="outline-button" disabled={exportingAudio||preparing||!clips.length} onClick={()=>{void downloadDubAudio();}}><AudioLines size={17}/>دانلود صدای دوبله</button></div>}
          <p className="usage-note">{youtube?'یوتیوب باید یک‌بار کامل تحلیل شود؛ برای کمترین تأخیر از فایل یا لینک مستقیم استفاده کن.':'فایل با تحلیل کامل ترجمه می‌شود و زمان‌بندی روی صدای واقعی تنظیم می‌شود؛ صفحه را هنگام آماده‌سازی باز نگه دار.'}</p>
        </section>
        <section className="mixer-card card"><div className="section-heading"><h2>ترکیب صدا</h2><Volume2 size={19}/></div><Range label="صدای اصلی" value={settings.originalVolume} onChange={v=>update({originalVolume:v})} icon={<Volume2 size={17}/>}/><Range label="دوبله فارسی" value={settings.dubVolume} max={150} onChange={v=>update({dubVolume:v})} icon={<Mic2 size={17}/>}/><Toggle label="کاهش صدای اصلی هنگام دوبله" checked={settings.duck} onChange={v=>update({duck:v})}/></section>
        <button className="subtitle-shortcut card" onClick={()=>setSheet(true)}><span className="subtitle-icon"><Subtitles size={22}/></span><span><strong>زیرنویس به سلیقه تو</strong><small>اندازه، رنگ و نمایش دوزبانه</small></span><ChevronLeft size={18}/></button>
      </aside>
    </main>
    <footer className="app-footer"><span>هم‌آوا <b>·</b> نسخه {APP_VERSION}</span><span>بدون سقف داخلی؛ هزینه و سهمیه تابع Gemini است.</span><a className="footer-github" href="https://github.com/mostafa5804/HamAva" target="_blank" rel="noreferrer" aria-label="کد منبع هم‌آوا در GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.08c-3.1.67-3.75-1.32-3.75-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.06 1.15a10.6 10.6 0 0 1 5.57 0c2.13-1.45 3.06-1.15 3.06-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.23-5.1 5.51.4.34.76 1.03.76 2.08v3.05c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg><span>کد منبع در GitHub</span></a></footer>
    <section className="mobile-translation-dock" aria-label="کنترل سریع ترجمه"><TranslationControls {...translationControls}/></section>

    <Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="left" showCloseButton={false} className="settings-sheet" dir="rtl"><SheetHeader><div className="section-heading"><SheetTitle>تنظیمات هم‌آوا</SheetTitle><SheetClose className="icon-button" aria-label="بستن تنظیمات"><X size={21}/></SheetClose></div><SheetDescription>تنظیمات مخصوص همین مرورگر</SheetDescription></SheetHeader>
      <div className="settings-scroll"><section><h3><KeyRound size={19}/>کلید Gemini</h3><label htmlFor="api-key">کلید API از AI Studio (AQ. یا AIza)</label><div className="key-input"><input id="api-key" dir="ltr" type={showKey?'text':'password'} autoComplete="off" spellCheck={false} placeholder="AQ.… یا AIza…" value={keyDraft} onChange={e=>{setKeyDraft(e.target.value);setKeyNote('');}}/><button className="icon-button" onClick={()=>setShowKey(v=>!v)} aria-label={showKey?'پنهان کردن کلید':'نمایش کلید'}>{showKey?<EyeOff size={19}/>:<Eye size={19}/>}</button></div><Toggle label="ذخیره کلید در این مرورگر" checked={remember} onChange={v=>{setRemember(v);if(!v){try{localStorage.removeItem('hamava.web.key');}catch{}}}}/><div className="key-buttons"><button className="primary-button" disabled={preparing||recording} onClick={saveKey}><Check size={17}/>ذخیره کلید</button><button className="outline-button" disabled={preparing||!key} onClick={()=>{setKey('');setKeyDraft('');setModelCatalog([]);setModelCatalogNote('');stopLive();try{localStorage.removeItem('hamava.web.key');}catch{}setKeyNote('کلید حذف شد.');}}>حذف کلید</button></div>{keyNote&&<p className="key-note" role="status">{keyNote}</p>}<p className="hint">کلید به سرور هم‌آوا فرستاده نمی‌شود؛ برای ترجمه، کلید و صدای ویدیو یا لینک یوتیوب مستقیم به گوگل ارسال می‌شوند. ذخیره مرورگر رمزنگاری جداگانه ندارد.</p><a className="inline-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">دریافت کلید از Google AI Studio <ChevronLeft size={14}/></a></section>
        <section><h3><Subtitles size={19}/>نمایش زیرنویس</h3><div className="caption-preview"><span style={{fontSize:settings.captionSize,color:settings.captionColor,backgroundColor:`rgba(3,12,17,${settings.captionOpacity/100})`}}>دنیا را به زبان خودت ببین.{settings.bilingual&&<small>See the world in your language.</small>}</span></div><Range label="اندازه نوشته" value={settings.captionSize} min={16} max={40} suffix="" onChange={v=>update({captionSize:v})}/><Range label="تیرگی پس‌زمینه" value={settings.captionOpacity} onChange={v=>update({captionOpacity:v})}/><Choice label="جای زیرنویس" value={settings.captionPosition} onChange={v=>update({captionPosition:v as Settings['captionPosition']})} items={[["bottom","پایین تصویر"],["top","بالای تصویر"]]}/><Choice label="رنگ نوشته" value={settings.captionColor} onChange={v=>update({captionColor:v})} items={[["#ffffff","سفید"],["#ffe59a","زرد روشن"],["#9df0da","سبز روشن"]]}/><Toggle label="نمایش متن اصلی کنار فارسی" checked={settings.bilingual} onChange={v=>update({bilingual:v})}/><Range label="تأخیر زیرنویس" value={settings.captionOffset} min={-10} max={10} step={.25} suffix=" ثانیه" onChange={v=>update({captionOffset:v})}/></section>
        <section>
          <h3><Settings2 size={19}/>مدل‌های Gemini</h3>
          <p className="hint">برای هر کار، مدل جدا انتخاب می‌شود. شناسهٔ مدل را می‌توانی از فهرست API Key انتخاب کنی یا دستی وارد کنی؛ انتخاب مدل نامناسب ممکن است با خطای API روبه‌رو شود.</p>
          <button className="outline-button model-scan-button" onClick={()=>void discoverModels()} disabled={!key||loadingModels||preparing||recording}>
            <RefreshCw size={16} className={loadingModels?'spin':''}/>{loadingModels?'در حال بررسی…':'بررسی مدل‌های API Key'}
          </button>
          {modelCatalogNote&&<p className="model-catalog-note" role="status">{modelCatalogNote}</p>}
          <p className="hint model-access-note">فهرست برای پروژهٔ متصل به همین API Key است. فهرست‌شدن، سهمیه یا مجازبودن همهٔ قابلیت‌های مدل را تضمین نمی‌کند؛ اشتراک Gemini Pro هم جدا از سهمیهٔ Gemini API است.</p>
          {([
            ['model','ترجمه زنده (فایل‌های بزرگ)','live'],
            ['videoModel','تحلیل ویدیو و فایل','video'],
            ['ttsModel','ساخت صدای فارسی','tts'],
          ] as const).map(([field,label,use])=>{
            const options=modelsForUse(modelCatalog,use as GeminiModelUse);
            const listId=`${use}-model-options`;
            return <div className="model-field" key={field}>
              <label htmlFor={field}>{label}</label>
              <input id={field} list={listId} dir="ltr" autoComplete="off" spellCheck={false} defaultValue={settings[field]} key={`${field}:${settings[field]}`} disabled={preparing||recording} onBlur={e=>{
                if(e.target.value!==settings[field]){
                  if(!/^[a-z0-9.-]{4,100}$/i.test(e.target.value)){e.target.value=settings[field];return;}
                  stopLive();update({[field]:e.target.value});
                  if(field!=='model'){clearPrepared();setCues([]);setStatus('idle');}
                }
              }}/>
              <datalist id={listId}>{options.map(model=><option value={model.id} label={model.displayName} key={model.id}/>)}</datalist>
              <small>{options.length?`${options.length.toLocaleString('fa-IR')} مدل از فهرست API برای این کاربرد پیدا شد.`:'برای دیدن گزینه‌ها «بررسی مدل‌های API Key» را بزن؛ شناسهٔ دستی هم پذیرفته می‌شود.'}</small>
            </div>;
          })}
          <p className="hint">حفظ لحن در ترجمه همزمان تقریبی است و ممکن است بین گوینده‌ها تغییر کند.</p>
        </section>
        <button className="text-button" disabled={preparing||recording} onClick={()=>{void archiveWrites.current.then(()=>clearArchive()).then(()=>{if(recordedUrlRef.current)URL.revokeObjectURL(recordedUrlRef.current);recordedUrlRef.current='';setRecordedUrl('');if(liveAudioUrlRef.current)URL.revokeObjectURL(liveAudioUrlRef.current);liveAudioUrlRef.current='';setLiveAudioUrl('');setNotice('نسخه ذخیره‌شده خروجی‌ها حذف شد.');}).catch(report);}}>حذف خروجی‌های ذخیره‌شده مرورگر</button>
        <button className="outline-button install-wide" onClick={install}><Smartphone size={18}/>افزودن به صفحه اصلی گوشی</button>
      </div>
    </SheetContent></Sheet>
  </div>;
}
