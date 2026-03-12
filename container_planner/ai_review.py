from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any
from urllib import error, request

import pandas as pd


@dataclass
class AIReviewConfig:
    api_key: str
    model: str
    base_url: str
    timeout_sec: int


@dataclass
class AIReviewResult:
    caution_points: list[str]
    check_items: list[str]
    improvement_suggestions: list[str]
    raw_text: str


def load_ai_review_config() -> AIReviewConfig | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
    timeout_value = os.getenv("OPENAI_TIMEOUT_SEC", "30").strip()
    try:
        timeout_sec = int(timeout_value)
    except ValueError:
        timeout_sec = 30

    return AIReviewConfig(api_key=api_key, model=model, base_url=base_url, timeout_sec=max(timeout_sec, 5))


def build_ai_review_prompt(summary_df: pd.DataFrame, placement_df: pd.DataFrame) -> str:
    summary_csv = summary_df.to_csv(index=False)
    placement_cols = [
        "container_label",
        "cargo_piece_id",
        "cargo_desc",
        "cargo_weight_kg",
        "cargo_m3",
        "placed_x_cm",
        "placed_y_cm",
        "placed_z_cm",
        "oog_flag",
        "special_container_reason",
    ]
    available_cols = [col for col in placement_cols if col in placement_df.columns]
    placement_excerpt = placement_df[available_cols].head(80)
    placement_csv = placement_excerpt.to_csv(index=False)

    return (
        "あなたはコンテナ積載計画のレビュー担当です。"
        "次のデータを読み、実務向けに簡潔にダブルチェックしてください。\n"
        "出力は必ずJSONのみで返し、以下のキーを使ってください。\n"
        "- caution_points: 注意点（最大5件）\n"
        "- check_items: 確認事項（最大5件）\n"
        "- improvement_suggestions: 改善提案（最大5件）\n"
        "各要素は短い日本語の文字列にしてください。\n\n"
        "[集計結果CSV]\n"
        f"{summary_csv}\n"
        "[配置サマリCSV（先頭80行）]\n"
        f"{placement_csv}"
    )


def _extract_text_from_response(data: dict[str, Any]) -> str:
    if "choices" in data and data["choices"]:
        message = data["choices"][0].get("message", {})
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text_parts.append(str(item.get("text", "")))
            return "\n".join(part for part in text_parts if part)
    return ""


def _normalize_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def parse_ai_review_response(text: str) -> AIReviewResult:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()

    payload: dict[str, Any] = {}
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        payload = {}

    caution_points = _normalize_list(payload.get("caution_points"))
    check_items = _normalize_list(payload.get("check_items"))
    improvement_suggestions = _normalize_list(payload.get("improvement_suggestions"))

    if not any([caution_points, check_items, improvement_suggestions]) and text.strip():
        check_items = ["応答形式が想定外のため、下記の生データを確認してください。"]

    return AIReviewResult(
        caution_points=caution_points,
        check_items=check_items,
        improvement_suggestions=improvement_suggestions,
        raw_text=text,
    )


def request_ai_review(config: AIReviewConfig, prompt: str) -> AIReviewResult:
    endpoint = f"{config.base_url}/chat/completions"
    body = {
        "model": config.model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "あなたは物流計画レビューの専門家です。"},
            {"role": "user", "content": prompt},
        ],
    }
    req = request.Request(
        endpoint,
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=config.timeout_sec) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"AIレビューAPIエラー: HTTP {exc.code} {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"AIレビューAPI接続エラー: {exc.reason}") from exc

    text = _extract_text_from_response(data)
    return parse_ai_review_response(text)
