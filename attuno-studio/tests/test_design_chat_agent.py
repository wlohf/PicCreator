import json

from backend.app.services.design_chat_agent import DesignChatAgent
from backend.app.services.preferences_store import apply_chat_memory, create_memory_item, load_style_profile, load_memory_view


def test_design_chat_agent_classifies_style_revision_and_builds_draft():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "这个风格太商务了，想要温馨一点，灯光柔和暖光",
            "project_id": "villa-a",
            "active_result_id": "result-1",
            "context": {"room_type": "客厅", "view": "俯视透视"},
        }
    )

    assert result["ok"] is True
    assert result["intent"] == "revise_style"
    assert result["suggested_action"] == "image_edit"
    assert result["ui_hints"]["switch_to_edit"] is True
    assert "保留原有结构和视角" in result["draft_instruction"]
    assert "温馨" in result["draft_instruction"]
    assert "柔和暖光" in result["draft_instruction"]
    assert len(result["draft_instruction"]) < 220
    assert "会保留" in result["reply"]


def test_design_chat_agent_classifies_furniture_topology_feedback():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "家具数量不对，工位朝向错了，左下卧室床也摆放错乱",
            "active_result_id": "result-2",
            "context": {"floor": "2F"},
        }
    )

    assert result["intent"] == "revise_structure"
    assert result["suggested_action"] == "image_edit"
    assert "结构一致性" in result["reply"]
    assert "家具拓扑" in result["reply"]
    assert "家具数量" in result["draft_instruction"]
    assert "朝向" in result["draft_instruction"]
    assert "保留原有结构和视角" in result["draft_instruction"]


def test_design_chat_agent_extracts_memory_candidate():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "记住：我喜欢轻盈温馨的新中式、暖白墙面和胡桃木，不喜欢红金宫廷欧式，结构还原第一，家具数量和朝向第二。",
        }
    )

    memory = result["memory_candidate"]
    assert result["intent"] == "remember_preference"
    assert result["suggested_action"] == "remember"
    assert "轻盈" in memory["likes"]
    assert "温馨" in memory["likes"]
    assert "新中式" in memory["likes"]
    assert "暖白" in memory["likes"]
    assert "胡桃木" in memory["likes"]
    assert "红金" in memory["avoids"]
    assert "宫廷" in memory["avoids"]
    assert "欧式" in memory["avoids"]
    assert any("结构" in item for item in memory["evaluation_standards"])
    assert any("家具" in item for item in memory["evaluation_standards"])


def test_design_chat_agent_allows_daily_chat_without_draft():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "今天先聊聊这个项目的推进节奏",
            "context": {"workspace_mode": "chat"},
        }
    )

    assert result["ok"] is True
    assert result["intent"] == "daily_chat"
    assert result["suggested_action"] == "chat"
    assert result["draft_instruction"] == ""
    assert result["ui_hints"]["apply_to_composer"] is False


def test_design_chat_agent_keeps_generic_generate_requests_as_daily_chat():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "帮我生成一份今天的项目推进清单",
            "context": {"workspace_mode": "chat"},
        }
    )

    assert result["intent"] == "daily_chat"
    assert result["suggested_action"] == "chat"
    assert result["draft_instruction"] == ""
    assert result["ui_hints"]["apply_to_composer"] is False


def test_design_chat_agent_keeps_logo_naming_brainstorm_as_daily_chat():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "我想设计一个中转站的logo，但是我不太懂，我个人是比较喜欢武侠风格，你能给点建议么，名字方面也可以帮我想一想",
            "active_result_id": "result-1",
            "context": {"workspace_mode": "chat"},
        }
    )

    assert result["intent"] == "daily_chat"
    assert result["suggested_action"] == "chat"
    assert result["draft_instruction"] == ""
    assert "基于当前图改图" not in result["reply"]
    assert result["ui_hints"]["apply_to_composer"] is False
    assert result["ui_hints"]["switch_to_edit"] is False


def test_design_chat_agent_builds_draft_for_explicit_chat_image_request():
    agent = DesignChatAgent()

    result = agent.respond(
        {
            "message": "帮我画一张暖色的新中式客厅效果图",
            "context": {"workspace_mode": "chat"},
        }
    )

    assert result["intent"] == "new_generation"
    assert result["suggested_action"] == "generate"
    assert "新中式客厅效果图" in result["draft_instruction"]
    assert result["ui_hints"]["apply_to_composer"] is True


def test_apply_chat_memory_dedupes_and_preserves_existing_data(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "preferences.json").write_text(
        json.dumps(
            {
                "shortcuts": [{"id": "s1", "zh": "快捷", "en": "shortcut"}],
                "user_style_preferences": {"explicit": ["温馨"], "inferred": ["雅致"], "avoid": ["红金"]},
                "project_style_memories": {"p1": {"style": ["现有项目风格"], "structure": ["保留楼梯"], "furniture": [], "materials": [], "lighting": [], "avoid": []}},
                "reference_memories": [{"id": "ref-1", "project_id": "p1"}],
                "behavior_signals": [],
                "preference_summary": {"evaluation_standards": ["旧标准"], "long_term_preferences": [], "project_preferences": {}, "avoid_items": [], "frequent_edit_requests": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    saved = apply_chat_memory(
        "p1",
        {
            "likes": ["温馨", "轻盈"],
            "avoids": ["红金", "过度装饰"],
            "project": ["右下办公室必须保留"],
            "evaluation_standards": ["结构还原第一", "旧标准"],
        },
    )

    profile = load_style_profile("p1")
    assert profile["user_style_preferences"]["explicit"] == ["温馨", "轻盈"]
    assert profile["user_style_preferences"]["inferred"] == ["雅致"]
    assert profile["user_style_preferences"]["avoid"] == ["红金", "过度装饰"]
    assert "现有项目风格" in profile["project_style_memory"]["style"]
    assert "保留楼梯" in profile["project_style_memory"]["structure"]
    assert "右下办公室必须保留" in profile["project_style_memory"]["structure"]
    assert saved["shortcuts"][0]["id"] == "s1"
    assert "reference_memories" not in saved
    assert "reference_memories" not in profile
    assert saved["preference_summary"]["evaluation_standards"].count("结构还原第一") == 1
    assert saved["preference_summary"]["evaluation_standards"].count("旧标准") == 1


def test_create_memory_item_adds_manual_preference(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))

    memory = create_memory_item("浅色木材和柔和自然光", "long_term_preferences", "p-manual")
    view = load_memory_view("p-manual")

    sections = {section["id"]: section for section in view["sections"]}
    assert memory["project_id"] == "p-manual"
    assert "浅色木材和柔和自然光" in [
        item["text"] for item in sections["long_term_preferences"]["items"]
    ]
    assert "浅色木材和柔和自然光" in load_style_profile("p-manual")["preference_summary"]["long_term_preferences"]
