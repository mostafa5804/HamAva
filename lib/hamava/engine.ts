import { appAsset } from './assets';
import { LiveClient } from './live-client.js';
import { bytesBase64,decodePCM,pcmRate } from './shared.js';
import type { Cue, Settings, AudioClip } from './types';

/** One server-content message of the Live API, in either field-name style. */
type LivePart = { inlineData?: { data?: string; mimeType?: string; mime_type?: string }; inline_data?: { data?: string; mimeType?: string; mime_type?: string } };
type LiveContent = {
  interrupted?: boolean;
  inputTranscription?: { text?: string } | null; input_transcription?: { text?: string } | null;
  outputTranscription?: { text?: string } | null; output_transcription?: { text?: string } | null;
  modelTurn?: { parts?: LivePart[] } | null;
  model_turn?: { parts?: LivePart[] } | null;
  turnComplete?: boolean; turn_complete?: boolean;
};

export class MediaEngine {
  ctx:AudioContext; original:GainNode; dub:GainNode; video?:HTMLVideoElement;
  liveDestination:MediaStreamAudioDestinationNode; liveRecorder?:MediaRecorder; finishing=false; turnFinished=false; cueTimer?:ReturnType<typeof setTimeout>; onRecorded?:(blob:Blob)=>void;
  recordingDestination:MediaStreamAudioDestinationNode; exportOriginal:GainNode; dubBus:GainNode;
  source?:MediaElementAudioSourceNode; worklet?:AudioWorkletNode; silent?:GainNode;
  client?:LiveClient; settings:Settings;
  active=false; queued=0; nodes=new Set<AudioBufferSourceNode>(); generation=0;
  clipUrl=''; clipEpoch=0; private workletLoaded=false;
  private preparedBuffers=new Map<string,AudioBuffer>(); private preparedLoading=new Map<string,Promise<AudioBuffer>>();
  private preparedNode?:AudioBufferSourceNode; private preparedStartTime=0; private preparedStartOffset=0; private preparedRate=1;
  private preparedTime=0; private preparedPlaying=false;
  onError:(e:unknown)=>void; onTalking:(value:boolean)=>void;
  constructor(settings:Settings,onError:(e:unknown)=>void,onTalking:(v:boolean)=>void) {
    this.ctx=new AudioContext();this.settings=settings;this.onError=onError;this.onTalking=onTalking;
    this.original=this.ctx.createGain();this.original.connect(this.ctx.destination);
    this.dub=this.ctx.createGain();this.dub.connect(this.ctx.destination);
    this.recordingDestination=this.ctx.createMediaStreamDestination();
    this.exportOriginal=this.ctx.createGain();this.exportOriginal.connect(this.recordingDestination);
    this.dubBus=this.ctx.createGain();this.dubBus.connect(this.dub);this.dubBus.connect(this.recordingDestination);
    this.liveDestination=this.ctx.createMediaStreamDestination();this.dubBus.connect(this.liveDestination);
    this.apply(settings);
  }
  recordingAudioTrack(){return this.recordingDestination.stream.getAudioTracks()[0];}
  async resume(){await this.ctx.resume();}
  async attach(video:HTMLVideoElement) {
    await this.resume();
    if(this.video===video)return;
    if(this.source)throw new Error('پلیر آماده نیست. صفحه را دوباره باز کن.');
    this.video=video;video.volume=1;
    this.source=this.ctx.createMediaElementSource(video);this.source.connect(this.original);this.source.connect(this.exportOriginal);
  }
  apply(s:Settings,talking=false){
    this.settings=s; const t=this.ctx.currentTime;
    this.original.gain.setTargetAtTime((s.mode==='subtitle'?1:s.originalVolume/100)*(s.duck&&talking&&s.mode!=='subtitle'?.2:1),t,.06);
    this.exportOriginal.gain.setTargetAtTime(s.mode==='subtitle'?1:.25*(s.duck&&talking?.2:1),t,.06);
    this.dub.gain.setTargetAtTime(s.mode==='subtitle'?0:s.dubVolume/100,t,.025);
  }
  clearSound(){
    this.clipEpoch++;this.clipUrl='';this.preparedNode=undefined;this.preparedPlaying=false;
    for(const n of this.nodes){n.onended=null;try{n.stop();}catch{}}
    this.nodes.clear();this.queued=0;this.onTalking(false);this.apply(this.settings);
  }
  stopLive(){clearTimeout(this.cueTimer);this.finishing=false;if(this.liveRecorder?.state==='recording')this.liveRecorder.stop();this.liveRecorder=undefined;this.generation++;this.active=false;this.client?.close();this.client=undefined;this.clearSound();}
  async finishLive(){
    if(!this.active)return;
    this.finishing=true;this.client?.finishInput();const gen=this.generation,deadline=Date.now()+8000;
    while(gen===this.generation&&Date.now()<deadline&&(!this.turnFinished||this.nodes.size))await new Promise(resolve=>setTimeout(resolve,100));
    if(gen===this.generation)this.stopLive();
  }
  private recordLive(){
    if(this.settings.mode==='subtitle'||typeof MediaRecorder==='undefined')return;
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)return;
    const recorder=new MediaRecorder(this.liveDestination.stream,{mimeType:mime});this.liveRecorder=recorder;
    const chunks:Blob[]=[];let bytes=0;
    recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}if(bytes>=64*1024*1024&&recorder.state==='recording'){recorder.stop();this.onError(new Error('ضبط صوت به سقف ۶۴ مگابایت رسید؛ خروجی این بخش آماده دانلود است.'));}};
    recorder.onstop=()=>{if(chunks.length)this.onRecorded?.(new Blob(chunks,{type:mime}));};
    recorder.onerror=()=>this.onError(new Error('ضبط صدای زنده در این مرورگر متوقف شد.'));
    recorder.start(1000);
  }
  async startLive(key:string,onState:(s:string)=>void,onCue:(cue:Cue)=>void) {
    this.stopLive(); const gen=++this.generation;
    if(!this.source||!this.video)throw new Error('ابتدا ویدیو را انتخاب کن.');
    await this.resume();
    if(!this.workletLoaded){await this.ctx.audioWorklet.addModule(appAsset('audio-worklet.js'));this.workletLoaded=true;}
    if(gen!==this.generation)return;
    if(!this.worklet){
      this.worklet=new AudioWorkletNode(this.ctx,'hamava-pcm');this.silent=this.ctx.createGain();this.silent.gain.value=0;
      this.source.connect(this.worklet);this.worklet.connect(this.silent);this.silent.connect(this.ctx.destination);
      this.worklet.port.onmessage=e=>{if(this.active&&this.video&&!this.video.paused&&!this.video.seeking&&!this.video.ended){if(!this.client?.sendAudio(bytesBase64(new Uint8Array(e.data.bytes)))){this.video.pause();this.onError(new Error('ارسال صدا متوقف شد. پس از بازیابی اتصال، پخش را دوباره بزن.'));}else{this.turnFinished=false;}}};
    }
    this.active=true;this.turnFinished=false;try{this.recordLive();}catch{this.onError(new Error('ضبط صوت در این مرورگر ممکن نشد؛ ترجمه ادامه دارد.'));}let source='',translation='',start=-1;
    const publish=(final=false)=>{
      if(!translation.trim()||gen!==this.generation)return;
      onCue({start:Math.max(0,start),end:Math.max(start+.5,this.video!.currentTime),source,translation,speaker:'',voice:'unknown'});
      if(final){source='';translation='';start=-1;}
    };
    this.client=new LiveClient({key,settings:{...this.settings,target:'fa',echo:false},onUsage:()=>{},
      onState:(s:{phase:string})=>{if(gen!==this.generation)return;if(s.phase==='reconnecting'){this.clearSound();this.video?.pause();}onState(s.phase);},
      onFatal:(e:Error)=>{if(gen!==this.generation)return;this.stopLive();this.onError(e);onState('error');},
      onContent:(c:LiveContent)=>{
        if(gen!==this.generation||(!this.finishing&&this.video!.paused)||this.video!.seeking)return;
        if(c.interrupted){this.clearSound();source='';translation='';start=-1;return;}
        if(start<0)start=this.video!.currentTime;
        if(c.modelTurn||c.model_turn||c.outputTranscription||c.output_transcription)this.turnFinished=false;
        const input=c.inputTranscription||c.input_transcription, output=c.outputTranscription||c.output_transcription;
        if(input?.text)source+=input.text;if(output?.text)translation+=output.text;
        if(output?.text){publish();clearTimeout(this.cueTimer);this.cueTimer=setTimeout(()=>publish(true),3000);}
        for(const part of (c.modelTurn||c.model_turn)?.parts||[]) {
          const data=part.inlineData||part.inline_data;
          if(data?.data&&this.settings.mode!=='subtitle')this.enqueue(data.data,pcmRate(data.mimeType||data.mime_type));
        }
        if(c.turnComplete||c.turn_complete){clearTimeout(this.cueTimer);this.turnFinished=true;publish(true);}
      }
    });this.client.connect();
  }
  enqueue(data:string,rate:number){
    const pcm=decodePCM(data);if(!pcm.length)return;
    const now=this.ctx.currentTime;
    if(this.queued-now>10){this.clearSound();this.onError(new Error('دوبله از ویدیو عقب افتاد؛ اتصال یا سرعت پخش را بررسی کن.'));return;}
    const b=this.ctx.createBuffer(1,pcm.length,rate);b.copyToChannel(pcm,0);
    const node=this.ctx.createBufferSource();node.buffer=b;node.connect(this.dubBus);
    this.queued=Math.max(now+.03,this.queued);node.start(this.queued);this.queued+=b.duration;this.nodes.add(node);
    this.onTalking(true);this.apply(this.settings,true);
    node.onended=()=>{this.nodes.delete(node);node.disconnect();if(!this.nodes.size){this.onTalking(false);this.apply(this.settings);}};
  }
  syncPrepared(clips:AudioClip[],time:number,playing:boolean){
    // YouTube is hosted in a cross-origin iframe, so this.video is intentionally
    // unset. Keep the latest playback state here and use it when async decoding
    // finishes; otherwise prepared YouTube clips are silently discarded.
    this.preparedTime=time;this.preparedPlaying=playing;
    if(!playing||this.settings.mode==='subtitle'){if(this.clipUrl)this.clearSound();return;}
    const c=clips.find(c=>time>=c.start&&time<c.end);
    if(!c){if(this.clipUrl)this.clearSound();return;}
    const rate=Math.max(.25,Math.min(16,c.duration/(c.end-c.start)));
    const target=Math.min(c.duration-.01,Math.max(0,(time-c.start)*rate));
    const changed=this.clipUrl!==c.url;
    if(changed){
      this.stopPreparedNode();this.clipEpoch++;this.clipUrl=c.url;
      const epoch=this.clipEpoch;
      void this.loadPreparedBuffer(c.url).then(buffer=>{
        if(epoch!==this.clipEpoch||!this.preparedPlaying)return;
        const current=clips.find(clip=>clip.url===c.url&&this.preparedTime>=clip.start&&this.preparedTime<clip.end);
        if(current)this.startPreparedClip(current,buffer,this.preparedTime);
      }).catch(error=>{
        if(epoch===this.clipEpoch)this.onError(new Error('خواندن صدای دوبله برای پخش ممکن نشد.',{cause:error}));
      });
      return;
    }
    if(!this.preparedNode)return;
    const elapsed=(this.ctx.currentTime-this.preparedStartTime)*this.preparedRate;
    const expected=this.preparedStartOffset+elapsed;
    if(Math.abs(expected-target)>.55||Math.abs(this.preparedRate-rate)>.01){
      const buffer=this.preparedBuffers.get(c.url);if(buffer)this.startPreparedClip(c,buffer,time);
    }
  }
  private loadPreparedBuffer(url:string):Promise<AudioBuffer>{
    const cached=this.preparedBuffers.get(url);if(cached)return Promise.resolve(cached);
    const pending=this.preparedLoading.get(url);if(pending)return pending;
    const request=fetch(url).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.arrayBuffer();}).then(data=>this.ctx.decodeAudioData(data)).then(buffer=>{this.preparedBuffers.set(url,buffer);while(this.preparedBuffers.size>8)this.preparedBuffers.delete(this.preparedBuffers.keys().next().value!);return buffer;}).finally(()=>this.preparedLoading.delete(url));
    this.preparedLoading.set(url,request);return request;
  }
  private stopPreparedNode(){const node=this.preparedNode;if(!node)return;this.preparedNode=undefined;node.onended=null;this.nodes.delete(node);try{node.stop();}catch{}try{node.disconnect();}catch{}}
  private startPreparedClip(clip:AudioClip,buffer:AudioBuffer,time:number){
    this.stopPreparedNode();
    const node=this.ctx.createBufferSource();node.buffer=buffer;node.playbackRate.value=Math.max(.25,Math.min(16,clip.duration/(clip.end-clip.start)));node.connect(this.dubBus);
    const offset=Math.min(buffer.duration-.01,Math.max(0,(time-clip.start)*node.playbackRate.value));
    this.preparedNode=node;this.preparedStartTime=this.ctx.currentTime;this.preparedStartOffset=offset;this.preparedRate=node.playbackRate.value;
    this.nodes.add(node);node.onended=()=>{this.nodes.delete(node);node.disconnect();if(this.preparedNode===node){this.preparedNode=undefined;this.onTalking(false);this.apply(this.settings);}};
    try{node.start(0,offset);this.onTalking(true);this.apply(this.settings,true);}catch(error){this.stopPreparedNode();this.onError(error);}
  }
  dispose(){this.stopLive();this.source?.disconnect();this.worklet?.disconnect();this.preparedBuffers.clear();this.preparedLoading.clear();void this.ctx.close();}
}
