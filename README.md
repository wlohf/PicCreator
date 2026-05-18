# PicCreator

PicCreator 是一个面向室内设计场景的 AI 对话与图像辅助项目。当前主产品形态是 `PicCreator Chat`：默认从聊天开始，需要出图时再切到图像工作区，通过平面图分析、快捷短语、提示词覆盖、严格复核和结果续改，把自然语言需求整理成更稳定的室内效果图流程。

当前版本已经完成前后端分离：

- 后端：FastAPI，提供认证、配置、生成、结果、偏好与记忆相关 API
- 前端：Vite + React，提供聊天优先的工作台界面
- 旧的 Gradio 本地工作台不再是默认入口

## 当前产品形态

- 聊天优先：默认进入日常对话工作区，普通聊天不会隐式触发出图
- 图像辅助：需要出图时切到图像工作区，支持 `standard` 和 `render3d` 两个主模式
- 彩色平面图：`colored_floor_plan` 仍受后端支持，但前端作为显式工具动作出现，不作为主模式
- 账号隔离：聊天历史、结果库、API Key、快捷短语、偏好和记忆按登录账号隔离
- 手动记忆：聊天中识别出的偏好不会自动写入，只有用户点击“记住”后才会持久化
- 结果续改：支持查看结果、记笔记、继续编辑、标注续改和比较分析

## 核心能力

- 常规生图：根据自然语言需求直接生成室内效果图
- 平面图转 3D：上传平面图后自动解析结构、空间关系和硬约束，再生成 3D 效果图
- 彩色平面图工具：保持原始布局生成正交彩平图
- 提示词编译：把需求、平面图解析和已有偏好整理成适合图像模型的输入
- 可选严格复核：默认关闭；开启后，视觉模型可在首轮出图后建议追加迭代
- 多模型兼容：支持 OpenAI / Responses / Gemini / Anthropic / Azure OpenAI / Ollama / Custom 等兼容接口
- 结果资产管理：预览、下载、复制摘要、查看笔记、比较分析
- 偏好与记忆：区分日常聊天记忆、生图长期偏好、避免项、项目偏好和评判标准

## 项目结构

```text
.
├── README.md
├── AGENTS.md
├── start_3d_render_agent.bat
├── .agents/                  # 项目级 Trellis skills
├── .codex/                   # 项目级 Codex agents / hooks 配置
├── .trellis/                 # 工作流、脚本、规范与任务记录
└── 3d-render-agent/
    ├── api_server.py         # FastAPI 启动入口
    ├── app_runtime.py        # 运行时配置、API 验证和 pipeline 调用
    ├── config.py             # 配置加载与能力判断
    ├── config.example.json
    ├── .env.example
    ├── pipeline.py
    ├── adapters/             # 模型适配器
    ├── agents/               # 分析、提示词、评估、路由策略
    ├── backend/
    │   └── app/
    │       ├── main.py
    │       ├── settings.py
    │       ├── routes/
    │       ├── services/
    │       └── schemas/
    ├── tests/
    └── ui-prototype/         # React 前端工作台
        └── src/
            ├── api/
            ├── components/
            ├── data/
            ├── types/
            └── utils/
```

## 快速启动

### Windows 一键启动

在仓库根目录运行：

```bat
start_3d_render_agent.bat
```

脚本会进入 `3d-render-agent`，检查依赖并启动后端与前端。默认端口：

```text
API: http://127.0.0.1:8787
Web: http://127.0.0.1:5174
```

### 手动启动

后端：

```bash
cd 3d-render-agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
copy .env.example .env
python api_server.py
```

macOS / Linux：

```bash
cd 3d-render-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
cp .env.example .env
python api_server.py
```

前端：

```bash
cd 3d-render-agent/ui-prototype
npm install
npm run dev
```

如果前端代理地址需要显式指定：

```bash
VITE_API_TARGET=http://127.0.0.1:8787 npm run dev
```

## 首次配置

项目不会提交真实密钥。先在 `3d-render-agent/` 目录准备：

```bash
copy config.example.json config.json
copy .env.example .env
```

然后编辑 `.env`：

```env
LLM_API_KEY=你的分析模型Key
VISION_API_KEY=你的视觉模型Key
IMAGE_API_KEY=你的画图模型Key
```

再编辑 `config.json`，填写模型供应商、API 格式、Base URL 和模型名。

需要注意：

- `default` 工作区仍保留兼容逻辑
- 登录用户不会自动继承默认工作区的 API Key
- 登录后应在前端“模型与 API”设置中为当前账号保存自己的 key

## 使用方式

### 账号与工作区

- 打开前端后，默认先登录或注册
- 登录成功后，当前账号的聊天历史、结果、快捷短语、偏好和记忆会自动恢复
- 登出后，界面会清空当前账号可见状态，重新回到登录入口

### 聊天工作区

- 用于日常对话、需求整理、草稿生成
- 聊天不会直接出图
- 如果聊天内容适合转图像工作区，系统会给出可一键带入的图像草稿

### 图像工作区

- `standard`：文本直通图片模型
- `render3d`：平面图感知的 3D 效果图流程
- `colored_floor_plan`：作为工具动作触发，不作为主模式显示

### 记忆与偏好

- 只有用户手动点击“记住”后，聊天提取出的偏好才会保存
- 前端记忆面板支持查看、编辑和删除
- 记忆分组包括：
  - 日常聊天记忆
  - 生图长期偏好
  - 避免项
  - 项目偏好
  - 评判标准
  - 最近常见修改

## API 概览

常用接口：

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/config`
- `POST /api/config/save`
- `POST /api/config/verify-analysis`
- `POST /api/config/verify-image`
- `POST /api/generate`
- `GET /api/results`
- `POST /api/chat`
- `POST /api/chat/memory`
- `GET /api/preferences/memory`

`/api/generate` 使用 `multipart/form-data`，常用字段包括：

- `mode`
- `requirement`
- `manual_prompt`
- `max_iterations`
- `floor_plans`
- `reference_image`
- `analysis_*`
- `img_*`

## 测试与验证

后端测试：

```bash
cd 3d-render-agent
python -m pytest tests/test_backend_api.py tests/test_app_runtime.py -q
```

前端构建：

```bash
cd 3d-render-agent/ui-prototype
npm run build
```

前端当前有若干独立测试脚本，例如：

```bash
npm run test:chat-sessions
npm run test:result-asset-urls
npm run test:composer-layout
```

## 仓库辅助目录

为了让仓库在 GitHub 上保持可复现，同时避免混入本地运行痕迹，目录按下面原则处理：

- 保留：
  - `.trellis/` 中的 `workflow.md`、`scripts/`、`spec/`、当前需要的 `tasks/`
  - `.agents/`
  - `.codex/`

- 不提交本地运行态：
  - `.claude/`
  - `.downloads/`
  - `.ace-tool/`
  - `.vscode/`
  - `.trellis/.runtime/`
  - `.trellis/workspace/`
  - `.trellis/.backup-*`
  - `.tmp-*.png`
  - `__pycache__/`
  - `.pytest_cache/`

## 部署建议

现阶段更适合两种方式：

- 本地源码运行：最方便调试模型、API Key 和提示词行为
- VPS 部署：更适合团队共用浏览器访问

如果后续再做面向非技术用户的单机交付，再考虑 EXE 打包会更稳。
