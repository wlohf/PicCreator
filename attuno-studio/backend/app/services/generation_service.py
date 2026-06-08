import asyncio
import json
import re
import tempfile
from pathlib import Path
from queue import Empty, Queue
from threading import Thread

from fastapi.responses import JSONResponse, StreamingResponse

from app_runtime import run_pipeline
from backend.app.schemas.generation import GenerateForm
from backend.app.services.file_service import image_record, save_uploads
from backend.app.services.preferences_store import format_style_profile_context, record_behavior_signal
from backend.app.services.result_store import create_result, get_user_data_dir, normalize_user_id


class NoopProgress:
    def __call__(self, *_args, **_kwargs):
        return None


def is_failed_status(status_text: str) -> bool:
    status = str(status_text or "").strip()
    return status.startswith("执行失败") or "生成失败" in status or "改图失败" in status


def _floor_plan_for_label(label: str, floor_plan_paths: list[str] | None) -> str:
    paths = list(floor_plan_paths or [])
    if not paths:
        return ""
    match = re.search(r"图\s*(\d+)", str(label or ""))
    if match:
        index = int(match.group(1)) - 1
        if 0 <= index < len(paths):
            return paths[index]
    return paths[0]


def _split_uploaded_image_inputs(mode: str, uploaded_paths: list[str]) -> tuple[list[str], str | None]:
    if mode == "standard":
        return [], uploaded_paths[0] if uploaded_paths else None
    return uploaded_paths, None


def generation_output_dir(user_id: str, project_id: str) -> Path:
    path = get_user_data_dir(user_id) / "outputs" / normalize_user_id(project_id or "default")
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise PermissionError(
            f"生成输出目录不可写：{path}。请检查 ATTUNO_STUDIO_DATA_DIR/RENDER_AGENT_DATA_DIR 配置和服务用户权限。{exc}"
        ) from exc
    return path


def build_generation_payload(
    snapshot,
    mode: str = "",
    project_id: str = "default",
    user_id: str = "default",
    floor_plan_paths: list[str] | None = None,
):
    if snapshot is None:
        return None

    current_preview, output_images, status_text, floor_desc, prompt_text, eval_report, logs = snapshot
    ok = not is_failed_status(status_text)
    if not ok:
        return {
            "ok": False,
            "stage": "generation",
            "status": status_text,
            "floor_desc": floor_desc,
            "prompt": prompt_text,
            "evaluation": eval_report,
            "logs": logs,
            "error": status_text or logs or "生成失败",
            "images": [],
            "results": [],
        }

    image_sources = [(path, label) for path, label in output_images if path]
    if not image_sources and isinstance(current_preview, str):
        image_sources.append((current_preview, "current_preview"))
    if not image_sources:
        message = status_text or logs or "画图服务没有返回图片结果"
        return {
            "ok": False,
            "stage": "generation",
            "status": status_text,
            "floor_desc": floor_desc,
            "prompt": prompt_text,
            "evaluation": eval_report,
            "logs": logs,
            "error": f"画图服务没有返回图片结果：{message}",
            "images": [],
            "results": [],
        }

    results = []
    images = []
    for path, label in image_sources:
        result = create_result(
            title=label,
            status=status_text or "生成成功",
            image_path=path,
            image_label=label,
            prompt=prompt_text,
            evaluation=eval_report,
            floor_desc=floor_desc,
            logs=logs,
            floor_plan_path=_floor_plan_for_label(label, floor_plan_paths) if mode in {"render3d", "colored_floor_plan"} else "",
            generation_mode=mode,
            project_id=project_id,
            user_id=user_id,
        )
        results.append(result)
        record_behavior_signal(
            "generation",
            result_id=result["id"],
            project_id=project_id,
            user_id=user_id,
            payload={
                "mode": mode,
                "title": result.get("title") or "",
                "has_floor_desc": bool(floor_desc),
            },
        )
        image = {
            "id": result["id"],
            "label": result["image_label"] or result["title"],
            "filename": result.get("filename", ""),
            "data_url": result.get("data_url", ""),
            "url": result.get("image_url"),
            "download_url": result.get("download_url"),
        }
        if not image["data_url"]:
            legacy = image_record(path, label)
            if legacy:
                image["data_url"] = legacy["data_url"]
        images.append(image)

    return {
        "ok": ok,
        "status": status_text,
        "floor_desc": floor_desc,
        "prompt": prompt_text,
        "evaluation": eval_report,
        "logs": logs,
        "images": images,
        "results": results,
    }


def _extract_iteration(*values) -> int | None:
    for value in values:
        match = re.search(r"第\s*(\d+)\s*轮", str(value or ""))
        if match:
            return int(match.group(1))
    return None


def _infer_stage(status_text: str, floor_desc: str, prompt_text: str, eval_report: str, logs: str, has_images: bool) -> str:
    text = "\n".join(str(value or "") for value in (status_text, floor_desc, prompt_text, eval_report, logs))
    if is_failed_status(status_text):
        return "failed"
    if has_images:
        if "质量评估已关闭" in text or "质量评估未启用" in text or "quality evaluation disabled" in text.lower():
            return "completed"
        return "evaluating" if not eval_report else "completed"
    if prompt_text or "提示词" in text or "出图" in text:
        return "rendering"
    if floor_desc or "分析" in text or "平面" in text:
        return "analysis"
    return "submitted"


def build_progress_payload(snapshot, max_iterations: int | None = None):
    if snapshot is None:
        return None
    current_preview, output_images, status_text, floor_desc, prompt_text, eval_report, logs = snapshot
    has_images = bool(output_images) or current_preview is not None
    return {
        "ok": not is_failed_status(status_text),
        "stage": _infer_stage(status_text, floor_desc, prompt_text, eval_report, logs, has_images),
        "iteration": _extract_iteration(status_text, prompt_text, eval_report, logs),
        "max_iterations": max_iterations,
        "status": status_text,
        "floor_desc": floor_desc,
        "prompt": prompt_text,
        "evaluation": eval_report,
        "logs": logs,
        "has_images": has_images,
    }


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"



async def generate_render(form: GenerateForm, style_profile: dict | None = None):
    temp_dir = tempfile.TemporaryDirectory(prefix="attuno-studio-api-")
    try:
        uploaded_paths = await save_uploads(form.floor_plans, Path(temp_dir.name))
        floor_plan_paths, reference_image_path = _split_uploaded_image_inputs(form.mode, uploaded_paths)
        output_dir = generation_output_dir(form.user_id, form.project_id)
        learned_preferences_text = format_style_profile_context(style_profile)

        def _run_sync():
            result = None
            for snapshot in run_pipeline(
                form.mode,
                floor_plan_paths,
                reference_image_path,
                form.requirement,
                form.direction_stack_text,
                form.manual_prompt,
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
                learned_preferences_text=learned_preferences_text,
                record_output_dir=str(output_dir),
                progress=NoopProgress(),
            ):
                result = snapshot
            return result

        latest = await asyncio.to_thread(_run_sync)

        payload = build_generation_payload(
            latest,
            mode=form.mode,
            project_id=form.project_id,
            user_id=form.user_id,
            floor_plan_paths=floor_plan_paths,
        )
        if payload is None:
            return error_response("generation", "生成流程没有返回结果")
        if not payload.get("ok"):
            return JSONResponse(status_code=400, content=payload)
        return payload
    except Exception as exc:
        return error_response("generation", f"{type(exc).__name__}: {exc}")
    finally:
        temp_dir.cleanup()


async def stream_generate_render(form: GenerateForm, style_profile: dict | None = None):
    temp_dir = tempfile.TemporaryDirectory(prefix="attuno-studio-api-")
    try:
        uploaded_paths = await save_uploads(form.floor_plans, Path(temp_dir.name))
    except Exception:
        temp_dir.cleanup()
        raise

    async def event_generator():
        heartbeat_seconds = 10
        last_progress_key = None
        last_progress_payload = None
        latest = None
        try:
            floor_plan_paths, reference_image_path = _split_uploaded_image_inputs(form.mode, uploaded_paths)
            output_dir = generation_output_dir(form.user_id, form.project_id)
            learned_preferences_text = format_style_profile_context(style_profile)

            initial_progress = {
                "ok": True,
                "stage": "submitted",
                "iteration": 0,
                "max_iterations": form.max_iterations,
                "status": "已提交生成任务，正在直通生成" if form.mode == "standard" else "已提交生成任务，正在分析平面图与需求",
                "logs": "[已提交] 后端已收到生成任务",
                "has_images": False,
            }
            last_progress_payload = initial_progress
            last_progress_key = json.dumps(initial_progress, ensure_ascii=False, sort_keys=True)
            yield sse_event("progress", initial_progress)

            snapshot_queue: Queue = Queue()
            done_marker = object()

            def run_worker():
                try:
                    for snapshot in run_pipeline(
                        form.mode,
                        floor_plan_paths,
                        reference_image_path,
                        form.requirement,
                        form.direction_stack_text,
                        form.manual_prompt,
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
                        learned_preferences_text=learned_preferences_text,
                        record_output_dir=str(output_dir),
                        progress=NoopProgress(),
                    ):
                        snapshot_queue.put(("snapshot", snapshot))
                except Exception as exc:
                    snapshot_queue.put(("exception", exc))
                finally:
                    snapshot_queue.put(("done", done_marker))

            Thread(target=run_worker, daemon=True).start()

            while True:
                try:
                    item_type, item_payload = await asyncio.to_thread(snapshot_queue.get, True, heartbeat_seconds)
                except Empty:
                    heartbeat_payload = dict(last_progress_payload or initial_progress)
                    heartbeat_payload["status"] = heartbeat_payload.get("status") or "生成仍在进行中"
                    yield sse_event("progress", heartbeat_payload)
                    continue

                if item_type == "done":
                    break
                if item_type == "exception":
                    exc = item_payload
                    yield sse_event("error", {"ok": False, "stage": "generation", "error": f"{type(exc).__name__}: {exc}"})
                    return

                latest = item_payload
                progress_payload = build_progress_payload(latest, max_iterations=form.max_iterations)
                if not progress_payload:
                    continue
                last_progress_payload = progress_payload
                progress_key = json.dumps(progress_payload, ensure_ascii=False, sort_keys=True)
                if progress_key != last_progress_key:
                    last_progress_key = progress_key
                    yield sse_event("progress", progress_payload)

            final_payload = build_generation_payload(
                latest,
                mode=form.mode,
                project_id=form.project_id,
                user_id=form.user_id,
                floor_plan_paths=floor_plan_paths,
            )
            if final_payload is None:
                yield sse_event("error", {"ok": False, "stage": "generation", "error": "生成流程没有返回结果"})
                return
            if not final_payload.get("ok"):
                yield sse_event("error", final_payload)
                return
            yield sse_event("complete", final_payload)
        except Exception as exc:
            yield sse_event("error", {"ok": False, "stage": "generation", "error": f"{type(exc).__name__}: {exc}"})
        finally:
            temp_dir.cleanup()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )



def error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})
