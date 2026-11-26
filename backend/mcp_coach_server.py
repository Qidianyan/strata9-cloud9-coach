"""Zero-dependency Python stdlib JSON-RPC 2.0 MCP Server for Strata9.

Designed for JetBrains AI Assistant / Junie and MCP-compatible IDE companions.
Exposes real, zero-mock Cloud9 coaching tools backed by Strata9Engine over stdio:
  - get_corpus_scouting
  - simulate_tactical_what_if
  - get_match_summary

Strictly read-only against external STL_DATA_DIR; never writes or commits GRID data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, TextIO

from .server import Strata9Engine

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {
    "name": "strata9-coach-mcp",
    "version": "1.0.0",
}

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": "get_corpus_scouting",
        "description": (
            "Aggregate all locally available official Cloud9 VALORANT and Cloud9 Kia LoL "
            "GRID .jsonl.zst feeds with map/side winrates, economy tiers, objective control, "
            "Wilson 95% confidence intervals, and Cloud9 counter directives."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "enum": ["val", "lol", "all"],
                    "default": "all",
                    "description": "Esports title scope to aggregate.",
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "simulate_tactical_what_if",
        "description": (
            "Run an empirical GRID-corpus-calibrated What-If win-probability simulation "
            "(with Wilson 95% CI and coaching decision) for a Cloud9 VALORANT round or "
            "Cloud9 Kia League of Legends macro state."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["title"],
            "properties": {
                "title": {"type": "string", "enum": ["val", "lol"]},
                "map": {"type": "string", "description": "VALORANT map name or 'all'."},
                "baseline_side": {"type": "string", "enum": ["attacker", "defender"]},
                "side": {"type": "string", "enum": ["attacker", "defender"]},
                "baseline_econ_diff": {"type": "number", "minimum": -30000, "maximum": 30000},
                "econ_diff": {"type": "number", "minimum": -30000, "maximum": 30000},
                "baseline_buy_tier": {
                    "type": "string",
                    "enum": ["eco", "pistol", "half_buy", "force_buy", "full_buy"],
                },
                "buy_tier": {
                    "type": "string",
                    "enum": ["eco", "pistol", "half_buy", "force_buy", "full_buy"],
                },
                "baseline_c9_alive": {"type": "integer", "minimum": 1, "maximum": 5},
                "baseline_opp_alive": {"type": "integer", "minimum": 1, "maximum": 5},
                "c9_alive": {"type": "integer", "minimum": 1, "maximum": 5},
                "opp_alive": {"type": "integer", "minimum": 1, "maximum": 5},
                "baseline_site_state": {
                    "type": "string",
                    "enum": ["unplanted", "planted_default", "planted_crossfire", "save_weapons"],
                },
                "site_state": {
                    "type": "string",
                    "enum": ["unplanted", "planted_default", "planted_crossfire", "save_weapons"],
                },
                "baseline_first_kill": {"type": "string", "enum": ["opp", "none", "c9"]},
                "first_kill": {"type": "string", "enum": ["opp", "none", "c9"]},
                "game_minute": {"type": "integer", "minimum": 5, "maximum": 55},
                "baseline_gold_diff": {"type": "number", "minimum": -25000, "maximum": 25000},
                "gold_diff": {"type": "number", "minimum": -25000, "maximum": 25000},
                "baseline_objective_decision": {
                    "type": "string",
                    "enum": [
                        "concede_objective",
                        "trade_crossmap_tower",
                        "neutral_lane_reset",
                        "contest_dragon",
                        "secure_atakhan",
                        "secure_dragon_soul",
                        "secure_baron",
                    ],
                },
                "objective_decision": {
                    "type": "string",
                    "enum": [
                        "concede_objective",
                        "trade_crossmap_tower",
                        "neutral_lane_reset",
                        "contest_dragon",
                        "secure_atakhan",
                        "secure_dragon_soul",
                        "secure_baron",
                    ],
                },
                "baseline_dragon_diff": {"type": "integer", "minimum": -4, "maximum": 4},
                "dragon_diff": {"type": "integer", "minimum": -4, "maximum": 4},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_match_summary",
        "description": (
            "Return a concise coaching summary for a real locally checked-out Cloud9 VALORANT "
            "or Cloud9 Kia League of Legends series including map/game scores, key KPIs, "
            "Top Turning Points / Macro Swing Windows, and GRID telemetry audit counts."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["title", "series_id"],
            "properties": {
                "title": {"type": "string", "enum": ["val", "lol"]},
                "series_id": {"type": "string", "description": "Official GRID series ID (e.g. '2748746', '2754509')."},
                "map_index": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "Optional 0-based map/game index to focus on.",
                },
            },
            "additionalProperties": False,
        },
    },
]


KNOWN_TOOL_NAMES = frozenset(t["name"] for t in TOOL_DEFINITIONS)


class Strata9McpServer:
    """Stateless JSON-RPC 2.0 MCP handler delegating directly to Strata9Engine."""

    def __init__(self, engine: Strata9Engine) -> None:
        self.engine = engine

    def _summarize_match(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_title = args.get("title")
        if not isinstance(raw_title, str):
            raise ValueError("Parameter 'title' must be 'val' or 'lol'.")
        title = raw_title.strip().lower()
        raw_sid = args.get("series_id")
        if raw_sid is None or isinstance(raw_sid, bool) or not isinstance(raw_sid, (str, int)):
            raise ValueError("Parameter 'series_id' is required.")
        series_id = str(raw_sid).strip()
        if title not in ("val", "lol"):
            raise ValueError("Parameter 'title' must be 'val' or 'lol'.")
        if not series_id:
            raise ValueError("Parameter 'series_id' is required.")

        raw_idx = args.get("map_index")
        map_idx: Optional[int] = None
        if raw_idx is not None:
            if isinstance(raw_idx, bool) or not isinstance(raw_idx, int) or raw_idx < 0:
                raise ValueError("Parameter 'map_index' must be a non-negative integer.")
            map_idx = raw_idx

        if title == "val":
            s = self.engine.get_val_series(series_id)
            maps = s["maps"]
            if map_idx is not None and map_idx >= len(maps):
                raise ValueError(f"map_index={map_idx} out of range for series {series_id} ({len(maps)} maps).")
            selected_maps = [maps[map_idx]] if map_idx is not None else maps
            return {
                "title": "val",
                "series_id": s["series_id"],
                "matchup": f"{s['c9_team_name']} vs {s['opponent_name']}",
                "series_score": s["series_score"],
                "c9_won_series": s["c9_won_series"],
                "event": s["event"],
                "telemetry_audit": {
                    "envelopes_streamed": s["telemetry_audit"]["envelopes_streamed"],
                    "events_streamed": s["telemetry_audit"]["events_streamed"],
                    "rolled_back_games_dropped": s["telemetry_audit"]["rolled_back_games_dropped"],
                    "spatial_casts_joined": s["telemetry_audit"]["ability_supplement"]["joined_usable"],
                },
                "maps": [
                    {
                        "game_number": m["game_number"],
                        "map": m["map"],
                        "score": f"{m['c9_score']}-{m['opp_score']}",
                        "c9_won": m["c9_won"],
                        "summary": m["summary"],
                        "top_turning_points": [
                            {
                                "rank": tp["rank"],
                                "round_number": tp["round_number"],
                                "wp_swing": tp["wp_swing"],
                                "swing_tag": tp["swing_tag"],
                                "headline": tp["headline"],
                                "coaching_prescription": tp["coaching_prescription"],
                            }
                            for tp in m["top_turning_points"][:3]
                        ],
                    }
                    for m in selected_maps
                ],
            }

        s = self.engine.get_lol_series(series_id)
        games = s["games"]
        if map_idx is not None and map_idx >= len(games):
            raise ValueError(f"map_index={map_idx} out of range for series {series_id} ({len(games)} games).")
        selected_games = [games[map_idx]] if map_idx is not None else games
        return {
            "title": "lol",
            "series_id": s["series_id"],
            "matchup": f"{s['c9_team_name']} vs {s['opponent_name']}",
            "series_score": s["series_score"],
            "c9_won_series": s["c9_won_series"],
            "event": s["event"],
            "telemetry_audit": s["telemetry_audit"],
            "games": [
                {
                    "game_number": g["game_number"],
                    "duration": g["duration_label"],
                    "c9_side": g["c9_side"],
                    "c9_won": g["c9_won"],
                    "kills": f"{g['c9_kills']}-{g['opp_kills']}",
                    "gold_diff_15": g["gold_diff_15"],
                    "final_gold_diff": g["final_gold_diff"],
                    "objective_totals": g["objective_totals"],
                    "top_macro_swings": g["top_macro_swings"][:3],
                }
                for g in selected_games
            ],
        }

    def _execute_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if name == "get_corpus_scouting":
            raw_title = arguments.get("title")
            if raw_title is None:
                title = "all"
            elif isinstance(raw_title, str):
                title = raw_title
            else:
                raise ValueError("Parameter 'title' must be one of 'val', 'lol', 'all'.")
            return self.engine.get_corpus_scouting(title=title)
        if name == "simulate_tactical_what_if":
            return self.engine.simulate_what_if(arguments)
        if name == "get_match_summary":
            return self._summarize_match(arguments)
        raise KeyError(f"Unknown MCP tool: {name}")

    @staticmethod
    def _error_response(req_id: Any, code: int, message: str) -> Dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": code, "message": message},
        }

    def handle_request(self, message: Any) -> Optional[Dict[str, Any]]:
        """Process a single parsed JSON-RPC 2.0 request/notification."""
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return self._error_response(None, -32600, "Invalid Request: expected JSON-RPC 2.0 object.")

        method = message.get("method")
        req_id = message.get("id")
        is_notification = "id" not in message

        if not isinstance(method, str) or not method:
            return self._error_response(req_id, -32600, "Invalid Request: missing method string.")

        params = message.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            return None if is_notification else self._error_response(req_id, -32602, "Invalid params: expected JSON object.")

        if method == "notifications/initialized":
            return None

        if method == "ping":
            return None if is_notification else {"jsonrpc": "2.0", "id": req_id, "result": {}}

        if method == "initialize":
            result = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            }
            return None if is_notification else {"jsonrpc": "2.0", "id": req_id, "result": result}

        if method == "tools/list":
            return (
                None
                if is_notification
                else {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOL_DEFINITIONS}}
            )

        if method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments")
            if not isinstance(tool_name, str) or not tool_name:
                return (
                    None
                    if is_notification
                    else self._error_response(req_id, -32602, "Invalid params: 'name' string is required.")
                )
            if arguments is None:
                arguments = {}
            if not isinstance(arguments, dict):
                return (
                    None
                    if is_notification
                    else self._error_response(req_id, -32602, "Invalid params: 'arguments' must be an object.")
                )
            if tool_name not in KNOWN_TOOL_NAMES:
                return None if is_notification else self._error_response(req_id, -32602, f"Unknown MCP tool: {tool_name}")
            try:
                data = self._execute_tool(tool_name, arguments)
                tool_result = {
                    "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                    "structuredContent": data,
                    "isError": False,
                }
            except (ValueError, FileNotFoundError) as exc:
                tool_result = {
                    "content": [{"type": "text", "text": json.dumps({"error": str(exc)}, ensure_ascii=False)}],
                    "isError": True,
                }
            return None if is_notification else {"jsonrpc": "2.0", "id": req_id, "result": tool_result}

        if is_notification:
            return None
        return self._error_response(req_id, -32601, f"Method not found: {method}")

    @staticmethod
    def _write_message(stdout: TextIO, payload: Dict[str, Any], framed: bool) -> None:
        if framed:
            body = json.dumps(payload, ensure_ascii=True)
            stdout.write(f"Content-Length: {len(body.encode('utf-8'))}\r\n\r\n{body}")
        else:
            stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        stdout.flush()

    def serve_stdio(self, stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> None:
        """Serve JSON-RPC 2.0 messages over stdio (supports both NDJSON and Content-Length framing)."""
        while True:
            raw_line = stdin.readline()
            if not raw_line:
                break
            line = raw_line.strip()
            if not line:
                continue

            framed = False
            payload_text = line
            if line.lower().startswith("content-length:"):
                framed = True
                try:
                    content_length = int(line.split(":", 1)[1].strip())
                    if content_length < 0:
                        raise ValueError("negative Content-Length")
                except ValueError as exc:
                    self._write_message(stdout, self._error_response(None, -32700, f"Invalid header: {exc}"), True)
                    continue
                # Consume remaining header lines until blank separator line
                while True:
                    hdr = stdin.readline()
                    if not hdr or hdr.strip() == "":
                        break
                payload_text = stdin.read(content_length)
                if not payload_text:
                    break

            try:
                msg = json.loads(payload_text)
            except json.JSONDecodeError as exc:
                self._write_message(stdout, self._error_response(None, -32700, f"Parse error: {exc}"), framed)
                continue
            resp = self.handle_request(msg)
            if resp is not None:
                self._write_message(stdout, resp, framed)


def main() -> None:
    parser = argparse.ArgumentParser(description="Strata9 JSON-RPC 2.0 MCP Coach Server (stdio)")
    parser.add_argument("--data-dir", default=None, help="Override external STL_DATA_DIR path")
    args = parser.parse_args()

    engine = Strata9Engine(data_dir=args.data_dir)
    server = Strata9McpServer(engine)
    server.serve_stdio()


if __name__ == "__main__":
    main()
