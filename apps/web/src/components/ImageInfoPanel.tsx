'use client';

import { useStore } from '@/store/useStore';
import { formatFileSize } from '@/lib/utils/image';
import { Image, FileType, Maximize, Palette, Layers } from 'lucide-react';

export function ImageInfoPanel() {
  const imageInfo = useStore((s) => s.imageInfo);
  if (!imageInfo) return null;

  const items = [
    { icon: Image, label: '尺寸', value: `${imageInfo.width} × ${imageInfo.height} px` },
    { icon: FileType, label: '格式', value: imageInfo.format.toUpperCase() },
    { icon: Maximize, label: '大小', value: formatFileSize(imageInfo.fileSize) },
    { icon: Palette, label: '颜色数', value: `${imageInfo.colorCount}` },
    { icon: Layers, label: '透明', value: imageInfo.hasAlpha ? '保留 ✓' : '无' },
  ];

  return (
    <div className="compact-card p-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">源图信息</h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-gray-500">
              <item.icon className="w-3 h-3" />
              <span>{item.label}</span>
            </div>
            <span className="font-medium text-gray-800">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
