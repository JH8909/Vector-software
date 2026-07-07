# VectorForge MVP 项目复盘

## 1. 项目最终完成了什么

一个**纯浏览器端位图转矢量工具**，完整闭环可运行：

### 功能层面
| 功能 | 状态 |
|------|------|
| 拖拽/点击上传 PNG/JPG/WebP | ✅ |
| 4 种预设模式自动推荐 | ✅ |
| 6 个参数滑块实时调整 | ✅ |
| 原图/矢量并排对比 + 滑块 | ✅ |
| 滚轮缩放 + 抓手平移 | ✅ |
| 一键导出透明 SVG | ✅ |
| 印刷质量检查报告 | ✅ |
| F5 刷新不丢数据 | ✅ |

### 技术层面
- **矢量化引擎**：Potrace (npm) + 自研 Median-Cut 量化 + 1px 膨胀关缝 + optCurve 贝塞尔平滑
- **前端框架**：Next.js 15 + React 19 + Zustand + Tailwind CSS v4
- **代码规模**：17 个源文件，~2100 行 TS/TSX/CSS
- **依赖**：8 个运行时（含 potrace, zustand, lucide-react）

---

## 2. 执行过程中哪里做得好

### ✅ 快速验证核心闭环
第一时间用 `node -e` 直接验证 Potrace 的 Jimp 加载、Posterizer 分层、参数映射，没等 UI 搭完再返工。

### ✅ 遇到阻塞性缺陷果断换方案
Posterizer 的 Otsu 多级阈值在浏览器端卡死 → 立即自研 Median-Cut + 逐层 Potrace 替代，不纠结修复 Posterizer。

### ✅ 参数调试用数据驱动
`alphaMax` 映射方向错误、`optCurve` 关闭导致圆变多边形 → 用 Node 脚本扫描参数空间（α 0.15→3.0, τ 0.03→0.8），找黄金平衡点而不是猜。

### ✅ 反复回归验证
每次修改 vectorizer/index.ts 后都跑 `node -e` 基准测试确认：矩形是否全 L、圆形 C 数量是否够、SVG 体积是否可控。

---

## 3. 低效、重复、跑偏的地方

### ❌ A. 盲目集成 VTracer WASM（浪费时间最多）
- 装了 Rust 工具链，写了 Cargo.toml + lib.rs，编译了 121KB 的 wasm 文件
- 集成 WasmInit 组件，改了 loader 策略（new Function, script tag, globalThis）
- **最终发现**：`vectortracer` npm 包只导出 BinaryImageConverter，没有 ColorImageConverter；我们的 self-built wasm 也只能做二值追踪
- **浪费**：约 10 轮对话，Rust 编译时间 + 集成调试时间
- **根因**：没先查 API 文档就开干，被"VTracer 号称 O(n) 支持彩色"的搜索结论带偏

**教训**：集成第三方 WASM 前，必须先用 `cat node_modules/xxx/pkg/xxx.d.ts` 确认 API 是否存在，再决定是否投入。

### ❌ B. antiAliasMask 引入→移除→再引入→再移除
- 第 1 次：觉得"反锯齿能平滑边缘"→ 加 3×3 box blur
- 发现方块变圆弧 → 移除
- 又觉得"圆弧不够圆"→ 加回 AA
- 实测直角全毁 → 再次移除
- **浪费**：3 轮代码改动 + 3 轮基准测试
- **根因**：没一次性验证 AA 对矩形的影响就合并到管线中

**教训**：图像处理算法必须同时测"最佳情况"（圆形）和"最差情况"（矩形），缺一不可。

### ❌ C. 对比滑块位置反复调整
- 先放 canvas transform 层内 → 缩放时滑块漂移
- 移到外层 overlay → 点击事件收不到 → 把指针事件挂父级
- 又改成 data-handle 分派 → 两端边界静止问题 → 反复微调 clamp 值
- **浪费**：约 4 轮专门修复滑块交互
- **根因**：一开始没想清楚"对比线固定"和"画布可平移"的架构分层

**教训**：UI 交互分层决策应该在写第一版之前画清楚——哪层做 transform、哪层固定不动的。

### ❌ D. 首页 → 工作台跳转流程反复重构
- 初版：await vectorize 完成后才跳转 → 卡 3 秒
- 改为先跳转再异步转换 → 工作台直接显示结果
- 加 startConversion useEffect → 刷新后重跑
- 加 sessionStorage 持久化 → 刷新恢复
- 加 prepareFile vs startConversion 拆分 → 职责清晰
- **根因**：一开始没考虑到 F5 刷新、换图、失败重试等边缘情况

**教训**：状态管理设计阶段就应该枚举所有状态转换（首次进入、刷新恢复、换图、失败、重试）。

---

## 4. 下次推荐流程

### Phase 1 — 勘探（1-2 轮）
- [ ] 阅读项目 CLAUDE.md / 设计文档
- [ ] 确定核心技术栈和关键依赖
- [ ] 列出所有已知风险和不确定项

### Phase 2 — 核心算法验证（不写 UI）
- [ ] 用 Node 脚本验证关键链路：输入 → 处理 → 输出
- [ ] 扫描参数空间，找最佳默认值
- [ ] 同时测"最佳输入"和"最差输入"（如 AA 对矩形+圆形）
- [ ] 记录基准数据：耗时、输出大小、质量指标

### Phase 3 — 最小可运行 UI（1 页）
- [ ] 单页面验证：上传 → 处理 → 显示结果
- [ ] 此时只接核心参数（2-3 个 slider）
- [ ] 确认防抖/节流策略

### Phase 4 — 完善交互
- [ ] 添加所有参数（6 个）
- [ ] 预览模式（对比/原图/矢量）
- [ ] 缩放/平移
- [ ] 导出功能

### Phase 5 — 边缘情况 + 体验打磨
- [ ] 刷新恢复
- [ ] 失败重试
- [ ] 空态/加载态/错误态
- [ ] 超大/超小/损坏文件
- [ ] 移动端触摸

---

## 5. 开始前应确认的信息

### 算法层
- [ ] 矢量化库的选择：Potrace vs VTracer vs 自研
- [ ] 是否需要在浏览器端跑（vs 后端 API）
- [ ] 目标图片类型：线条/Logo/照片/插画
- [ ] 打印精度要求（DIN/A 类标准？）

### 交互层
- [ ] 预览模式：并排/叠加/单图
- [ ] 缩放/平移需求
- [ ] 参数数量 + 范围 + 默认值
- [ ] 导出格式 (SVG/PDF/EPS) + 是否真需求还是只留 SVG

### 架构层
- [ ] 是否单页应用（vs 首页+工作台两步）
- [ ] 状态持久化策略（sessionStorage? URL?）
- [ ] 是否需要 Web Worker（处理时间 > 200ms?）

---

## 6. Claude 自我检查清单

### 每次改动前
- [ ] 这篇文章改了之后，我以前验证过的结论是否还成立？（回归意识）
- [ ] 这个第三方库的 API 我真的读过源码吗？（不要只看 README）
- [ ] 这个改动对"最佳输入"和"最差输入"分别有什么影响？

### 每次遇阻时
- [ ] 是否在跟一个已经证明不可行的方案较劲？（果断换方案 vs 死磕）
- [ ] 是否是参数映射的符号反了？（alphaMax 方向这类 bug 极高频）
- [ ] 是否可以先简化问题（降维、少参数、单色）再逐步加回来？

### 每次声称"完成"前
- [ ] 实际跑过了吗？（不只是构建通过，要有 Node 基准测试）
- [ ] 滑块从 0 拖到 100，结果真的有变化吗？
- [ ] 导出文件能在 Illustrator/Inkscape 中打开吗？

---

## 7. 可沉淀的模板/清单/方法论

### 参数映射验证模板
```
// 扫描参数空间，同时验证"最佳"和"最差"场景
params = { default, extreme_low, extreme_high }
inputs = { rectangle(直角), circle(圆弧), complex(真实图片) }
assert: rectangle → L 段 > 80%（不能变成 C 曲线）
assert: circle → C 段 > 50%（不能全 L 折线）
assert: 所有输出 → viewBox 匹配内容尺寸（无裁切/溢出）
```

### UI 分层决策模板
```
┌─ Container (fixed, no transform)
│  ├─ TransformLayer (scale + translate)
│  │  ├─ Content (images, canvas, etc)
│  ├─ Overlay (fixed position, z > transform)
│  │  ├─ SplitHandle (date-handle attribute)
│  │  ├─ Toolbar (always visible)
```

### 状态机枚举模板
```
初始状态: idle
触发事件: UPLOAD_FILE, CONVERT_DONE, CONVERT_FAIL, USER_RESET, TAB_REFRESH
状态转换:
  idle --[UPLOAD_FILE]--> processing
  idle --[TAB_REFRESH]--> idle (restore from cache)
  processing --[CONVERT_DONE]--> completed
  processing --[CONVERT_FAIL]--> failed
  failed --[USER_RETRY]--> processing
  completed --[USER_CHANGE_PARAMS]--> processing
  completed --[USER_RESET]--> idle
  any --[NEW_FILE]--> idle → processing
```

---

## 8. 后续优化方向（不扩展，仅记录）

1. **CMYK 转换 + 专色标记**：印刷流程需要
2. **批量转换**：多图同时处理
3. **路径编辑**：Web 端轻量钢笔工具
4. **AI 风格化**：照片→矢量艺术风格
5. **Vercel 部署**：目前仅 localhost
