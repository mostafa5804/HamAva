import type { Metadata } from "next";
import "./globals.css";

// Matches `basePath` in next.config.ts: set only when the app is published
// under a sub-path such as a GitHub Pages project site (`/<repository>/`).
const basePath = (process.env.HAMAVA_BASE_PATH ?? "").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "هم‌آوا | ویدیو به زبان تو",
  description: "پلیر شخصی ویدیو با زیرنویس و دوبله فارسی؛ با کلید Gemini خودت.",
  // Files in `public/` keep the site root unless the base path is added here.
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "هم‌آوا", statusBarStyle: "default" },
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
