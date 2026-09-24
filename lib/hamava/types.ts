export type Mode = 'both' | 'subtitle' | 'dub';
export type SourceKind = 'file' | 'url' | 'youtube';
export interface Settings {
  mode: Mode; originalVolume: number; dubVolume: number; duck: boolean;
  bilingual: boolean; captionSize: number; captionOpacity: number;
  captionPosition: 'bottom' | 'top'; captionColor: string; captionOffset: number;
  voice: 'auto' | 'female' | 'male'; model: string; videoModel: string; ttsModel: string;
}
export function isValidApiKey(value: string): boolean {
  // Google auth keys use a different prefix and can contain punctuation (for example, `AQ.`).
  // Treat a key as an opaque printable token; the API verifies whether it is real and enabled.
  return value.length >= 12 && value.length <= 2048 && /^[\x21-\x7e]+$/.test(value);
}
export interface Cue { start: number; end: number; source: string; translation: string; speaker: string; voice: 'female' | 'male' | 'unknown'; }
export interface AudioClip { start: number; end: number; url: string; duration: number; }
export const defaults: Settings = {
  mode: 'both', originalVolume: 25, dubVolume: 100, duck: true, bilingual: false,
  captionSize: 22, captionOpacity: 80, captionPosition: 'bottom', captionColor: '#ffffff', captionOffset: 0,
  voice: 'auto', model: 'gemini-3.5-live-translate-preview', videoModel: 'gemini-3.8-flash', ttsModel: 'gemini-3.8-flash-lite-tts',
};
export function sanitizeSettings(value: unknown): Settings {
  const s = { ...defaults }; if (!value || typeof value !== 'object') return s;
  const v = value as Record<string, unknown>;
  for (const k of ['duck', 'bilingual'] as const) if (typeof v[k] === 'boolean') s[k] = v[k];
  for (const [k, min, max] of [['originalVolume',0,100],['dubVolume',0,150],['captionSize',16,40],['captionOpacity',0,100],['captionOffset',-10,10]] as const) {
    if (typeof v[k] === 'number' && Number.isFinite(v[k])) s[k] = Math.max(min, Math.min(max, v[k]));
  }
  if (['both','subtitle','dub'].includes(String(v.mode))) s.mode = v.mode as Mode;
  if (['auto','female','male'].includes(String(v.voice))) s.voice = v.voice as Settings['voice'];
  if (v.captionPosition === 'top') s.captionPosition = 'top';
  if (['#ffffff','#ffe59a','#9df0da'].includes(String(v.captionColor))) s.captionColor = String(v.captionColor);
  for (const k of ['model','videoModel','ttsModel'] as const) if (typeof v[k] === 'string' && /^[a-z0-9.-]{4,100}$/.test(v[k])) s[k] = v[k];
  return s;
}
export function migrateSettings(value: unknown): Settings {
  const settings = sanitizeSettings(value);
  const previousDefault = value && typeof value === 'object'
    ? (value as Record<string, unknown>).ttsModel
    : undefined;
  // 1.0.4 saved this default for every user, even when they never changed it.
  // Migrate that exact prior default; all other selected model IDs stay intact.
  if (previousDefault === 'gemini-3.1-flash-tts-preview') settings.ttsModel = defaults.ttsModel;
  return settings;
}
export function youtubeId(input: string): string {
  const u = new URL(input.trim()); if (u.protocol !== 'https:') throw new Error('لینک یوتیوب باید با https شروع شود.');
  const host = u.hostname.toLowerCase().replace(/^www\./,''); let id = '';
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (['youtube.com','m.youtube.com','music.youtube.com'].includes(host)) id = u.searchParams.get('v') || (/^\/(shorts|embed|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : '');
  if (!/^[\w-]{11}$/.test(id)) throw new Error('یک لینک معتبر ویدیوی یوتیوب وارد کن.'); return id;
}
export function directUrl(input: string): string {
  let u: URL; try { u = new URL(input.trim()); } catch { throw new Error('لینک کامل فایل ویدیو را وارد کن.'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('یک لینک مستقیم https بدون نام کاربری و رمز وارد کن.');
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) throw new Error('برای این لینک، بخش یوتیوب را انتخاب کن.');
  return u.href;
}
export function formatTime(n: number) { const s = Math.max(0,Math.floor(n || 0)); return (s>=3600 ? `${Math.floor(s/3600)}:` : '') + `${Math.floor(s/60)%60}`.padStart(2,'0') + ':' + `${s%60}`.padStart(2,'0'); }
export function errorText(e: unknown, key = '') {
  let message = String(e instanceof Error ? e.message : e);
  if (key) message = message.split(key).join('••••');
  message = message.replace(/\bAQ\.[A-Za-z0-9._~-]{8,}/g,'••••').replace(/AIza[\w-]+/g,'••••').replace(/([?&]key=)[^\s&"']+/gi,'$1••••');
  const info = e as {name?: string; kind?: string; phase?: string; httpStatus?: number} | null;
  if (info?.name === 'GeminiRequestError') {
    const phase = info.phase || 'ترجمه';
    if (info.kind === 'network') return `${phase}: مرورگر پاسخی از API گوگل دریافت نکرد. پخش ویدیو مستقل از این ارتباط است؛ دسترسی به generativelanguage.googleapis.com، فیلترشکن یا مسدودکننده مرورگر را بررسی کن.`;
    if (info.kind === 'timeout') return `${phase}: پاسخ Gemini بیش از ۳ دقیقه طول کشید. دوباره امتحان کن؛ درخواست قبلی ممکن است در حساب گوگل محاسبه شده باشد.`;
    if (info.kind === 'response') {
      if (/incomplete|max_output_tokens|token/i.test(message)) return `${phase}: Gemini خروجی را پیش از تکمیل قطع کرد؛ سقف خروجی را افزایش داده‌ایم، دوباره امتحان کن یا ویدیوی کوتاه‌تری بده. جزئیات: ${message.slice(0,220)}`;
      return `${phase}: پاسخ Gemini کامل یا قابل خواندن نبود. جزئیات: ${message.slice(0,300)}`;
    }
    const code = info.httpStatus || 0;
    let help = 'درخواست توسط Gemini پذیرفته نشد.';
    if (code === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message)) help = 'سهمیه یا نرخ درخواست پر شده است؛ سهمیه و صورتحساب AI Studio را بررسی کن.';
    else if (/location|region|country|geograph/i.test(message)) help = 'Gemini برای منطقه این اتصال یا حساب در دسترس نیست.';
    else if (code === 401 || /API.?key|API_KEY_INVALID|UNAUTHENTICATED/i.test(message)) help = 'کلید API معتبر نیست یا محدودیت دسترسی دارد؛ کلید و محدودیت‌های آن را در AI Studio بررسی کن.';
    else if (code === 403) help = 'گوگل دسترسی این کلید به سرویس یا مدل را نپذیرفت؛ مجوز و محدودیت‌های کلید را بررسی کن.';
    else if (code === 404 || /model.*(not found|not supported|not available)/i.test(message)) help = 'مدل انتخاب‌شده در دسترس نیست؛ شناسه مدل را در تنظیمات بررسی کن.';
    else if (code >= 500) help = 'سرویس Gemini خطای موقت داده است؛ کمی بعد دوباره امتحان کن.';
    return `${phase} — کد ${code}: ${help}\nجزئیات گوگل: ${message.slice(0,400)}`;
  }
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(message)) return 'سهمیه یا نرخ درخواست Gemini پر شده است. سهمیه حسابت را در AI Studio بررسی کن.';
  if (/401|403|API.?key|permission.denied/i.test(message)) return `دسترسی Gemini تأیید نشد. جزئیات: ${message.slice(0,350)}`;
  if (/Failed to fetch|network|1006/i.test(message)) return 'اتصال ترجمه به Gemini قطع شد. پخش ویدیو اتصال جداگانه‌ای دارد؛ دسترسی به سرویس گوگل و فیلترشکن را بررسی کن.';
  return message.slice(0,500);
}
