"""Phase 3 (optional) -- a small Plotly/Dash dashboard for pipeline health.

Reads the append-only `silver/dq_report` history when Spark is available, and
always falls back to the JSON snapshot the last run wrote
(`dq_report_latest.json`). This is a standalone dev tool -- it is NOT part of the
deployed Next.js app and shares nothing with it.

Run:
    pip install plotly dash
    python -m batch_pipeline.dashboard.dq_dashboard   # -> http://127.0.0.1:8055
"""
from __future__ import annotations

import json
import os

from .. import config


def _load_snapshot() -> dict:
    if os.path.exists(config.DQ_SNAPSHOT_PATH):
        with open(config.DQ_SNAPSHOT_PATH) as fh:
            return json.load(fh)
    return {}


def _figures(report: dict):
    import plotly.graph_objects as go

    null_rates = report.get("null_rates", {})
    # Show the 12 columns with the highest null rate.
    top = sorted(null_rates.items(), key=lambda kv: kv[1], reverse=True)[:12]
    cols = [c for c, _ in top]
    rates = [r for _, r in top]
    null_fig = go.Figure(go.Bar(x=rates, y=cols, orientation="h",
                                marker_color="#8b6cef"))
    null_fig.update_layout(title="Null rate by column (top 12)", template="plotly_white",
                           height=420, margin=dict(l=140, r=20, t=50, b=30))

    recon_fig = go.Figure(go.Bar(
        x=["Bronze in", "Silver out"],
        y=[report.get("bronze_rows", 0), report.get("silver_rows", 0)],
        marker_color=["#c9b8f5", "#8b6cef"],
    ))
    recon_fig.update_layout(title="Row-count reconciliation", template="plotly_white",
                            height=420, margin=dict(l=40, r=20, t=50, b=30))
    return null_fig, recon_fig


def build_app():
    from dash import Dash, dcc, html

    report = _load_snapshot()
    null_fig, recon_fig = _figures(report)
    passed = report.get("passed")
    status_color = "#2f9e6b" if passed else "#d9534f" if passed is not None else "#888"

    app = Dash(__name__)
    app.layout = html.Div(style={"maxWidth": 980, "margin": "40px auto", "fontFamily": "system-ui"}, children=[
        html.H2("VaultStream · Batch DQ report"),
        html.Div([
            html.Span("Latest run: "),
            html.Strong(report.get("batch_id", "no runs yet")),
            html.Span("  ·  "),
            html.Span("PASSED" if passed else ("FAILED" if passed is not None else "—"),
                      style={"color": status_color, "fontWeight": 700}),
        ], style={"marginBottom": 8}),
        html.Div([
            html.Span(f"Duplicate rate: {report.get('duplicate_rate', '—')}  ·  "),
            html.Span(f"Row shrink: {report.get('rowcount_shrink_rate', '—')}  ·  "),
            html.Span(f"Orphan identity rows: {report.get('orphan_identity_rows', '—')}"),
        ], style={"color": "#555", "marginBottom": 24}),
        dcc.Graph(figure=recon_fig),
        dcc.Graph(figure=null_fig),
        html.Pre(json.dumps(report.get("failures", []), indent=2),
                 style={"background": "#faf7ff", "padding": 16, "borderRadius": 12}),
    ])
    return app


if __name__ == "__main__":
    build_app().run(debug=False, port=8055)
