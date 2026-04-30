# PicCreator

PicCreator 是一个面向室内设计与 3D 效果图生成的自动化生图项目。项目核心是 `3d-render-agent`：它可以读取设计需求、平面图和参考图，自动生成提示词，调用图像模型生成效果图，再用视觉模型对结果进行评估，并根据反馈继续迭代优化。

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

## 项目结构

```text
.
├── README.md
├── start_3d_render_agent.bat
└── 3d-render-agent/
    ├── main.py                  # Gradio 主界面与运行入口
    ├── api_server.py            # FastAPI 接口服务
    ├── pipeline.py              # 生图、评估、迭代与模型切换流程
    ├── config.py                # 配置加载、API 格式与能力判断
    ├── config.example.json      # 配置样例
    ├── .env.example             # 环境变量样例
    ├── requirements.txt         # Python 依赖
    ├── adapters/                # LLM / Vision / Image 模型适配器
    ├── agents/                  # 平面图分析、提示词生成、评估、路由策略
    ├── models/                  # Pydantic 数据结构
    ├── benchmarks/              # 基准样例
    ├── tests/                   # pytest 测试
    └── ui-prototype/            # React + Vite 前端原型
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
```

## 配置 API Key

项目不会提交真实密钥。请在本地创建下面两个文件：

```bash
cd 3d-render-agent
copy config.example.json config.json
copy .env.example .env
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

可用接口：

- `GET /api/health`：健康检查。
- `POST /api/config/verify-analysis`：验证分析/视觉模型。
- `POST /api/config/verify-image`：验证画图模型。
- `POST /api/generate`：提交需求、平面图和参考图并生成结果。

### React 前端原型

React 原型位于 `3d-render-agent/ui-prototype`，通过 Vite 代理把 `/api` 请求转发到 `http://127.0.0.1:8787`。

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

## 测试

运行 Python 测试：

```bash
cd 3d-render-agent
pytest
```

运行前端构建检查：

```bash
cd 3d-render-agent/ui-prototype
npm run build
```

## 注意事项

- 不要提交 `.env`、`config.json`、`outputs/`、`node_modules/`、缓存目录和本地测试结果。
- `config.example.json` 和 `.env.example` 用于说明配置格式，不应包含真实密钥。
- 如果画图模型不支持图像输入，上传平面图或参考图时可能会被跳过或报错。
- 3D 模式对视觉模型能力依赖较强，平面图解析质量会直接影响最终效果。
