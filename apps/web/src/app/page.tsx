'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2 } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function HomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      // 1. 快速校验
      const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        alert('仅支持 PNG、JPG、WebP 格式');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        alert('文件大小不能超过 20MB');
        return;
      }

      // 2. 只做图片读取 + 分析（不矢量化）→ 快速跳转
      setLoading(true);
      try {
        await useStore.getState().prepareFile(file);
      } catch (err) {
        setLoading(false);
        alert(err instanceof Error ? err.message : '图片读取失败');
        return;
      }
      // 3. 立即跳转到工作台（工作台会自动开始矢量化）
      router.push('/workspace');
    },
    [router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 3h18v18H3z" /><path d="M7 17l4-8 4 4 2-2 4 6" />
            </svg>
          </div>
          <span className="text-lg font-bold text-gray-900">VectorForge</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-lg w-full text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-3 leading-tight">
            把位图快速转换成
            <br /><span className="text-blue-600">可编辑、可印刷</span>的矢量文件
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Logo 图标 · 线稿 · 贴纸图案 · T 恤印花 · 包装图形 ·<br />一键导出 SVG / PDF / EPS
          </p>
        </div>

        {/* Upload Zone — loading 状态时显示 spinner */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={() => !loading && inputRef.current?.click()}
          className={`w-full max-w-md ${loading ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <div className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            loading
              ? 'border-blue-300 bg-blue-50/50'
              : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/30'
          }`}>
            {loading ? (
              <>
                <Loader2 className="w-10 h-10 mx-auto mb-4 text-blue-600 animate-spin" />
                <p className="text-base font-medium text-blue-700 mb-1">正在读取图片…</p>
                <p className="text-sm text-blue-400">即将进入工作台</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 mx-auto mb-4 bg-blue-50 rounded-full flex items-center justify-center">
                  <Upload className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-base font-medium text-gray-700 mb-1">拖拽图片到此处，或点击上传</p>
                <p className="text-sm text-gray-400">支持 PNG / JPG / WebP，最大 20MB</p>
              </>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onSelect}
        />

        <div className="mt-10 grid grid-cols-3 gap-6 max-w-md text-center">
          {[
            { icon: '🎯', label: '4 种转换模式', desc: '线稿 · Logo · 插画 · 高精度' },
            { icon: '⚡', label: '实时预览对比', desc: '原图 / 矢量并排查看' },
            { icon: '📦', label: 'SVG / PDF / EPS', desc: '导出印刷级文件' },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-xl mb-1">{f.icon}</div>
              <div className="text-xs font-medium text-gray-700">{f.label}</div>
              <div className="text-[11px] text-gray-400">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-4 text-xs text-gray-400 border-t border-gray-100">
        VectorForge MVP — 浏览器端矢量化，图片不上传服务器
      </footer>
    </div>
  );
}
