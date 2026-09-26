<p align="center">
  <a href="https://mostafa5804.github.io/HamAva/">
    <img src="public/icon512.png" width="112" alt="نشان هم‌آوا">
  </a>
</p>

<h1 align="center">هم‌آوا</h1>

<p align="center">
  ویدیو را به فارسی ببین، بخوان و بشنو.
  <br>
  ابزار شخصی ترجمه، زیرنویس و دوبلهٔ ویدیو با Gemini
</p>

<p align="center">
  <a href="https://mostafa5804.github.io/HamAva/"><strong>باز کردن وب‌اپ</strong></a>
  ·
  <a href="https://github.com/mostafa5804/HamAva">کد منبع</a>
  ·
  <a href="https://github.com/mostafa5804/HamAva/issues">گزارش مشکل</a>
</p>

<p align="center">
  <img alt="Version 1.1.0" src="https://img.shields.io/badge/version-1.1.0-087b63?style=flat-square">
  <a href="https://github.com/mostafa5804/HamAva/actions/workflows/pages.yml">
    <img alt="GitHub Pages deployment" src="https://img.shields.io/github/actions/workflow/status/mostafa5804/HamAva/pages.yml?branch=main&label=GitHub%20Pages&logo=github">
  </a>
  <a href="https://github.com/mostafa5804/HamAva">
    <img alt="GitHub repository" src="https://img.shields.io/badge/source-GitHub-181717?logo=github&logoColor=white">
  </a>
</p>

---

## 🎬 هم‌آوا چه می‌کند؟

هم‌آوا فایل ویدیویی، لینک مستقیم یا ویدیوی عمومی YouTube را می‌گیرد و برایت زیرنویس فارسی و صدای دوبله می‌سازد. پردازش از مرورگر انجام می‌شود و برای استفاده، کلید API خودت را به Gemini وصل می‌کنی.

| زیرنویس | دوبله |
| --- | --- |
| فارسی یا دوزبانه، با تنظیم اندازه و جای نمایش | صدای فارسی با انتخاب صدای آماده |
| دریافت فایل SRT | دریافت صدای دوبله به شکل WAV |
| زمان‌بندی هماهنگ با ویدیو | خروجی ویدیوی WebM برای فایل و لینک مستقیم |

## 🚀 شروع سریع

**نسخهٔ آنلاین:** [mostafa5804.github.io/HamAva](https://mostafa5804.github.io/HamAva/)

1. از [Google AI Studio](https://aistudio.google.com/apikey) یک کلید API بگیر.
2. کلید را در **تنظیمات ← کلید Gemini** وارد کن.
3. فایل، لینک مستقیم یا ویدیوی YouTube را انتخاب کن.
4. حالت «زیرنویس»، «دوبله» یا «هر دو» را بزن و ترجمه را شروع کن.
5. زیرنویس و صدای آماده را از بخش خروجی‌ها دریافت کن.

کلیدت را در README، پیام عمومی یا مخزن GitHub قرار نده.

## 📥 ورودی و خروجی

- **فایل:** فایل صوتی یا ویدیویی قابل پخش در مرورگر.
- **لینک مستقیم:** نشانی HTTPS که مستقیماً به رسانه برسد و دسترسی CORS داشته باشد.
- **YouTube:** ویدیوی عمومی؛ لینک برای تحلیل به Gemini فرستاده می‌شود.
- **زیرنویس:** خروجی SRT؛ نمایش دوزبانه و تنظیم ظاهر هم در دسترس است.
- **دوبله:** دریافت WAV؛ برای فایل و لینک مستقیم، امکان ضبط ویدیوی WebM هم هست.

## 🔐 حریم خصوصی و کلید

کلید، فایل و صدای لازم برای ترجمه از مرورگر به Google ارسال می‌شوند؛ سرور هم‌آوا واسطهٔ درخواست‌ها نیست. اگر ذخیرهٔ کلید را روشن کنی، کلید در فضای محلی مرورگر ذخیره می‌شود و رمزنگاری جداگانه ندارد. برای پاک‌کردنش از تنظیمات، «حذف کلید» را بزن.

## ⚠️ محدودیت‌های مهم

- لینک مستقیم باید قابل پخش و دارای مجوز CORS باشد؛ YouTube خصوصی یا محافظت‌شده پشتیبانی نمی‌شود.
- ساخت ویدیوی دوبله در زمان واقعی ضبط می‌شود و به فعال‌ماندن صفحه نیاز دارد.
- شباهت صدا و زمان‌بندی ترجمه تقریبی است؛ صدای گویندهٔ اصلی بازسازی یا کلون نمی‌شود.
- دسترسی و هزینهٔ Gemini به کلید، سهمیه، مدل و منطقهٔ حساب بستگی دارد.

## 🧰 اجرای محلی

نیازمند Node.js نسخهٔ 22.13 یا جدیدتر و pnpm نسخهٔ 11.25.0:

~~~bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev:standalone
~~~

سپس [localhost:3000](http://localhost:3000) را باز کن. کلید API را فقط در تنظیمات وب‌اپ وارد کن.

برای بررسی کد:

~~~bash
pnpm test
pnpm typecheck
pnpm lint
~~~

## 🌐 انتشار روی GitHub Pages

مخزن از قبل workflow انتشار دارد. برای نسخهٔ شخصی خودت:

1. مخزن را Fork کن.
2. در **Settings → Pages → Build and deployment**، منبع را روی **GitHub Actions** بگذار.
3. تغییرات را روی شاخهٔ <code>main</code> قرار بده؛ workflow آزمون‌ها را اجرا می‌کند و سایت را منتشر می‌کند.

برای مخزن پروژه‌ای، نشانی سایت معمولاً <code>https://USERNAME.github.io/REPOSITORY/</code> است. جزئیات را در [راهنمای GitHub Pages](https://docs.github.com/pages) ببین.

## 🧪 نسخهٔ جاری

**۱.۱.۰** — پخش دوبله با سرعت طبیعی و خروجی ویدیو با انتخاب دوبله، زیرنویس درج‌شده روی تصویر یا هردو.

**۱.۰.۷** — درخواست PCM صریح از Gemini 3.8 برای جلوگیری از تفسیر WAV به‌عنوان PCM؛ اصلاح پخش دوبلهٔ آماده‌شده و خروجی صوتی.

**۱.۰.۶** — پخش دوبلهٔ آماده‌شده از Web Audio برای سازگاری بهتر با سیاست پخش مرورگرهای موبایل؛ نگه‌داشتن Blob هر بخش برای خروجی صوتی تا دانلود به URL موقت وابسته نباشد.

**۱.۰.۵** — انتخاب مدل متناسب با API Key یا واردکردن شناسهٔ دستی؛ پشتیبانی از قالب گفتار Gemini 3.8 و نگه‌داشتن امکان انتخاب مدل‌های TTS قدیمی‌تر. سهمیه و هزینه تابع پروژهٔ Google AI Studio است.

---

<p align="center">
  <a href="https://github.com/mostafa5804/HamAva">
    <img alt="GitHub" src="https://img.shields.io/badge/ساخته%20شده%20با-GitHub-181717?style=flat-square&logo=github&logoColor=white">
  </a>
  &nbsp; هم‌آوا · نسخهٔ ۱.۱.۰
</p>
