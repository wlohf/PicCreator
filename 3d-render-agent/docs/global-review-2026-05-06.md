# PicCreator / 3d-render-agent 全局梳理与改造建议

> 时间：2026-05-06  
> 范围：`/mnt/e/xyleisure/PicCreator/3d-render-agent` 后端 pipeline、提示词链路、React 前端工作台、历史生成记录。  
> 目标：解释为什么“让 Codex 局部修一下”会越修越累，并给出全局层面的收敛路线。

---

## 1. 当前项目本质

这个项目不是一个普通“输入一句话 -> 出图”的页面，而是一个 **室内/平面图约束型生图工作流系统**：

```text
用户输入 + 平面图 + 参考图
        ↓
前端工作台收集需求、附件、配置、快捷短语
        ↓
FastAPI /api/generate/stream
        ↓
Pipeline：平面图分析 -> 需求解析 -> 提示词生成 -> 图像生成 -> 可选评估/迭代
        ↓
结果存储 + 前端结果库 + 改图入口
```

代码上已经具备不少能力：

- FastAPI 分层服务：`backend/app/routes/*`、`backend/app/services/*`
- 生成主流程：`pipeline.py`
- 平面图结构化分析：`agents/floor_analyzer.py` + `agents/prompt_assets.py`
- 提示词生成：`agents/prompt_gen.py`
- 图像评估：`agents/evaluator.py`
- React 工作台：`ui-prototype/src/App.tsx` + components/API/types
- SSE 进度流：`/api/generate/stream`
- 结果库、改图、参考图偏好记忆等功能

但这些能力现在更像“功能堆起来了”，还没有形成稳定的产品闭环。

---

## 2. 关键发现

### 2.1 前端 `App.tsx` 已经变成“巨型中枢”

`ui-prototype/src/App.tsx`：

- 约 2415 行
- 同时承担：状态管理、API 配置、上传、生成、结果库、改图、参考图分析、快捷短语、UI 布局、快捷键、提示词构造、历史同步等职责

这会导致：

1. 任意小改动都容易影响其他区域。
2. Codex 很容易只在局部打补丁，因为它很难在一次上下文里完整理解整个组件。
3. 交互状态之间缺少显式状态机，靠多个 `useState` 和派生变量隐式组合。
4. “页面交互感觉乱/累”不是单个按钮文案的问题，而是前端缺少明确的信息架构和工作流模型。

### 2.2 后端 pipeline 是线性流程，但产品需要的是“可检查、可干预”的工作流

`pipeline.py` 的核心流程是：

1. 分析平面图
2. 解析需求
3. 生成提示词
4. 调图像模型
5. 如果启用评估，则评估并迭代

但当前前端体验仍然更像“一键黑盒生成”。虽然 SSE 有进度，但用户很难在关键节点干预：

- 平面图分析是否正确？
- 识别出的空间/家具/门窗是否需要手工修正？
- 最终提示词是否过长、是否偏离？
- 本次失败是模型能力问题，还是提示词污染，还是平面图分析错了？

如果没有这些中间检查点，用户只能不断“再让 Codex 改一下提示词/按钮/流程”，每次都是症状修补。

### 2.3 当前提示词策略过重，且缺少“结构化 DSL -> 模型提示词”的中间层

当前 3D 提示词生成要求很强：

- 平面分析系统 prompt 约 400 行内的一大段强约束
- `FloorPlanAnalysis.to_prompt_context()` 会输出非常长的逐空间约束
- `PROMPT_GEN_SYSTEM_3D_CN` 要求正向提示词“不少于 1200 字”
- 历史记录显示实际 `floor_desc` 约 12k-13k 字，`used_prompt` 约 3.6k-4.1k 字，负向提示词 400-700 字

问题不是“提示词不够努力”，而是 **提示词过长且信息权重没有分层**：

- 模型会被大量细节淹没，真正关键的 10-20 个约束权重反而下降。
- 平面图结构、设计风格、家具细节、负向禁止项混在一个长文本里。
- 没有明确区分：硬约束 / 软约束 / 可牺牲装饰 / 不确定项。
- 没有形成可复用的“空间 DSL”或“约束卡片”，导致每次都是重新写长文。

### 2.4 默认关闭质量评估，导致无法形成自动改进闭环

前端 `enableQualityEvaluation` 默认是 `false`。最近输出记录都显示：

```text
status: success
stop_reason: quality_evaluation_disabled
quality_score: 0.0
all_scores: []
evaluation_report: None
```

这意味着当前所谓“成功”只代表图像模型返回了图片，不代表质量达标。

因此用户感觉“最终生图效果不好”时，系统并没有记录结构化原因：

- 是平面一致性差？
- 是视角错？
- 是风格不对？
- 是家具丢失？
- 是画质差？

没有评估数据，后续让 Codex 修改就缺少靶子，只能继续猜。

### 2.5 当前“参考图记忆/风格偏好”已有 UI，但和生成主提示词链路耦合不足

前端有参考图分析与记忆入口，`ProjectBriefPanel.tsx` 也能展示参考图理解结果。但需要检查并强化：

- 风格记忆是否真实进入 `direction_stack_text` 或后端生成上下文？
- 参考图分析结果是只是前端展示，还是能成为“风格约束卡”？
- 用户确认过的偏好是否有优先级、作用范围、撤销机制？

否则这块会成为“看起来高级但对出图没明显帮助”的功能。

### 2.6 当前修改量很大且工作区未提交，风险高

`git status` 显示大量修改与新增文件，说明当前处在一个大规模迭代中。此时继续让 Codex 局部改，很容易出现：

- 已有功能被覆盖
- 未提交成果难以回滚
- bug 来源不清楚
- 新功能堆叠导致交互更复杂

应先建立检查点，再拆分重构。

---

## 3. 根因判断

你现在觉得“做起来好累”，根因不是单纯代码水平问题，而是三个层面同时失控：

### 根因 A：产品工作流没有先定型

目前像是同时在做：

- 平面图转 3D
- 室内设计 prompt 工程
- 参考图风格记忆
- 结果库
- 改图
- 多模型配置
- 评估迭代

这些都对，但没有一个明确的主流程优先级。

建议先把产品主线定成：

```text
上传平面图
→ 生成/编辑空间约束卡
→ 选择风格方案
→ 预览最终提示词摘要
→ 生成 1 张图
→ 结构化评估
→ 基于评估选择：修结构 / 修风格 / 局部改图 / 保存
```

### 根因 B：提示词不是越长越好，应该从“长 prompt”升级为“约束编译器”

当前 prompt 更像长篇说明书。建议改成三层：

1. **FloorPlanSpec**：结构化平面约束，机器可读，可编辑。
2. **RenderIntent**：用户这次想要的视角、风格、目标、禁忌。
3. **PromptCompiler**：根据目标模型，把上面两层编译成短、中、长三种提示词。

这样后续修问题不是“改一整段 prompt”，而是修某张卡片：

- 电梯间位置卡
- 楼梯卡
- 阳台卡
- 风格卡
- 禁止项卡

### 根因 C：前端状态和后端状态没有统一领域模型

前端现在有很多状态，但缺少统一对象，例如：

```ts
ProjectSession
FloorPlanSpec
RenderIntent
PromptDraft
GenerationRun
EvaluationReport
RevisionTask
```

后端也有类似对象，但前后端命名和粒度不完全一致。结果就是功能越多，状态越难同步。

---

## 4. 优先级建议

### P0：先停止继续“散点式加功能”

不要再直接让 Codex 改“这个按钮、那个提示词、那个小交互”。先做一次稳定化：

1. 提交当前工作区，或至少打一个本地备份分支/tag。
2. 明确 MVP 主流程。
3. 建一个全局任务计划，再按计划拆小任务。

### P1：把“质量评估”变成默认闭环，而不是可选彩蛋

建议：

- 前端默认开启 `enableQualityEvaluation`，但允许用户选择“快速出图模式”。
- 评估结果在 UI 中按五类展示：结构、风格、画质、需求、明显错误。
- 每次生成都保存 `EvaluationReport`，即使分数低也进入结果库。
- UI 上提供“根据评估修结构 / 修风格 / 修画质”的下一步按钮。

### P1：把平面图分析结果变成可编辑“空间约束卡”

不要直接把 12k 字 `floor_desc` 塞给用户看。应该把它拆成：

- 全局布局卡
- 交通核心卡：电梯、楼梯、走道
- 空间卡：卧室、卫生间、阳台、办公室等
- 门窗墙体卡
- 关键禁止项卡

用户只需要改错的卡片，比如“电梯在西，楼梯在东”。

### P1：重构前端 App.tsx

建议拆成：

```text
src/state/useStudioSession.ts       # 主状态和动作
src/state/useGenerationRun.ts       # 生成/进度/错误/取消
src/state/useResultLibrary.ts       # 结果库
src/state/useApiConfig.ts           # API 配置
src/components/layout/*             # 页面布局
src/components/composer/*           # 输入区
src/components/floor-plan/*         # 平面图上传/分析/约束卡
src/components/generation/*         # 进度/评估/提示词
src/components/results/*            # 结果库/预览/改图
```

短期不用一次性全部重构，但至少应该先把 API/状态 hooks 抽出来，降低继续修改的成本。

### P2：建立 PromptCompiler，而不是继续堆 prompt

新增一个明确模块：

```text
agents/prompt_compiler.py
```

职责：

- 输入 `FloorPlanAnalysis`、用户需求、风格偏好、上一轮反馈
- 输出：
  - `constraint_brief`：短结构摘要
  - `positive_prompt`：目标模型可用主提示词
  - `negative_prompt`：负面提示词
  - `constraint_weights`：硬/软约束分层

目标不是马上替换全部，而是先把现有 `PromptGenerator` 的“长文本拼接”逐步迁过去。

### P2：建立基准样例和回归评测

当前已有 `benchmarks/samples.json` 和 `benchmark_runner.py`。建议把它产品化为固定样例：

- 选 3 张典型平面图：住宅、小办公室、复杂混合空间
- 每张保留：原图、人工校对 FloorPlanSpec、期望约束列表、优秀/失败示例图
- 每次改 prompt 或 pipeline 后跑基准，避免修 A 坏 B。

### P3：再做高级体验

等主流程稳定后再做：

- 多方案对比
- 风格模板市场
- 局部涂抹改图
- 长期用户偏好
- 多模型 fallback 策略优化

---

## 5. 推荐的下一步拆分计划

### 阶段 1：稳定化与观测（1-2 天）

1. 创建 checkpoint 分支或 tag。
2. 补齐本地测试依赖并确保 Python tests 与前端 build 可跑。
3. 默认开启质量评估，记录每次生成的评分与失败原因。
4. 结果库展示评估维度，而不是只显示“成功”。
5. 把最近几次失败/不满意样例整理成 benchmark case。

### 阶段 2：交互主线重整（2-4 天）

1. 设计统一工作流：上传 -> 约束确认 -> 风格确认 -> 生成 -> 评估 -> 修正。
2. 前端增加“平面图约束摘要/卡片视图”。
3. 把长 `floor_desc` 的展示从纯文本改成结构化摘要。
4. 输入区从“聊天框”改成“设计需求 + 风格 + 禁止项 + 快捷约束”的组合。
5. 生成完成后提供下一步动作按钮。

### 阶段 3：提示词架构升级（3-5 天）

1. 新增 `PromptCompiler`。
2. 引入硬约束/软约束分层。
3. 把正向提示词长度从“必须 1200 字+”改为按模型类型编译。
4. 对当前 `gpt-image-2` 做专门模板：短硬约束前置，风格后置，负向提示词只放最关键错误。
5. 用 benchmark 比较旧/新 prompt 的稳定性。

### 阶段 4：前端拆分重构（持续进行）

1. 抽出 `useApiConfig`。
2. 抽出 `useGenerationRun`。
3. 抽出 `useResultLibrary`。
4. 抽出 `ComposerPanel` / `GenerationInspector` / `FloorPlanConstraintPanel`。
5. 保持每一步都能 build，并尽量补最小测试。

---

## 6. 给 Codex / OpenHands 的任务方式建议

以后不要这样派任务：

> 帮我优化提示词，让效果更好。  
> 帮我把页面交互做顺一点。  
> 这个问题修一下。

这类任务太大也太模糊，模型只会局部 patch。

应该改成：

> 任务：抽出 `useGenerationRun` hook，不改变 UI 行为。  
> 修改文件：`src/App.tsx`、新建 `src/state/useGenerationRun.ts`。  
> 验证：`npm run build` 通过。  
> 不允许修改 prompt、样式、后端。

或：

> 任务：让生成结果无论评估是否开启，都保存 `evaluation_status` 字段。  
> 修改文件：`pipeline.py`、`models/schemas.py`、相关测试。  
> 验证：pytest 通过；旧 API response 字段兼容。

也就是说，每次只让它改一个明确层：状态、UI、后端 schema、prompt compiler、评估展示，不要混在一起。

---

## 7. 本次检查中的验证结果

已执行：

- 扫描项目结构。
- 阅读 README、配置、pipeline、prompt、evaluator、前端主组件与 API。
- 查看最近生成记录。
- 运行前端构建：`npm run build` 通过。
- 尝试运行 Python tests：当前环境缺少 `PIL`，而 `requirements.txt` 已声明 `pillow>=10.0.0`；需要先安装依赖或使用项目 venv 后再跑。

---

## 8. 一句话结论

当前项目最大问题不是“某个提示词写得不够好”或“某个交互没做好”，而是 **产品工作流、提示词架构、前端状态管理三者还没形成统一骨架**。继续局部修会越来越累；应该先把主流程和领域模型定下来，再按层拆任务。最优先的改造是：评估闭环、空间约束卡、PromptCompiler、前端状态拆分。
