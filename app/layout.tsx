import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const geistSans = Geist({ variable:'--font-geist-sans', subsets:['latin'] });
const geistMono = Geist_Mono({ variable:'--font-geist-mono', subsets:['latin'] });
export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title:'Signal Map — 个人行业信息过滤器',
  description:'为普通人寻找真实、有用且足够早的个人行业信号。',
  openGraph:{ title:'Signal Map', description:'真实 · 有用 · 足够早', images:['/og.png'] },
  twitter:{ card:'summary_large_image', title:'Signal Map', description:'真实 · 有用 · 足够早', images:['/og.png'] },
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>; }
