// Downsample arbitrary device rates to 16 kHz mono with area averaging.
// Keep a fractional bin across render quanta (including 44.1 kHz devices).
class HamavaPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.width=sampleRate/16000; this.left=this.width; this.sum=0;
    this.frame=new Int16Array(1600); this.pos=0; this.energy=0;
  }
  process(inputs) {
    const channels=inputs[0]; if(!channels?.length) return true;
    for(let i=0;i<channels[0].length;i++) {
      let v=0; for(const c of channels)v+=c[i]||0; v/=channels.length;
      let remaining=1;
      while(remaining>1e-7) {
        const take=Math.min(this.left,remaining); this.sum+=v*take; this.left-=take; remaining-=take;
        if(this.left<1e-7) {
          const s=Math.max(-1,Math.min(1,this.sum/this.width));
          this.frame[this.pos++]=s<0?Math.round(s*32768):Math.round(s*32767); this.energy+=s*s;
          this.sum=0; this.left=this.width;
          if(this.pos===1600) {
            const bytes=new Uint8Array(3200),view=new DataView(bytes.buffer);
            for(let j=0;j<1600;j++)view.setInt16(j*2,this.frame[j],true);
            this.port.postMessage({bytes:bytes.buffer,rms:Math.sqrt(this.energy/1600)},[bytes.buffer]);
            this.pos=0;this.energy=0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('hamava-pcm',HamavaPCM);
