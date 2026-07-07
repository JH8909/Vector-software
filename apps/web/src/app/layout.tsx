import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VectorForge — 位图快速转矢量',
  description: '把位图快速转换成可编辑、可印刷、可放大的高质量矢量文件',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
