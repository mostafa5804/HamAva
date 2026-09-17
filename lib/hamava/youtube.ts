export interface YouTubePlayer {
  playVideo():void;pauseVideo():void;seekTo(t:number,allowSeekAhead:boolean):void;
  setVolume(n:number):void;getCurrentTime():number;getDuration():number;getPlayerState():number;
  destroy():void;getVideoData():{title?:string};
}
type YouTubeAPI={Player:new(node:HTMLElement,options:Record<string,unknown>)=>YouTubePlayer};
declare global { interface Window { YT?:YouTubeAPI; onYouTubeIframeAPIReady?:()=>void; } }
let loading:Promise<YouTubeAPI>|undefined;
export function loadYoutube():Promise<YouTubeAPI>{
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;
    const timer=setTimeout(()=>{loading=undefined;script.remove();reject(new Error('یوتیوب بارگذاری نشد. دسترسی اینترنت به یوتیوب را بررسی کن.'));},20000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);if(window.YT)resolve(window.YT);};
    script.onerror=()=>{clearTimeout(timer);loading=undefined;script.remove();reject(new Error('یوتیوب در دسترس نیست. اتصال را بررسی کن.'));};document.head.appendChild(script);
  });return loading;
}
