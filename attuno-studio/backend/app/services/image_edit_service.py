import asyncio
import json
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw

from adapters import build_adapter
from app_runtime import _build_analysis_adapter_config, _build_runtime_config, run_pipeline
from backend.app.schemas.generation import AnnotatedEditImageForm, EditImageForm
from backend.app.services.generation_service import NoopProgress
from backend.app.services.result_store import create_result, get_result, get_result_floor_plan_path, get_result_image_path
from backend.app.services.preferences_store import format_style_profile_context, record_behavior_signal
from config import adapter_supports_image_inputs
from models.schemas import GenerationMode


MAX_ANNOTATION_BYTES = 12 * 1024 * 1024


def _clip(value: Any, limit: int = 3000) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n..."


def _build_source_context(source: dict[str, Any]) -> str:
    sections = []
    if source.get("prompt"):
        sections.append(f"源图提示词：\n{_clip(source.get('prompt'), 4000)}")
    if source.get("evaluation"):
        sections.append(f"源图评价报告：\n{_clip(source.get('evaluation'), 3000)}")
    if source.get("logs"):
        sections.append(f"源图日志摘要：\n{_clip(source.get('logs'), 2000)}")
    return "\n\n".join(sections)


def _build_edit_requirement(source: dict[str, Any], edit_instruction: str, project_context: str, model_warning: str = "") -> str:
    source_title = str(source.get("title") or "")
    source_context = _build_source_context(source)
    context = f"\n\n已记忆的用户/项目偏好：\n{project_context}" if project_context else ""
    warning = f"\n\n模型能力提示：{model_warning}" if model_warning else ""
    history = f"\n\n源图历史信息：\n{source_context}" if source_context else ""
    return (
        "请基于参考图继续生成一个修改版本。参考图是上一版结果，必须尽量保留原图的构图、主体、空间结构、镜头、比例和未提及区域。\n"
        f"上一版结果：{source_title or 'Render result'}\n"
        f"用户修改要求：{edit_instruction.strip()}\n"
        "只修改用户明确要求的内容，不要主动大幅改变风格或布局。"
        f"{history}"
        f"{context}"
        f"{warning}"
    )

def _latest_snapshot(payload):
    latest = None
    for snapshot in payload:
        latest = snapshot
    return latest


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {"raw": raw}
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else {"raw": raw}
            except json.JSONDecodeError:
                pass
    return {"raw": raw}


def _contain(image: Image.Image, size: tuple[int, int], fill: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new("RGB", size, fill)
    candidate = image.copy()
    candidate.thumbnail(size, Image.LANCZOS)
    left = (size[0] - candidate.width) // 2
    top = (size[1] - candidate.height) // 2
    canvas.paste(candidate, (left, top))
    return canvas


def _build_annotation_analysis_image(clean_path: Path, annotated_bytes: bytes) -> bytes:
    clean = Image.open(clean_path).convert("RGB")
    marked = Image.open(BytesIO(annotated_bytes)).convert("RGB")
    panel_size = (760, 560)
    header_height = 34
    gap = 16
    bg = (23, 20, 17)
    clean_panel = _contain(clean, panel_size, (240, 235, 225))
    marked_panel = _contain(marked, panel_size, (240, 235, 225))
    canvas = Image.new("RGB", (panel_size[0] * 2 + gap, panel_size[1] + header_height), bg)
    canvas.paste(clean_panel, (0, header_height))
    canvas.paste(marked_panel, (panel_size[0] + gap, header_height))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 10), "LEFT: clean source image", fill=(245, 240, 231))
    draw.text((panel_size[0] + gap + 10, 10), "RIGHT: user annotation overlay", fill=(245, 240, 231))
    buffer = BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()


async def _analyze_annotation(
    form: AnnotatedEditImageForm,
    source: dict[str, Any],
    source_path: Path,
    annotation_bytes: bytes,
    project_context: str,
) -> dict[str, Any]:
    composite = _build_annotation_analysis_image(source_path, annotation_bytes)
    prompt = f"""
你会看到一张左右对照图：左侧是干净源图，右侧是同一张图上的用户标注版本。标注可能包含红圈、矩形、箭头、画笔涂鸦或短文字。

请只返回 JSON，不要输出 Markdown。字段如下：
marked_region: 用户标注区域/对象是什么；
user_intent: 用户想修改什么，如果文字不足则基于标注合理推断；
preserve_regions: 必须保持不变的区域数组；
edit_prompt: 给画图模型的最终中文改图提示词，强调只改指定区域，保持源图构图、主体、空间关系、镜头、比例和未提及区域；
negative_prompt: 负向约束，必须包括不要生成红圈、箭头、涂鸦、标注文字、手绘线条；
confidence: 0 到 1 的数字；
needs_user_clarification: 如果用户没有写修改文字且意图不明确则为 true，否则 false。

用户补充文字：{form.edit_instruction.strip() or "（用户没有补充文字，请根据标注做保守推断）"}

源图标题：{source.get("title") or "Render result"}
源图提示词摘要：{_clip(source.get("prompt"), 2000)}
已记忆偏好：{_clip(project_context, 2000)}
""".strip()
    cfg = _build_analysis_adapter_config(
        form.analysis_provider_name,
        form.analysis_api_format,
        form.analysis_base_url,
        form.analysis_api_key,
        form.analysis_model,
        user_id=form.config_user_id,
    )
    adapter = build_adapter(cfg, "vision")
    raw = await asyncio.wait_for(adapter.analyze(composite, prompt), timeout=min(int(cfg.timeout or 60), 120))
    parsed = _parse_json_object(raw)
    parsed.setdefault("raw", raw)
    return parsed


def _build_annotation_requirement(source: dict[str, Any], form: AnnotatedEditImageForm, analysis: dict[str, Any], project_context: str, model_warning: str = "") -> str:
    edit_prompt = str(analysis.get("edit_prompt") or "").strip()
    user_intent = str(analysis.get("user_intent") or "").strip()
    marked_region = str(analysis.get("marked_region") or "").strip()
    preserve_regions = analysis.get("preserve_regions")
    negative_prompt = str(analysis.get("negative_prompt") or "").strip()
    source_context = _build_source_context(source)
    preserved = "；".join(str(item) for item in preserve_regions if item) if isinstance(preserve_regions, list) else str(preserve_regions or "")
    warning = f"\n\n模型能力提示：{model_warning}" if model_warning else ""
    context = f"\n\n已记忆的用户/项目偏好：\n{project_context}" if project_context else ""
    history = f"\n\n源图历史信息：\n{source_context}" if source_context else ""
    return (
        "标注续改任务：分析模型已经读取了用户标注图；画图阶段只应参考干净源图，不要把标注线条带入最终图片。\n"
        "必须保持原图构图、主体、空间关系、镜头、比例和未提及区域。只修改用户标注/说明指向的局部。\n"
        f"用户原始修改文字：{form.edit_instruction.strip() or '用户没有补充文字，按标注做保守局部修改'}\n"
        f"标注区域理解：{marked_region or '未明确'}\n"
        f"修改意图：{user_intent or '未明确'}\n"
        f"必须保持不变：{preserved or '除修改区域外的所有内容'}\n"
        f"最终改图提示词：{edit_prompt or user_intent or form.edit_instruction.strip()}\n"
        f"负向约束：{negative_prompt or '不要生成红圈、箭头、涂鸦、标注文字、手绘线条；不要改变未提及区域。'}"
        f"{history}"
        f"{context}"
        f"{warning}"
    )


def _resolve_reference_path(form: EditImageForm, source_path: Path) -> tuple[str | None, str, str]:
    try:
        cfg = _build_runtime_config(
            form.max_iterations,
            form.analysis_provider_name,
            form.analysis_api_format,
            form.analysis_base_url,
            form.analysis_api_key,
            form.analysis_model,
            form.img_provider_name,
            form.img_api_format,
            form.img_base_url,
            form.img_api_key,
            form.img_model,
        form.fallback_models_text,
        form.model_switch_after_failures,
        form.stop_after_last_model_failures,
        user_id=form.config_user_id,
    )
    except Exception as exc:
        warning = f"配置解析失败，使用源图作为参考图：{exc}"
        return str(source_path), warning, form.img_model
    model_queue = [cfg.image_gen.model] + list(cfg.image_model_fallbacks or [])
    supported = [model_name for model_name in model_queue if adapter_supports_image_inputs(cfg.image_gen, model_name)]
    if supported:
        return str(source_path), "", supported[0]
    warning = (
        "当前画图模型链不支持参考图输入，后端已改为仅使用分析后的文本提示词尽量重建；"
        "这类模型无法严格保持源图局部一致。"
    )
    return None, warning, model_queue[0] if model_queue else form.img_model


def _run_edit_pipeline(form: EditImageForm, reference_path: str | None, requirement: str):
    return _latest_snapshot(
        run_pipeline(
            GenerationMode.RENDER3D.value,
            [],
            reference_path,
            requirement,
            "",
            "",
            form.max_iterations,
            form.analysis_provider_name,
            form.analysis_api_format,
            form.analysis_base_url,
            form.analysis_api_key,
            form.analysis_model,
            form.img_provider_name,
            form.img_api_format,
            form.img_base_url,
            form.img_api_key,
            form.img_model,
            form.fallback_models_text,
            form.model_switch_after_failures,
            form.stop_after_last_model_failures,
            form.enable_quality_evaluation,
            project_id=form.project_id,
            user_id=form.config_user_id,
            progress=NoopProgress(),
        )
    )


def _snapshot_to_result(
    *,
    snapshot,
    source: dict[str, Any],
    form: EditImageForm,
    edit_mode: str,
    annotation_path: str | None = None,
    annotation_analysis: dict[str, Any] | None = None,
    model_warning: str = "",
    model_used: str = "",
):
    if snapshot is None:
        return error_response("image-edit", "改图流程没有返回结果")

    current_preview, output_images, status_text, floor_desc, prompt_text, eval_report, logs = snapshot
    if str(status_text or "").startswith("执行失败"):
        return error_response("image-edit", status_text or logs or "改图失败")

    image_sources = [(path, label) for path, label in output_images if path]
    if not image_sources and isinstance(current_preview, str):
        image_sources.append((current_preview, "edited render"))
    if not image_sources:
        return error_response("image-edit", "改图流程没有返回图片")

    parent_version = int(source.get("version_index") or 1)
    project_id = form.project_id or str(source.get("project_id") or "default")
    source_floor_plan_path = get_result_floor_plan_path(form.source_result_id, form.user_id)
    result = create_result(
        title=f"{source.get('title') or 'Render result'} · v{parent_version + 1}",
        status=status_text or "修改成功",
        image_path=image_sources[0][0],
        image_label=image_sources[0][1] or "edited render",
        prompt=prompt_text,
        evaluation=eval_report,
        floor_desc=floor_desc,
        logs=logs,
        parent_id=form.source_result_id,
        generation_type="edit",
        edit_mode=edit_mode,
        edit_instruction=form.edit_instruction,
        annotation_path=annotation_path,
        annotation_analysis=annotation_analysis or {},
        floor_plan_path=str(source_floor_plan_path) if source_floor_plan_path else "",
        floor_plan_name=str(source.get("floor_plan_name") or ""),
        source_prompt=str(source.get("prompt") or ""),
        source_evaluation=str(source.get("evaluation") or ""),
        source_logs=str(source.get("logs") or ""),
        model_used=model_used or form.img_model,
        model_warning=model_warning,
        version_index=parent_version + 1,
        project_id=project_id,
        user_id=form.user_id,
    )
    record_behavior_signal(
        "annotated_edit" if edit_mode == "annotation" else "edit",
        result_id=form.source_result_id,
        project_id=project_id,
        user_id=form.user_id,
        payload={
            "edit_instruction": form.edit_instruction,
            "new_result_id": result["id"],
            "source_title": source.get("title") or "",
            "edit_mode": edit_mode,
        },
    )
    return {"ok": True, "result": result, "results": [result], "model_warning": model_warning}


async def edit_render(form: EditImageForm, style_profile: dict | None = None):
    source = get_result(form.source_result_id, form.user_id)
    source_path = get_result_image_path(form.source_result_id, form.user_id)
    if source is None or source_path is None:
        return error_response("image-edit", "找不到可继续修改的源图片")
    if not form.edit_instruction.strip():
        return error_response("image-edit", "请输入要修改的内容")

    project_context = format_style_profile_context(style_profile or {})
    reference_path, model_warning, model_used = _resolve_reference_path(form, source_path)
    requirement = _build_edit_requirement(source, form.edit_instruction, project_context, model_warning)
    try:
        snapshot = await asyncio.to_thread(_run_edit_pipeline, form, reference_path, requirement)
    except Exception as exc:
        return error_response("image-edit", f"{type(exc).__name__}: {exc}")

    return _snapshot_to_result(
        snapshot=snapshot,
        source=source,
        form=form,
        edit_mode="text",
        model_warning=model_warning,
        model_used=model_used,
    )


async def annotated_edit_render(form: AnnotatedEditImageForm, style_profile: dict | None = None):
    source = get_result(form.source_result_id, form.user_id)
    source_path = get_result_image_path(form.source_result_id, form.user_id)
    if source is None or source_path is None:
        return error_response("annotated-image-edit", "找不到可继续修改的源图片")
    if form.annotation_image is None or not form.annotation_image.filename:
        return error_response("annotated-image-edit", "请提交带标注的图片")

    try:
        annotation_bytes = await form.annotation_image.read(MAX_ANNOTATION_BYTES + 1)
    except Exception as exc:
        return error_response("annotated-image-edit", f"读取标注图失败：{type(exc).__name__}: {exc}")
    if len(annotation_bytes) > MAX_ANNOTATION_BYTES:
        return error_response("annotated-image-edit", "标注图不能超过 12MB")
    if not form.edit_instruction.strip():
        form.edit_instruction = "用户只提交了标注图，没有补充文字；请根据标注做保守局部修改，并保持其他区域不变。"

    project_context = format_style_profile_context(style_profile or {})
    with tempfile.TemporaryDirectory(prefix="attuno-studio-annotation-") as temp_dir:
        annotation_path = Path(temp_dir) / "annotation.png"
        annotation_path.write_bytes(annotation_bytes)
        try:
            analysis = await _analyze_annotation(form, source, source_path, annotation_bytes, project_context)
            reference_path, model_warning, model_used = _resolve_reference_path(form, source_path)
            requirement = _build_annotation_requirement(source, form, analysis, project_context, model_warning)
            snapshot = await asyncio.to_thread(_run_edit_pipeline, form, reference_path, requirement)
        except Exception as exc:
            return error_response("annotated-image-edit", f"{type(exc).__name__}: {exc}")

        return _snapshot_to_result(
            snapshot=snapshot,
            source=source,
            form=form,
            edit_mode="annotation",
            annotation_path=str(annotation_path),
            annotation_analysis=analysis,
            model_warning=model_warning,
            model_used=model_used,
        )


def error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})
