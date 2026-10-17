import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const geistSans = localFont({
  src:'./fonts/Geist-Variable.woff2', variable:'--font-geist-sans',
  weight:'100 900', style:'normal', display:'swap',
  fallback:['PingFang SC','Microsoft YaHei','sans-serif'],
});
const geistMono = localFont({
  src:'./fonts/GeistMono-Variable.woff2', variable:'--font-geist-mono',
  weight:'100 900', style:'normal', display:'swap',
  fallback:['ui-monospace','monospace'],
});
export const metadata: Metadata = {
  metadataBase: new URL('https://signal.benzhenlab.com'),
  title:'Signal Map — 个人行业信息过滤器',
  description:'为普通人寻找真实、有用且足够早的个人行业信号。',
  openGraph:{ title:'Signal Map', description:'真实 · 有用 · 足够早', images:['/og.png'] },
  twitter:{ card:'summary_large_image', title:'Signal Map', description:'真实 · 有用 · 足够早', images:['/og.png'] },
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>; }
