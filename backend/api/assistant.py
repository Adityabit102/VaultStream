"""VaultAI — the in-app assistant.

Answers questions, surfaces live insights, and guides navigation. Works fully
offline with a data-grounded responder; if ANTHROPIC_API_KEY is configured it
upgrades to Claude with the same live context injected.
"""
import os
from typing import List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from auth import verify_token

router = APIRouter()


class Message(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChatReq(BaseModel):
    messages: List[Message]


class Suggestion(BaseModel):
    label: str
    href: str


class ChatResp(BaseModel):
    reply: str
    suggestions: List[Suggestion] = []
    source: str  # 'claude' | 'grounded'


# ---------------------------------------------------------------------------
# Live context — grounds every reply in the app's real state.
# ---------------------------------------------------------------------------
def _gather_context() -> dict:
    ctx: dict = {"by_label": {}, "total": 0, "fraud_rate": None,
                 "model": {}, "rules": 0, "system": []}
    # Alert stats
    try:
        from database import db
        if db.DB_ENABLED:
            summary = db.analytics_summary(30)
            if summary:
                ctx["by_label"] = summary.get("by_label", {})
                ctx["total"] = summary.get("totals", {}).get("transactions", 0)
                ctx["fraud_rate"] = summary.get("totals", {}).get("fraud_rate")
        if not ctx["total"]:
            from .alerts import mock_alerts
            from collections import Counter
            by = Counter(a.get("risk_label", "SAFE") for a in mock_alerts)
            ctx["by_label"] = dict(by)
            ctx["total"] = sum(by.values())
    except Exception:
        pass
    # Model metadata
    try:
        from .predict import metadata, threshold
        auc = metadata.get("val_auc")
        ctx["model"] = {
            "auc": round(float(auc), 4) if auc is not None else None,
            "threshold": round(float(threshold), 3),
            "trained_at": metadata.get("trained_at"),
        }
    except Exception:
        pass
    # Rules
    try:
        from database import db
        rules = db.list_rules() or []
        ctx["rules"] = len(rules)
    except Exception:
        pass
    return ctx


def _fmt_context(ctx: dict) -> str:
    by = ctx.get("by_label", {})
    lines = [
        f"Total scored transactions: {ctx.get('total', 0)}",
        f"By verdict: FRAUD={by.get('FRAUD', 0)}, SUSPICIOUS={by.get('SUSPICIOUS', 0)}, SAFE={by.get('SAFE', 0)}",
    ]
    if ctx.get("fraud_rate") is not None:
        lines.append(f"Fraud rate: {ctx['fraud_rate']}%")
    m = ctx.get("model", {})
    if m:
        lines.append(f"Model: XGBoost, validation AUC {m.get('auc')}, decision threshold {m.get('threshold')}")
    lines.append(f"Active rules: {ctx.get('rules', 0)}")
    if ctx.get("system"):
        down = [c["name"] for c in ctx["system"] if not c["ok"]]
        lines.append("System: " + ("all components operational" if not down else "DOWN -> " + ", ".join(down)))
    return "\n".join(lines)


PAGES = {
    "workspace": "/workspace", "dashboard": "/workspace", "alerts": "/workspace",
    "analytics": "/analytics", "insights": "/analytics",
    "batch": "/batch", "csv": "/batch", "upload": "/batch",
    "rules": "/rules", "rule": "/rules",
    "status": "/status", "health": "/status", "system": "/status",
    "settings": "/settings", "preferences": "/settings", "api key": "/settings", "keys": "/settings", "theme": "/settings",
    "lab": "/lab", "model lab": "/lab", "train": "/lab", "model": "/lab",
    "admin": "/admin",
}

SYSTEM_PROMPT = """You are VaultAI, the built-in assistant for VaultStream — a real-time fraud-detection platform.

About the platform:
- Streams transactions through an XGBoost model (TreeSHAP explanations) plus a hybrid rules engine, scoring each as SAFE / SUSPICIOUS / FRAUD in real time.
- Pages: Workspace (live alert feed, simulator, deep-dive with SHAP & risk factors), Analytics (trends & drift), Batch (CSV scoring), Rules (define deterministic rules), Status (service health), Settings (theme, notifications, decision threshold, API keys), Model Lab (train/compare/promote models; admin).
- Roles: viewer / analyst / admin. Analysts can freeze & escalate; admins manage rules, keys, threshold, and the Lab.

Your job: answer questions, surface insights from the LIVE CONTEXT below, explain fraud/ML concepts, and guide users to the right page. Be concise (under 140 words), warm, and concrete. Use the real numbers from the context. When guiding navigation, name the page. Never invent data not in the context."""


def _call_claude(messages: List[Message], ctx: dict) -> Optional[str]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        model = os.environ.get("VAULTAI_MODEL", "claude-haiku-4-5-20251001")
        sys = SYSTEM_PROMPT + "\n\nLIVE CONTEXT:\n" + _fmt_context(ctx)
        resp = client.messages.create(
            model=model,
            max_tokens=600,
            system=sys,
            messages=[{"role": m.role, "content": m.content} for m in messages if m.role in ("user", "assistant")],
        )
        return "".join(block.text for block in resp.content if getattr(block, "type", "") == "text").strip()
    except Exception as e:
        print(f"VaultAI Claude path failed, falling back: {e}")
        return None


# ---------------------------------------------------------------------------
# Grounded fallback responder — keyword intents over the live context.
# ---------------------------------------------------------------------------
def _grounded_reply(text: str, ctx: dict) -> ChatResp:
    t = text.lower().strip()
    by = ctx.get("by_label", {})
    m = ctx.get("model", {})
    sug: List[Suggestion] = []

    def has(*words):
        return any(w in t for w in words)

    if has("take me", "go to", "open ", "navigate", "bring me", "jump to"):
        target = next((href for kw, href in PAGES.items() if kw in t), None)
        if target:
            page = target.strip("/") or "home"
            reply = f"Sure — opening {page.title()}. Tap the link below."
            sug = [Suggestion(label=f"Go to {page}", href=target)]
        else:
            reply = "Which page? I can open Workspace, Analytics, Batch, Rules, Status, Settings, or the Model Lab."
            sug = [Suggestion(label="Workspace", href="/workspace"), Suggestion(label="Rules", href="/rules"), Suggestion(label="Status", href="/status")]
        return ChatResp(reply=reply, suggestions=sug, source="grounded")
    if has("hello", "hi ", "hey", "yo ") or t in ("hi", "hey", "yo"):
        reply = ("Hi — I'm VaultAI, your fraud-ops copilot. I can surface live stats, explain a verdict, "
                 "walk you through the platform, or take you to the right page. What do you need?")
        sug = [Suggestion(label="Show fraud stats", href=""), Suggestion(label="Open Workspace", href="/workspace")]
    elif has("what can you", "help", "who are you", "capab"):
        reply = ("I can: report live fraud stats, explain the model & SHAP, summarize system health, "
                 "guide you through batch scoring / rules / settings, and jump you to any page. "
                 "Ask me things like “how many fraud alerts?”, “what's the model AUC?”, or “take me to rules”.")
        sug = [Suggestion(label="Workspace", href="/workspace"), Suggestion(label="Status", href="/status"), Suggestion(label="Settings", href="/settings")]
    elif has("fraud rate", "how many", "stats", "count", "fraud alert", "suspicious", "how much fraud", "overview"):
        rate = f" (a {ctx['fraud_rate']}% fraud rate)" if ctx.get("fraud_rate") is not None else ""
        reply = (f"Across {ctx.get('total', 0)} scored transactions: "
                 f"{by.get('FRAUD', 0)} FRAUD, {by.get('SUSPICIOUS', 0)} SUSPICIOUS, {by.get('SAFE', 0)} SAFE{rate}. "
                 "Open the Workspace for the live feed or Analytics for trends.")
        sug = [Suggestion(label="Live feed", href="/workspace"), Suggestion(label="Analytics", href="/analytics")]
    elif has("auc", "accuracy", "model", "threshold", "how good", "performance"):
        reply = (f"The production model is XGBoost with a validation AUC of {m.get('auc', 'n/a')} and a decision "
                 f"threshold of {m.get('threshold', 'n/a')} — scores above it are flagged FRAUD. Admins can retrain "
                 "and compare algorithms in the Model Lab, or tune the threshold in Settings.")
        sug = [Suggestion(label="Model Lab", href="/lab"), Suggestion(label="Tune threshold", href="/settings")]
    elif has("status", "health", "system", "redis", "kafka", "postgres", "down", "operational"):
        down = [c["name"] for c in ctx.get("system", []) if not c["ok"]]
        state = "All services are operational." if (ctx.get("system") and not down) else (
            f"Degraded: {', '.join(down)} is down." if down else "Check the Status page for live service health.")
        reply = f"{state} The Status page shows live health for the model, Redis, Kafka/Redpanda and Postgres."
        sug = [Suggestion(label="Open Status", href="/status")]
    elif has("rule", "escalate condition"):
        reply = (f"The hybrid rules engine runs deterministic rules alongside the ML score on every transaction "
                 f"(currently {ctx.get('rules', 0)} active). An “escalate” rule lifts the verdict; “flag” annotates it. "
                 "Admins create rules like amount > 5000 AND device_shift == 1 on the Rules page.")
        sug = [Suggestion(label="Open Rules", href="/rules")]
    elif has("batch", "csv", "upload", "bulk"):
        reply = ("Batch scoring lets you upload a CSV of transactions (needs an amount column) and scores them all "
                 "through the model + rules, with a downloadable verdict file. Analyst access required.")
        sug = [Suggestion(label="Open Batch", href="/batch")]
    elif has("api key", "ingest key", "x-api-key", "authenticate"):
        reply = ("Generate API keys in Settings (admin) to authenticate the /v1/ingest endpoint with an X-API-Key "
                 "header. The full key is shown only once at creation.")
        sug = [Suggestion(label="Manage keys", href="/settings")]
    elif has("dark", "light", "theme", "mode"):
        reply = ("Toggle light/dark with the ☾/☀ button in the header (top-right), or pick a theme in Settings → "
                 "Appearance. Your choice is remembered on this device.")
        sug = [Suggestion(label="Appearance", href="/settings")]
    elif has("shap", "explain", "why was", "why is", "feature", "contribution"):
        reply = ("Each alert's deep-dive shows a SHAP waterfall: bars to the right pushed the score toward fraud, "
                 "bars to the left suppressed it. Alongside it you'll see the velocity risk factors (tx counts, "
                 "spend, device shift) and any rules that fired. Select an alert in the Workspace to inspect it.")
        sug = [Suggestion(label="Open Workspace", href="/workspace")]
    else:
        reply = (f"Here's the current picture: {ctx.get('total', 0)} transactions scored, "
                 f"{by.get('FRAUD', 0)} flagged FRAUD, model AUC {m.get('auc', 'n/a')}. "
                 "Ask me about stats, the model, system health, rules, or say “take me to…” a page.")
        sug = [Suggestion(label="Fraud stats", href=""), Suggestion(label="System status", href="/status")]
    return ChatResp(reply=reply, suggestions=sug, source="grounded")


@router.post("/v1/assistant/chat", response_model=ChatResp)
async def assistant_chat(req: ChatReq, user: dict = Depends(verify_token)):
    ctx = _gather_context()
    # System health is async — fetch it here and merge into the context.
    try:
        from . import status as status_mod
        sysres = await status_mod.system_status()
        ctx["system"] = [{"name": c["name"], "ok": c["ok"]} for c in sysres.get("components", [])]
    except Exception:
        pass
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    claude_reply = _call_claude(req.messages, ctx)
    if claude_reply:
        # Attach navigation suggestions inferred from the question for one-tap routing.
        sug: List[Suggestion] = []
        t = last_user.lower()
        target = next((href for kw, href in PAGES.items() if kw in t), None)
        if target:
            sug = [Suggestion(label=f"Go to {target.strip('/') or 'home'}", href=target)]
        return ChatResp(reply=claude_reply, suggestions=sug, source="claude")

    return _grounded_reply(last_user, ctx)
