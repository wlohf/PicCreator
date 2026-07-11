# Attuno

Attuno 是一个面向室内设计场景的 AI 对话与图像辅助项目。当前主产品形态是 `Attuno`：默认从聊天开始，需要出图时再切到图像工作区，通过平面图分析、快捷短语、提示词覆盖、严格复核和结果续改，把自然语言需求整理成更稳定的室内效果图流程。

当前版本已经完成前后端分离：

- 后端：FastAPI，提供认证、配置、生成、结果、偏好与记忆相关 API
- 前端：Vite + React，提供聊天优先的工作台界面
- 旧的 Gradio 本地工作台不再是默认入口

## 项目文档

- [文档索引](docs/README.md)
- [需求文档](docs/requirements.md)
- [技术文档](docs/technical-architecture.md)
- [项目进度](docs/project-status.md)

## 当前产品形态

- 聊天优先：默认进入日常对话工作区，普通聊天不会隐式触发出图
- 流式对话：日常聊天支持流式输出、暂停中的状态提示和中断控制
- 图像辅助：需要出图时切到图像工作区，支持 `standard` 和 `render3d` 两个主模式
- 自定义图像模式：用户可以保存自己的图像提示词模板，并在图像工作区像模式一样选择使用
- 彩色平面图：`colored_floor_plan` 仍受后端支持，但前端作为显式工具动作出现，不作为主模式
- 账号隔离：聊天历史、结果库、API Key、快捷短语、偏好和记忆按登录账号隔离
- 手动记忆：聊天中识别出的偏好不会自动写入，只有用户点击“记住”后才会持久化
- 结果续改：支持查看结果、记笔记、继续编辑、标注续改和 A/B 比较分析

## 2026-06-03 更新

本次更新重点补齐“可长期使用”的配置、提示词和图像工作流能力：

- 多 API 供应商档案：
  - 分析/聊天模型与画图模型分别支持多个供应商档案
  - 每个档案保存名称、API 格式、Base URL、API Key 和模型名
  - 切换供应商后，聊天、生成、图片编辑、模型检测和连通性校验都会使用当前档案
  - 修复刷新后活动供应商 id 被改写、只能回到第一个供应商的问题
  - 修复当前账号的非活动供应商 Key 在加载时被误清空的问题
  - API Key 输入框增加显示/隐藏按钮，默认 Base URL 调整为 `https://api.xyleisure.site/v1`

- 自定义图像提示词模式：
  - 新增账号级 `prompt_skills` 偏好接口
  - 前端支持新增、编辑、删除自定义图像模式
  - 模板支持 `{prompt}` 或 `{{prompt}}` 占位符
  - 自定义模式提交时仍使用后端稳定的 `standard` 生成模式，避免把用户模板变成后端枚举
  - 聊天历史会保存当前选择的 `promptModeId`

- 图像生成与编辑体验：
  - `standard` 模式上传图片时按参考图处理，不再误当作平面图
  - 生成流支持 `AbortSignal`，前端可中断正在进行的生成请求
  - 图片编辑请求支持中断信号
  - 复制渲染消息时优先复制图片
  - 图片上传预览、设置抽屉和生成控制布局更紧凑

- 图片比较分析：
  - 支持 A/B 图片对比
  - 默认优先选择当前聊天最近两张生成图
  - 可以从当前聊天和图片库手动替换 A/B 槽位
  - 只有不足两张可比较生成图时，才回退到“平面图 vs 效果图”对比

- 聊天与模型选择：
  - 聊天工作区中，logo 命名、风格建议等头脑风暴问题会保持普通聊天，不会误触发图像工作流
  - 明确“帮我画 / 画一张 / 生成效果图”等表达才进入生成草稿
  - 生成过程中仍可切换历史会话；打开历史会话时会清掉已提交但残留在输入框里的草稿
  - 聊天模型候选来自用户配置和显式加入的检测结果，不再混入硬编码默认模型
  - 过滤 `g`、`gpt-`、`gpt-5.`、`your-*-model` 等未完成模型名片段
  - 模型候选支持从设置界面移除；删除默认模型时自动提升下一个候选

- 后端与规范：
  - 配置加载先清理默认工作区 Key，再合并当前账号覆盖，避免默认 Key 泄露，同时保留当前账号自己的供应商 Key
  - `GET /api/config` 返回的 provider id 保持和保存时一致
  - Trellis 规格补充了 API Config Provider Profiles、prompt skills、A/B 对比和模型候选管理的约束
  - 新增覆盖多供应商 round-trip、非活动供应商 Key 保留、自定义提示词模式、standard 参考图上传、聊天路由等回归测试

## 核心能力

- 常规生图：根据自然语言需求直接生成室内效果图
- 平面图转 3D：上传平面图后自动解析结构、空间关系和硬约束，再生成 3D 效果图
- 彩色平面图工具：保持原始布局生成正交彩平图
- 自定义图像模式：保存个人提示词模板，把主输入内容自动套入模板后提交
- 提示词编译：把需求、平面图解析和已有偏好整理成适合图像模型的输入
- 可选严格复核：默认关闭；开启后，视觉模型可在首轮出图后建议追加迭代
- 多模型兼容：支持 OpenAI / Responses / Gemini / Anthropic / Azure OpenAI / Ollama / Custom 等兼容接口，并支持按账号保存多个供应商档案
- 结果资产管理：预览、下载、复制摘要、查看笔记、继续编辑、A/B 比较分析
- 偏好与记忆：区分日常聊天记忆、生图长期偏好、避免项、项目偏好和评判标准

## 项目结构

```text
.
├── README.md
├── AGENTS.md
├── start_attuno_studio.bat
├── .agents/                  # 项目级 Trellis skills
├── .codex/                   # 项目级 Codex agents / hooks 配置
├── .trellis/                 # 工作流、脚本、规范与任务记录
└── attuno-studio/
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
start_attuno_studio.bat
```

脚本会进入 `attuno-studio`，检查依赖并启动后端与前端。默认端口：

```text
API: http://127.0.0.1:8787
Web: http://127.0.0.1:42958
```

### 手动启动

后端：

```bash
cd attuno-studio
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
copy .env.example .env
python api_server.py
```

macOS / Linux：

```bash
cd attuno-studio
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
cp .env.example .env
python api_server.py
```

前端：

```bash
cd attuno-studio/ui-prototype
npm install
npm run dev
```

如果前端代理地址需要显式指定：

```bash
VITE_API_TARGET=http://127.0.0.1:8787 npm run dev
```

## 首次配置

项目不会提交真实密钥。先在 `attuno-studio/` 目录准备：

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
- “模型与 API”设置支持多个分析/聊天供应商档案和多个画图供应商档案
- 当前选中的供应商会同步到旧的平铺字段，保证已有聊天、生成、图片编辑和验证接口继续兼容
- 非活动供应商档案也会保留自己的 Key，方便后续切换

## 使用方式

### 账号与工作区

- 打开前端后，默认先登录或注册
- 登录成功后，当前账号的聊天历史、结果、快捷短语、偏好和记忆会自动恢复
- 登出后，界面会清空当前账号可见状态，重新回到登录入口

### 聊天工作区

- 用于日常对话、需求整理、草稿生成
- 聊天不会直接出图
- 如果聊天内容适合转图像工作区，系统会给出可一键带入的图像草稿
- 普通 logo 方向、命名、风格建议等咨询会保持日常聊天
- 明确要求“画一张 / 生成效果图 / 出图”时才进入图像生成草稿
- 聊天回复支持流式输出，正在输出时会显示状态提示

### 图像工作区

- `standard`：文本直通图片模型
- `render3d`：平面图感知的 3D 效果图流程
- `colored_floor_plan`：作为工具动作触发，不作为主模式显示
- `standard` 上传图片时作为参考图使用，适合根据已有图片改风格或做参考生成
- 自定义图像模式会把模板应用到主输入，再以 `standard` 提交
- 生成和图片编辑请求支持中断

### 模型与 API

- 分析/聊天供应商和画图供应商分别管理
- 每个供应商档案包含：供应商名称、API 格式、Base URL、API Key、模型名
- 可以新增、选择、重命名、删除供应商档案
- 可以检测供应商模型列表，并把检测到的模型显式加入聊天或画图模型候选
- 已加入模型候选可以删除；删除默认模型会自动切换到下一个候选
- API Key 默认隐藏，可点击眼睛按钮临时显示

### 自定义图像模式

- 在设置抽屉的“提示词 / 图像模式”区域新增模式
- 模式包含名称、说明和提示词模板
- 模板可使用 `{prompt}` 或 `{{prompt}}` 表示用户输入
- 如果模板没有占位符，系统会把模板和用户输入拼接后提交
- 自定义模式按账号保存，刷新后仍可继续使用

### 图片比较

- 生成图支持 A/B 比较
- 默认使用当前聊天中最近两张生成图
- 也可以从当前聊天或图片库中手动指定 A/B
- 如果只有一张生成图且存在平面图来源，则使用“平面图 / 效果图”对比

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
- `POST /api/config/models-analysis`
- `POST /api/config/models-image`
- `POST /api/generate`
- `POST /api/generate/stream`
- `GET /api/results`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/memory`
- `GET /api/preferences/prompt-skills`
- `PUT /api/preferences/prompt-skills`
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

`/api/config/save` 除旧的平铺字段外，还支持：

- `analysis_providers_json`
- `active_analysis_provider_id`
- `image_providers_json`
- `active_image_provider_id`

`GET /api/config` 会返回：

- `analysisProviders`
- `activeAnalysisProviderId`
- `imageProviders`
- `activeImageProviderId`

## 测试与验证

后端测试：

```bash
cd attuno-studio
python -m pytest tests/test_backend_api.py tests/test_app_runtime.py -q
```

前端构建：

```bash
cd attuno-studio/ui-prototype
npm run build
```

前端当前有若干独立测试脚本，例如：

```bash
npm run test:chat-sessions
npm run test:result-asset-urls
npm run test:composer-layout
```

本次更新已验证：

```bash
cd attuno-studio
python -m pytest tests/test_backend_api.py::test_config_save_and_load_preserves_multiple_provider_profiles tests/test_backend_api.py::test_config_load_preserves_non_active_provider_keys_for_current_user tests/test_backend_api.py::test_fresh_token_namespace_load_inherits_default_config_without_exposing_keys tests/test_backend_api.py::test_token_namespace_config_save_and_load_are_isolated tests/test_backend_api.py::test_authenticated_user_config_save_and_load_are_isolated tests/test_backend_api.py::test_daily_chat_non_default_user_missing_key_does_not_fallback_to_workspace_key tests/test_backend_api.py::test_default_workspace_config_save_persists_analysis_image_config_and_env tests/test_backend_api.py::test_image_api_format_save_and_load_preserves_openai_image_option tests/test_backend_api.py::test_image_api_format_save_and_load_preserves_custom_openai_image_option -q
python -m pytest tests/test_design_chat_agent.py tests/test_backend_api.py::test_chat_endpoint_routes_logo_name_brainstorm_to_daily_chat_model tests/test_backend_api.py::test_generate_endpoint_routes_standard_upload_as_reference_image tests/test_backend_api.py::test_prompt_skill_preferences_are_persisted_and_normalized -q
```

```bash
cd attuno-studio/ui-prototype
npm run test:composer-layout
npm run build
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
- Ubuntu VPS 部署：更适合团队共用浏览器访问，推荐使用 systemd 运行后端、Nginx 托管前端并反代 `/api`

服务器部署与后续更新已经整理为脚本和文档：

```bash
# 首次部署/补依赖/构建前端
bash deploy/install.sh

# 后续更新：git pull、刷新依赖、构建、重启 API、reload Nginx
bash deploy/update.sh
```

详细步骤见 [Ubuntu 部署与更新](attuno-studio/docs/deployment.md)。如果后续再做面向非技术用户的单机交付，再考虑 EXE 打包会更稳。
