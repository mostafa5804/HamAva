import {makeSetup,safeError} from './shared.js';
const BASE='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export class LiveClient {
  constructor({key,settings,onContent,onState,onFatal,onUsage,WebSocketClass=globalThis.WebSocket}) {
    Object.assign(this,{key,settings,onContent,onState,onFatal,onUsage,WebSocketClass});
    this.closed=false;this.ready=false;this.attempt=0;this.layout='guide';this.serial=0;this.hasConnected=false;
  }
  connect() {
    if(this.closed)return;
    const serial=++this.serial; clearTimeout(this.timer); this.ready=false;
    const ws=new this.WebSocketClass(`${BASE}?key=${encodeURIComponent(this.key)}`);this.ws=ws;
    ws.binaryType='arraybuffer';
    this.onState?.({phase:this.hasConnected?'reconnecting':'connecting',attempt:this.attempt});
    let closed=false;const fail=(err)=>{if(closed||this.closed||serial!==this.serial)return;closed=true;this.failed(err);};
    const timeout=setTimeout(()=>{fail(new Error('WebSocket setup timeout'));ws.close();},18000);
    ws.onopen=()=>{if(serial===this.serial&&!this.closed)ws.send(JSON.stringify(makeSetup(this.settings,this.layout)));};
    ws.onmessage=async event=>{
      if(this.closed||serial!==this.serial)return;
      try {
        const raw=typeof event.data==='string'?event.data:event.data instanceof ArrayBuffer?new TextDecoder().decode(event.data):await event.data.text();
        if(this.closed||serial!==this.serial)return;
        const msg=JSON.parse(raw);
        if(msg.error){clearTimeout(timeout);fail(new Error(msg.error.message||JSON.stringify(msg.error)));ws.close();return;}
        if(msg.setupComplete!==undefined||msg.setup_complete!==undefined){
          clearTimeout(timeout);this.ready=true;this.attempt=0;this.hasConnected=true;this.onState?.({phase:'live'});
        }
        if(msg.serverContent||msg.server_content)this.onContent?.(msg.serverContent||msg.server_content);
        if(msg.usageMetadata||msg.usage_metadata)this.onUsage?.(msg.usageMetadata||msg.usage_metadata);
        if(msg.goAway||msg.go_away) {
          // Start a fresh translation session; never claim gapless resumption.
          clearTimeout(timeout);fail(new Error('server requested session renewal'));ws.close();
        }
      } catch(err){clearTimeout(timeout);fail(err);ws.close();}
    };
    ws.onerror=()=>{}; // Browser errors omit details; onclose supplies a code.
    ws.onclose=e=>{clearTimeout(timeout);fail(new Error(`${e.code} ${e.reason||'WebSocket closed'}`));};
  }
  failed(error) {
    this.ready=false; const message=safeError(error,this.key);
    if(this.layout==='guide'&&/unknown name|cannot find field|unknown field/i.test(message)&&/transcription/i.test(message)) {
      this.layout='standard';this.timer=setTimeout(()=>this.connect(),150);return;
    }
    if(/1008|1003|1007|400|401|403|404|429|quota|resource_exhausted|permission|invalid|not found|not supported|API.?key/i.test(message)||this.attempt>=5) {
      this.close();this.onFatal?.(new Error(message));return;
    }
    this.attempt++;
    const delay=Math.min(16000,1000*2**(this.attempt-1));
    this.onState?.({phase:'reconnecting',attempt:this.attempt,notice:'اتصال در حال بازیابی است؛ صدای این فاصله ترجمه نمی‌شود.'});
    this.timer=setTimeout(()=>this.connect(),delay);
  }
  sendAudio(data) {
    if(!this.ready||this.closed||this.ws?.readyState!==1)return false;
    // Never accumulate seconds of stale audio over a slow connection.
    if(this.ws.bufferedAmount>256000)return false;
    this.ws.send(JSON.stringify({realtimeInput:{audio:{data,mimeType:'audio/pcm;rate=16000'}}}));return true;
  }
  close() {
    this.closed=true;this.ready=false;this.serial++;clearTimeout(this.timer);
    if(this.ws){this.ws.onclose=null;this.ws.onerror=null;try{this.ws.close();}catch{}}
  }
}
