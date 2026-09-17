// The single source of truth for user settings is `types.ts`; this module only
// holds what the audio engine and the Live socket need at runtime.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
export function makeSetup(s, layout = 'guide') {
  const generationConfig = {responseModalities:['AUDIO'], translationConfig:{targetLanguageCode:s.target, echoTargetLanguage:s.echo}};
  const setup = {model:`models/${s.model}`, generationConfig};
  // Current Live Translate guide nests transcription here. Older API deployments
  // use setup-level fields. Retry that layout ONLY after an explicit schema error.
  Object.assign(layout === 'guide' ? generationConfig : setup, {inputAudioTranscription:{},outputAudioTranscription:{}});
  return {setup};
}
export function bytesBase64(bytes) {
  let str = '';
  for (let i=0;i<bytes.length;i+=8192) str += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(str);
}
export function decodePCM(data) {
  const str = atob(data), n = Math.floor(str.length/2), out = new Float32Array(n);
  for (let i=0;i<n;i++) {let v = str.charCodeAt(2*i) | str.charCodeAt(2*i+1)<<8; if(v>32767)v-=65536; out[i]=v/32768;}
  return out;
}
export function pcmRate(mime='') {return clamp(/rate=(\d+)/i.exec(mime)?.[1] || 24000,8000,96000);}
export function safeError(error, key='') {
  let msg = String(error?.message || error || 'خطای نامشخص');
  if (key) msg = msg.split(key).join('[حذف‌شده]');
  return msg.replace(/AIza[\w-]+/g,'[حذف‌شده]').replace(/([?&]key=)[^\s&"']+/gi,'$1[حذف‌شده]').slice(0,450);
}
export function timecode(seconds, vtt=false) {
  const ms=Math.max(0,Math.round((Number(seconds)||0)*1000));
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${vtt?'.':','}${String(ms%1000).padStart(3,'0')}`;
}
export function exportCaptions(cues,{format='srt',bilingual=false,offset=0}={}) {
  const vtt=format==='vtt';
  const text = cues.filter(c=>c.translation?.trim()).map((c,i)=>{
    const a=Math.max(0,c.start+offset), b=Math.max(a+.1,c.end+offset);
    const clean = t=>String(t||'').replace(/-->/g,'→').replace(/[<>]/g,'').trim();
    return `${vtt?'':i+1+'\n'}${timecode(a,vtt)} --> ${timecode(b,vtt)}\n${clean(c.translation)}${bilingual&&c.source?'\n'+clean(c.source):''}\n`;
  }).join('\n');
  return (vtt?'WEBVTT\n\n':'')+text;
}
