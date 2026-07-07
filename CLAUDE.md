# CLAUDE.md

## Project Overview
- 项目名称：Bitmap to Vector MVP
- 产品目标：构建一个轻量、紧凑、易操作的图片转矢量图软件，支持用户上传位图后自动转换为可编辑、可印刷的矢量文件。
- 核心场景：Logo、图标、线稿、贴纸图案、T 恤图案、包装图形、黑白扫描稿、简单插画色块。
- MVP 核心闭环：上传图片 → 自动分析 → 矢量化转换 → 参数微调 → 预览对比 → 导出 SVG/PDF/EPS。
- 产品原则：不做完整 Illustrator 替代品，只做高质量位图转矢量工具，强调输出文件干净、可编辑、可印刷。

## Product Positioning
- 面向用户：设计师、印刷店、电商卖家、品牌方、定制品商家、包装设计团队。
- 核心价值：把低质量或非矢量图片快速转换成可用于印刷、放大、编辑的矢量文件。
- MVP 差异点：页面紧凑、操作路径短、预设模式清晰、导出结果面向印刷交付。
- 非目标：不做复杂绘图工具、不做完整排版工具、不做多页设计器、不做在线素材库。
- 成功标准：用户能在 1-3 分钟内完成一张图片的矢量化，并导出可在 Illustrator、Inkscape、Affinity Designer 中打开的文件。

## MVP Scope
### P0 Must Have
- 图片上传：支持 PNG、JPG、JPEG、WebP，支持拖拽上传和本地选择。
- 自动矢量化：支持黑白线稿、Logo 色块、高精度轮廓三类基础转换。
- 实时预览：原图与矢量结果并排显示，支持放大检查边缘。
- 参数调节：路径精度、去噪强度、边缘平滑、颜色数量、最小碎片过滤。
- SVG 导出：输出结构清晰、路径可编辑、图层/颜色尽可能保留的 SVG 文件。

### P1 Should Have
- PDF/EPS 导出：用于印刷厂、设计软件和传统印刷流程。
- 透明背景保留：保留 PNG 透明通道，避免导出白底。
- 质量检查：提示低分辨率、边缘模糊、颜色过多、路径碎片过多等问题。
- 尺寸设置：支持 mm、cm、inch、px 等单位，允许设置画布尺寸。
- 预设模式：黑白线稿、Logo 色块、插画色块、高精度轮廓。

### P2 Later
- Adobe Illustrator 兼容增强导出。
- CMYK 转换、专色标记、色板管理。
- 批量转换、历史项目、账号系统。
- 在线路径编辑、局部擦除、颜色替换。
- API、企业私有部署、印刷模板管理。

## Non-Goals For MVP
- 不实现完整钢笔工具。
- 不实现复杂图层编辑器。
- 不实现多人协作。
- 不实现多页排版。
- 不承诺完整原生 `.ai` 文件生成。
- 不做照片级真实矢量还原，照片只支持风格化矢量结果。

## User Flow
- 用户进入首页，点击“上传图片转矢量”。
- 系统读取图片信息，包括尺寸、格式、透明通道、颜色数量、边缘复杂度。
- 系统推荐转换模式，例如 Logo、线稿、插画色块或高精度轮廓。
- 用户进入工作台，查看原图与矢量图对比。
- 用户调整参数，例如去噪、颜色数量、边缘平滑、路径精度。
- 用户通过导出弹窗选择 SVG、PDF 或 EPS。
- 系统生成文件，并提示是否适合印刷使用。

## UI Layout
### Home Page
- 顶部：品牌名、简单导航、登录入口。
- 主区域：一句话价值主张，例如“把位图快速转换成可印刷的矢量文件”。
- 上传区：大面积拖拽上传框，支持 PNG/JPG/WebP。
- 说明区：展示支持格式、导出格式、适用场景。
- CTA：主按钮“上传并转换”。

### Workspace Page
- 左侧：原图预览区，显示尺寸、格式、透明背景状态。
- 中间：矢量结果预览区，支持放大、缩小、适配屏幕、叠加对比。
- 右侧：参数面板，集中展示模式、颜色、去噪、平滑、路径精度。
- 底部：状态栏，展示转换进度、路径数量、文件大小、质量提示。
- 右上角：导出按钮，打开格式选择与印刷设置。

### Export Dialog
- 格式选择：SVG、PDF、EPS。
- 尺寸设置：单位、画布宽高、缩放比例。
- 背景设置：透明背景、白底、黑底预览。
- 印刷检查：显示风险提示和建议修正项。
- 导出按钮：生成并下载目标文件。

## Technical Architecture
### Frontend
- 推荐框架：Next.js + React + TypeScript。
- 样式方案：Tailwind CSS 或 CSS Modules，优先保证紧凑、清晰、低视觉噪音。
- 预览方案：Canvas 用于原图预处理预览，SVG DOM 或 iframe 用于矢量结果预览。
- 状态管理：Zustand 或 React Context，管理上传文件、转换参数、任务状态、导出设置。
- 文件交互：前端负责拖拽上传、参数面板、预览缩放、导出请求发起。

### Backend
- 推荐框架：FastAPI 或 Node.js/NestJS。
- 任务模型：上传图片后生成转换任务，后端异步处理并返回任务状态。
- 图像处理：OpenCV、ImageMagick 或 Sharp 用于去噪、裁切、尺寸标准化、透明通道处理。
- 矢量化引擎：Potrace 用于黑白/线稿；VTracer 或自研颜色聚类流程用于彩色图。
- 文件存储：MVP 使用临时对象存储，文件 24 小时后自动清理。

### Vectorization Pipeline
- Step 1：读取图片，校验格式、尺寸、文件大小。
- Step 2：执行预处理，包括去噪、边缘增强、透明背景识别、颜色聚类。
- Step 3：根据模式选择矢量化策略，黑白图走 Potrace，彩色图走颜色分层与路径拟合。
- Step 4：执行路径后处理，包括平滑曲线、减少节点、合并小碎片、保留尖角。
- Step 5：生成 SVG，并根据导出格式转换为 PDF 或 EPS。
- Step 6：执行质量检查，输出路径数量、碎片数量、颜色数量、尺寸风险提示。

## Suggested Directory Structure
```txt
bitmap-vector-mvp/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── styles/
│   └── api/
│       ├── routes/
│       ├── services/
│       ├── workers/
│       ├── vectorizers/
│       └── storage/
├── packages/
│   ├── shared-types/
│   ├── image-processing/
│   └── export-utils/
├── samples/
│   ├── logos/
│   ├── line-art/
│   ├── stickers/
│   └── packaging/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── visual-regression/
├── docs/
│   ├── product-spec.md
│   ├── api-spec.md
│   └── export-spec.md
└── CLAUDE.md
```

## Data Model
### ConversionJob
- `id`：任务 ID。
- `status`：queued、processing、completed、failed。
- `sourceFileUrl`：原始图片地址。
- `outputSvgUrl`：生成 SVG 地址。
- `outputPdfUrl`：生成 PDF 地址。
- `outputEpsUrl`：生成 EPS 地址。
- `settings`：当前转换参数。
- `qualityReport`：印刷质量检查结果。

### VectorSettings
- `mode`：line_art、logo_color、illustration_color、high_precision。
- `colorCount`：颜色数量，默认自动。
- `noiseReduction`：去噪强度，范围 0-100。
- `pathPrecision`：路径精度，范围 0-100。
- `smoothness`：边缘平滑，范围 0-100。
- `cornerPreservation`：角点保留，范围 0-100。
- `minArea`：最小碎片过滤面积。

### QualityReport
- `isPrintReady`：是否建议用于印刷。
- `warnings`：质量风险列表。
- `pathCount`：路径数量。
- `colorCount`：颜色数量。
- `estimatedFileSize`：预计导出文件大小。
- `recommendations`：优化建议。

## API Draft
### Upload Image
- Method：POST
- Path：`/api/images/upload`
- Input：multipart image file
- Output：uploaded file metadata

### Create Conversion Job
- Method：POST
- Path：`/api/conversions`
- Input：source file ID + vector settings
- Output：conversion job ID

### Get Conversion Status
- Method：GET
- Path：`/api/conversions/{jobId}`
- Output：status、preview SVG、quality report

### Update Conversion Settings
- Method：PATCH
- Path：`/api/conversions/{jobId}/settings`
- Input：partial vector settings
- Output：new preview result

### Export File
- Method：POST
- Path：`/api/conversions/{jobId}/export`
- Input：format、size、background options
- Output：download URL

## Export Strategy
- SVG：MVP 主格式，要求路径可编辑、颜色分组清晰、文件结构简洁。
- PDF：印刷交付格式，适合发送给印刷厂或设计团队。
- EPS：兼容传统印刷流程和部分旧版软件。
- AI：MVP 不直接生成完整原生 `.ai`，优先提供 Illustrator 可打开的 SVG/PDF/EPS。
- 命名建议：界面文案使用“导出 Illustrator 可编辑文件”，不要过早承诺“原生 AI 文件”。

## Print-Ready Requirements
- 矢量边缘在 800% 放大下应保持平滑，无位图锯齿。
- 路径节点数量应合理，避免过度拟合导致文件过大或编辑卡顿。
- Logo、图标、线稿类素材应优先保证轮廓准确和角点保留。
- 彩色图案应支持限制颜色数量，避免生成大量无意义色块。
- 导出前必须给出印刷风险提示，例如原图模糊、路径碎片过多、颜色过多。

## Quality Rules
- 如果源图分辨率过低，需要提示用户结果可能不适合高精度印刷。
- 如果路径数量过多，需要建议提高去噪或降低路径精度。
- 如果颜色数量过多，需要建议减少颜色或使用 Logo 模式。
- 如果边缘模糊，需要建议使用高对比原图或手动调高边缘平滑。
- 如果透明通道存在，需要默认保留透明背景。

## UI Design Principles
- 页面紧凑，所有核心操作集中在一个工作台完成。
- 参数不超过首屏可理解范围，避免高级设置压迫新用户。
- 默认给出推荐参数，用户无需理解算法即可完成转换。
- 用视觉对比证明结果质量，包括原图/矢量、叠加、放大检查。
- 所有导出相关动作集中在一个导出弹窗内。

## Component List
- `UploadDropzone`：图片上传与拖拽组件。
- `ImageInfoPanel`：展示图片尺寸、格式、颜色、透明背景信息。
- `VectorPreview`：矢量图预览组件。
- `CompareViewer`：原图与矢量结果对比组件。
- `SettingsPanel`：模式和参数调节组件。
- `QualityReportPanel`：印刷质量检查组件。
- `ExportDialog`：导出格式、尺寸、背景设置组件。
- `JobStatusBar`：转换状态、路径数量、文件大小展示组件。

## Development Guidelines
- 优先实现端到端闭环，再优化算法细节。
- 所有转换参数必须有默认值，避免空状态导致失败。
- 每个转换任务必须有可追踪状态，避免用户不知道是否仍在处理。
- 后端转换失败时必须返回可读错误信息，而不是只返回 500。
- SVG 输出必须经过压缩与清理，但不能破坏可编辑性。
- 前端不要阻塞主线程处理大图，必要时使用 Web Worker 或后端处理。

## Testing Strategy
- 准备固定样例库：Logo、黑白线稿、贴纸图案、包装图标、低清晰度图片、透明 PNG。
- 每次算法修改后对样例库重新跑转换，比较路径数量、文件大小、视觉结果。
- 做导出兼容性测试：Illustrator、Inkscape、Affinity Designer、浏览器 SVG 预览。
- 做异常测试：超大图片、损坏文件、纯白图、透明空图、颜色极多图片。
- 做印刷检查测试：确保低质量素材能触发合理警告。

## Acceptance Criteria
- 用户可以上传 PNG/JPG/WebP 并成功生成 SVG。
- 用户可以通过 3-5 个核心参数改善转换结果。
- SVG 文件可以被 Illustrator 或 Inkscape 打开并编辑路径。
- Logo、线稿、图标类图片在 MVP 中具有稳定可用结果。
- 导出前能显示基础质量报告和印刷风险提示。
- 页面操作路径不超过：上传 → 调整 → 导出。

## MVP Timeline
- Week 1：完成原型、首页、上传、工作台布局、基础 API。
- Week 2：接入黑白矢量化，完成 SVG 生成和预览。
- Week 3：接入彩色矢量化，完成参数面板和实时转换。
- Week 4：完成 PDF/EPS 导出、质量检查、导出弹窗。
- Week 5：完成样例库测试、路径质量优化、内测版本准备。

## Future Roadmap
- V1.1：CMYK、PDF/EPS 增强、专色、更多印刷检查项。
- V1.2：批量转换、历史项目、用户账号、云端保存。
- V1.3：Adobe Illustrator 插件或更深度 Illustrator 兼容导出。
- V1.4：API、企业版、私有部署、自动化印刷工作流。
- V2.0：加入轻量路径编辑、颜色替换、局部修复、模板化输出。

## Claude Working Instructions
- 开发时优先保证 MVP 核心闭环完整，不要提前扩展成复杂设计工具。
- 遇到功能取舍时，优先选择能提升导出质量、印刷可用性和操作效率的功能。
- UI 设计必须保持紧凑、简洁、低认知负担，避免工具栏过多。
- 技术实现必须区分黑白线稿与彩色图案，两者不要使用完全相同的矢量化策略。
- 任何导出相关实现都必须关注 Illustrator 可打开、路径可编辑、文件不过度臃肿。
- 不要在 MVP 中承诺完整原生 `.ai` 格式，除非已经通过真实 Illustrator 兼容性验证。

## Key Product Sentence
- 把位图快速转换成可编辑、可印刷、可放大的高质量矢量文件。
