# PicCreator

PicCreator 是一个面向室内设计与 3D 效果图生成的自动化生图项目。项目核心是 `3d-render-agent`：它可以读取设计需求、平面图和参考图，自动生成提示词，调用图像模型生成效果图，再用视觉模型对结果进行评估，并根据反馈继续迭代优化。

当前版本已经完成一轮前后端分离与 UI 重构：后端保留 Gradio 本地工作台，同时新增分层 FastAPI 服务；前端 React 原型可以通过 API 与后端联动，便于后续做产品化交互和实际测试。

## 当前状态

- Gradio 应用：适合本地快速调试、直接上传文件、查看运行日志和生成结果。
- FastAPI 服务：提供 `/api` 接口，供前端或其他系统调用。
- React 前端原型：位于 `3d-render-agent/ui-prototype`，已经接入后端生成接口和 API 配置验证接口。
- 测试覆盖：包含核心 pipeline 策略、模型适配器、评估逻辑和后端 API 基础测试。

## 主要功能

- 常规生图：根据自然语言需求或手动提示词生成室内效果图。
- 3D 效果图生成：上传一张或多张平面图，自动解析空间结构、门窗、家具、动线和硬约束，再生成 3D/鸟瞰/轴测效果图。
- 参考图输入：支持上传参考图进行图生图约束。
- 自动提示词生成：把用户需求、平面图分析和上一轮反馈编译成适合图像模型的正向/负向提示词。
- 自动评估与迭代：生成后用视觉模型按空间一致性、风格一致性、视觉质量、需求符合度和明显错误等维度评分。
- 模型回退：主画图模型连续失败后，可切换到备用画图模型继续尝试。
- 多 API 格式：支持 OpenAI、OpenAI Responses、Gemini、Anthropic、Azure OpenAI、Ollama、Custom OpenAI 等兼容接口。
- Web 操作界面：内置 Gradio 界面，支持上传、预览、复制当前大图、查看提示词和评估报告。
- HTTP API：提供 FastAPI 服务，便于前端或其他系统调用。
- React 原型：`ui-prototype` 提供一个 Vite + React 的产品界面原型，通过 `/api/generate` 调用后端。
- 前端 API 配置验证：React 原型可调用 `/api/config/verify-analysis` 和 `/api/config/verify-image` 检查模型配置。
- 结果库体验：React 原型会在当前浏览器会话中保留最近生成结果，支持预览、下载图片和复制运行摘要。

## 项目结构

```text
.
├── README.md
├── start_3d_render_agent.bat
└── 3d-render-agent/
    ├── main.py                  # Gradio 主界面与运行入口
    ├── app_runtime.py           # Gradio/FastAPI 共用的运行时、配置覆盖、API 验证和 pipeline 调用
    ├── api_server.py            # FastAPI 兼容启动入口
    ├── backend/                 # 分层 FastAPI 应用
    │   └── app/
    │       ├── main.py          # create_app 与路由装配
    │       ├── settings.py      # 服务端口、host、CORS 配置
    │       ├── routes/          # health/config/generate 路由
    │       ├── services/        # 生成服务、上传文件处理
    │       └── schemas/         # API 表单/领域数据结构
    ├── pipeline.py              # 生图、评估、迭代与模型切换流程
    ├── config.py                # 配置加载、API 格式与能力判断
    ├── config.example.json      # 配置样例
    ├── .env.example             # 环境变量样例
    ├── requirements.txt         # Python 依赖
    ├── adapters/                # LLM / Vision / Image 模型适配器
    ├── agents/                  # 平面图分析、提示词生成、评估、路由策略
    ├── models/                  # Pydantic 数据结构
    ├── benchmarks/              # 基准样例
    ├── tests/                   # pytest 测试，含后端 API 测试
    └── ui-prototype/            # React + Vite 前端原型
        └── src/
            ├── api/             # 前端 API client、生成接口、配置验证接口
            ├── components/      # UI 组件
            ├── data/            # 静态文案和演示数据
            ├── types/           # 前端领域类型
            └── utils/           # 文案和数据处理工具
```

## 快速启动

### 方式一：Windows 一键启动

在项目根目录双击或运行：

```bat
start_3d_render_agent.bat
```

脚本会进入 `3d-render-agent` 目录，检查依赖，必要时执行 `pip install -r requirements.txt`，然后启动 Gradio 应用。默认地址：

```text
http://127.0.0.1:7860/
```

如果 7860 被占用，程序会尝试后续端口。

### 方式二：手动启动 Gradio 应用

```bash
cd 3d-render-agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
copy .env.example .env
python main.py
```

macOS / Linux 可将激活命令替换为：

```bash
source .venv/bin/activate
cp config.example.json config.json
cp .env.example .env
python main.py
```

## 配置 API Key

项目不会提交真实密钥。请在本地创建下面两个文件：

```bash
cd 3d-render-agent
copy config.example.json config.json
copy .env.example .env
```

macOS / Linux：

```bash
cp config.example.json config.json
cp .env.example .env
```

然后编辑 `.env`：

```env
LLM_API_KEY=你的分析模型Key
VISION_API_KEY=你的视觉模型Key
IMAGE_API_KEY=你的画图模型Key
```

再编辑 `config.json`，填写模型供应商、API 格式、Base URL 和模型名称。核心配置项包括：

- `llm`：需求解析与提示词生成模型。
- `vision`：平面图解析和生成图评估模型。
- `image_gen`：实际生成图片的模型。
- `max_iterations`：最大迭代次数。
- `quality_threshold`：质量通过阈值，默认 6.5。
- `image_model_fallbacks`：备用画图模型列表。
- `model_switch_after_failures`：连续失败几轮后切换模型。
- `stop_after_last_model_failures`：最后一个模型连续失败几轮后停止。

支持的 API 格式包括：

```text
openai_chat, openai_responses, gemini, openai_image, anthropic,
azure_openai, custom_openai_chat, custom_openai_image, ollama,
new_api, cherryin
```

## 使用方式

### Gradio 界面

启动 `python main.py` 后，在浏览器打开 Gradio 地址。界面中可以：

- 选择“常规生图”或“3D效果图”。
- 上传平面图，可多选。
- 上传参考图，可选。
- 输入设计需求，例如风格、视角、空间功能、材质、禁止项。
- 直接填写手动提示词，跳过自动提示词生成。
- 设置最大迭代次数、主模型、备用模型和失败切换策略。
- 验证分析模型和画图模型是否可用。
- 查看平面图解析结果、最终提示词、评估报告和执行日志。

生成图片会保存到 `3d-render-agent/outputs/`，该目录已被 `.gitignore` 排除。

### FastAPI 服务

启动 API：

```bash
cd 3d-render-agent
python api_server.py
```

默认地址：

```text
http://127.0.0.1:8787
```

可通过环境变量调整 host、端口和 CORS：

```bash
APP_HOST=0.0.0.0 APP_PORT=8787 APP_CORS_ORIGINS=http://127.0.0.1:5174 python api_server.py
```

兼容旧变量名：`API_HOST`、`API_PORT`。

可用接口：

- `GET /api/health`：健康检查。
- `POST /api/config/verify-analysis`：验证分析/视觉模型。
- `POST /api/config/verify-image`：验证画图模型。
- `POST /api/generate`：提交需求、平面图和参考图并生成结果。

`/api/generate` 使用 `multipart/form-data`，常用字段包括：

- `mode`：`normal` 或 `render3d`。
- `requirement`：设计需求文本。
- `manual_prompt`：手动提示词，可选。
- `max_iterations`：最大迭代次数。
- `floor_plans`：平面图文件，可多选。
- `reference_image`：参考图文件，可选。
- `analysis_*` / `img_*`：前端临时覆盖的模型配置，可选。

### React 前端原型

React 原型位于 `3d-render-agent/ui-prototype`。

先启动后端：

```bash
cd 3d-render-agent
python api_server.py
```

再启动前端：

```bash
cd 3d-render-agent/ui-prototype
npm install
npm run dev
```

默认前端地址：

```text
http://127.0.0.1:5174/
```

前端 API 配置方式：

- `VITE_API_TARGET`：Vite 开发代理目标，默认 `http://127.0.0.1:8787`。
- `VITE_API_BASE_URL`：前端直接请求的 API Base URL。为空时使用同源 `/api`，适合走 Vite 代理；部署到静态站点时可设为后端完整地址。
- `VITE_PORT`：前端开发服务端口。

示例：

```bash
VITE_API_TARGET=http://127.0.0.1:8787 npm run dev
# 或部署/预览时直接指定 API Base URL
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run build
```

## 部署方式建议：EXE 还是 VPS？

当前阶段更建议先用“本地源码运行”或“VPS 部署”测试，不建议立刻打包成 EXE。

### 推荐结论

- 本地测试：直接拉取源码运行，最方便排查 API Key、模型接口、依赖和生成质量问题。
- 小范围自用/团队测试：部署到 VPS 更合适，可以统一配置模型 Key、统一保存 outputs，并通过浏览器访问。
- EXE 打包：适合功能稳定之后再做。当前项目包含 Python、Gradio、FastAPI、React、模型配置、上传文件和输出目录，打包成单个 EXE 会增加依赖体积、路径处理、密钥配置和升级维护成本。

### 什么时候选择 EXE？

如果目标用户是完全不懂命令行的 Windows 用户，并且希望双击运行、离线配置、单机使用，可以后续用 PyInstaller/Nuitka 做 EXE 包。但建议等下面这些能力稳定后再做：

- 配置向导和 API Key 本地加密保存。
- 输出目录、日志目录和缓存目录可配置。
- 前后端静态资源打包流程稳定。
- 模型接口和错误提示已充分测试。

### 什么时候选择 VPS？

如果你希望自己或团队用浏览器访问，建议 VPS 部署：

- 后端统一运行 FastAPI 或 Gradio。
- 前端 React 构建后通过 Nginx/Caddy 托管。
- API Key 放在 VPS 的 `.env` 和 `config.json`，不需要每台电脑重复配置。
- 后续可以更容易增加登录、任务队列、历史记录和对象存储。

## 本地拉取测试

如果你要测试当前 PR 分支：

```bash
git clone https://github.com/wlohf/PicCreator.git
cd PicCreator
git fetch origin
git checkout refine-3d-render-agent-frontend-backend
```

如果你已经 clone 过仓库：

```bash
cd PicCreator
git fetch origin
git checkout refine-3d-render-agent-frontend-backend
git pull
```

### 本地测试 Gradio

```bash
cd 3d-render-agent
python -m venv .venv
```

Windows：

```bat
.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
copy .env.example .env
python main.py
```

macOS / Linux：

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
cp .env.example .env
python main.py
```

然后编辑 `config.json` 和 `.env`，填入你的模型配置和 API Key。

### 本地测试前后端分离版本

启动后端：

```bash
cd 3d-render-agent
python api_server.py
```

启动前端：

```bash
cd 3d-render-agent/ui-prototype
npm install
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

如需指定 API 地址：

```bash
VITE_API_TARGET=http://127.0.0.1:8787 npm run dev
```

## 生成流程

```text
用户需求 / 平面图 / 参考图
        ↓
需求解析与平面图结构化分析
        ↓
生成正向提示词与负向提示词
        ↓
调用画图模型生成图片
        ↓
调用视觉模型评估生成结果
        ↓
通过阈值则结束；未通过则根据反馈优化提示词或切换模型
        ↓
输出最优图片、提示词、评分、报告和运行记录
```

## 测试与验证

运行 Python 测试：

```bash
cd 3d-render-agent
pytest
```

运行 Python 编译检查：

```bash
cd 3d-render-agent
python -m py_compile api_server.py app_runtime.py main.py backend/app/main.py backend/app/routes/*.py backend/app/services/*.py backend/app/schemas/*.py
```

运行前端依赖审计和构建检查：

```bash
cd 3d-render-agent/ui-prototype
npm install
npm audit --audit-level=moderate
npm run build
```

本轮重构验证结果：

- `python -m pytest -q`：20 passed。
- `npm audit --audit-level=moderate`：0 vulnerabilities。
- `npm run build`：通过。
- FastAPI smoke：`GET /api/health` 返回 200。
- Gradio smoke：首页返回 200。

## 已完成的重构重点

- 后端从单文件 API 入口拆分为 `backend.app` 分层结构。
- `api_server.py` 保留为兼容启动入口，实际委托 `backend.app.main.app`。
- `app_runtime.py` 统一承载 Gradio 与 FastAPI 共用的运行时逻辑，降低重复代码。
- FastAPI 路由拆分为 health、config、generate。
- 上传文件处理和生成服务拆入 services。
- 新增后端 API 测试，覆盖健康检查、非法生成模式、配置验证错误路径。
- 前端拆出 API client、领域类型、静态数据、工具函数和基础组件。
- React 原型支持生成请求、API Base URL 配置、模型配置验证和状态提示。
- React 原型新增会话级结果库、图片打开/下载、运行摘要复制和操作 toast。
- Vite dev/preview 支持 `0.0.0.0`、`allowedHosts` 和可配置代理目标。

## 后续计划

- 继续拆分 React 页面中的中大型区域组件，例如 `ChatWorkspace`、`RenderControlPanel`、`ModelConfigPanel`、`QualityReviewPanel`。
- 增强前端实际运行态：更细粒度生成进度、错误恢复、持久化历史记录和批量导出。
- 为 `/api/generate` 增加更多 mock pipeline 测试，覆盖成功返回、上传文件、多图输入和模型配置覆盖。
- 增加前后端联调测试或端到端 smoke 测试。
- 进一步规范 API 响应结构，便于前端统一展示错误、日志、图片和评估结果。
- 根据实际模型测试结果优化提示词模板、质量阈值和失败切换策略。

## 注意事项

- 不要提交 `.env`、`config.json`、`outputs/`、`node_modules/`、缓存目录和本地测试结果。
- `config.example.json` 和 `.env.example` 用于说明配置格式，不应包含真实密钥。
- 如果画图模型不支持图像输入，上传平面图或参考图时可能会被跳过或报错。
- 3D 模式对视觉模型能力依赖较强，平面图解析质量会直接影响最终效果。
