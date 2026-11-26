"""Zero-dependency Python stdlib REST API server for Strata9 with in-memory LRU caching."""

from __future__ import annotations

import argparse
import json
import mimetypes
from functools import lru_cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from .ai_coach import ask_coach_question, coach_status, generate_coach_brief
from .config import DEFAULT_C9_TEAM, resolve_data_dir
from .corpus_scouting import CorpusScoutingEngine
from .lol_telemetry import parse_lol_series
from .meta_index import MetaIndex
from .val_telemetry import parse_val_series


class Strata9Engine:
    """Facade combining MetaIndex + streaming VAL/LoL parsers with in-memory LRU cache."""

    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = resolve_data_dir(data_dir)
        self.meta = MetaIndex(self.data_dir)
        self._val_cache = lru_cache(maxsize=16)(self._compute_val_series)
        self._lol_cache = lru_cache(maxsize=16)(self._compute_lol_series)
        self.corpus = CorpusScoutingEngine(self)

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "service": "strata9-coach",
            "data_dir_resolved": True,
            "license_mode": "read_only_streaming_external_stl_data_dir",
            "local_val_series": sorted(self.meta.val_feeds.keys()),
            "local_lol_series": sorted(self.meta.lol_feeds.keys()),
            "valid_games": len(self.meta.valid_games),
            "invalid_games_excluded": sum(self.meta.invalid_games_count.values()),
        }

    def overview(self) -> Dict[str, Any]:
        return self.meta.get_overview()

    def _compute_val_series(self, series_id: str, c9_team_id: str) -> Dict[str, Any]:
        feed = self.meta.val_feeds.get(series_id)
        if not feed:
            raise FileNotFoundError(f"VALORANT feed for series {series_id} is not checked out locally.")
        sup = self.meta.val_supplements.get(series_id)
        smeta = self.meta.series_by_key.get(("val", series_id))
        return parse_val_series(feed, sup, c9_team_id=c9_team_id, series_meta=smeta)

    def get_val_series(self, series_id: str, c9_team_id: str = "79") -> Dict[str, Any]:
        return self._val_cache(series_id, c9_team_id)

    def _compute_lol_series(self, series_id: str, c9_team_id: str) -> Dict[str, Any]:
        feed = self.meta.lol_feeds.get(series_id)
        if not feed:
            raise FileNotFoundError(f"League of Legends feed for series {series_id} is not checked out locally.")
        smeta = self.meta.series_by_key.get(("lol", series_id))
        return parse_lol_series(feed, c9_team_id=c9_team_id, series_meta=smeta)

    def get_lol_series(self, series_id: str, c9_team_id: str = "47351") -> Dict[str, Any]:
        return self._lol_cache(series_id, c9_team_id)

    def get_opponents(self, title: str, team_id: Optional[str] = None) -> Dict[str, Any]:
        tid = team_id or DEFAULT_C9_TEAM.get(title, "79")
        return {
            "title": title,
            "team_id": tid,
            "opponents": self.meta.get_opponents(title, tid),
        }

    def get_dossier(self, title: str, team_id: Optional[str], opponent_id: str) -> Dict[str, Any]:
        tid = team_id or DEFAULT_C9_TEAM.get(title, "79")
        return self.meta.build_scouting_dossier(title, tid, opponent_id)

    def get_coach_status(self) -> Dict[str, Any]:
        return coach_status()

    def coach_brief(
        self,
        title: str,
        series_id: str,
        map_index: int = 0,
        round_number: Optional[int] = None,
    ) -> Dict[str, Any]:
        series = self.get_val_series(series_id) if title == "val" else self.get_lol_series(series_id)
        return generate_coach_brief(title, series, map_index=map_index, round_number=round_number)

    def coach_ask(
        self,
        title: str,
        series_id: str,
        question: str,
        map_index: int = 0,
        round_number: Optional[int] = None,
    ) -> Dict[str, Any]:
        series = self.get_val_series(series_id) if title == "val" else self.get_lol_series(series_id)
        return ask_coach_question(title, series, question=question, map_index=map_index, round_number=round_number)

    def get_corpus_scouting(self, title: str = "all") -> Dict[str, Any]:
        return self.corpus.get_corpus_report(title=title)

    def simulate_what_if(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.corpus.simulate_what_if(payload)


def create_server(
    engine: Strata9Engine,
    host: str = "127.0.0.1",
    port: int = 8799,
    static_dir: Optional[Path] = None,
) -> ThreadingHTTPServer:
    """Create a ThreadingHTTPServer bound to Strata9Engine."""

    class ReusableThreadingHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return  # Keep terminal output quiet and deterministic

        def _send_bytes(self, status: int, content_type: str, payload: bytes, extra_headers: Optional[Dict[str, str]] = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(payload)

        def _send_json(self, status: int, obj: Any) -> None:
            raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self._send_bytes(status, "application/json; charset=utf-8", raw)

        def do_OPTIONS(self) -> None:
            self._send_bytes(HTTPStatus.NO_CONTENT, "text/plain", b"")

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            qs = parse_qs(parsed.query)

            def q1(key: str, default: Optional[str] = None) -> Optional[str]:
                vals = qs.get(key)
                return vals[0] if vals else default

            try:
                if path == "/api/health":
                    return self._send_json(HTTPStatus.OK, engine.health())

                if path == "/api/coach/status":
                    return self._send_json(HTTPStatus.OK, engine.get_coach_status())

                if path == "/api/overview":
                    return self._send_json(HTTPStatus.OK, engine.overview())

                if path == "/api/series":
                    title = q1("title", "val")
                    catalog = engine.meta.get_local_series_catalog()
                    if title in ("val", "lol"):
                        return self._send_json(HTTPStatus.OK, {"title": title, "series": catalog[title]})
                    return self._send_json(HTTPStatus.OK, catalog)

                if path.startswith("/api/val/series/"):
                    sid = path.split("/")[-1]
                    c9_id = q1("team_id", "79") or "79"
                    return self._send_json(HTTPStatus.OK, engine.get_val_series(sid, c9_id))

                if path.startswith("/api/lol/series/"):
                    sid = path.split("/")[-1]
                    c9_id = q1("team_id", "47351") or "47351"
                    return self._send_json(HTTPStatus.OK, engine.get_lol_series(sid, c9_id))

                if path == "/api/scouting/corpus":
                    title = q1("title", "all") or "all"
                    return self._send_json(HTTPStatus.OK, engine.get_corpus_scouting(title))

                if path == "/api/scouting/opponents":
                    title = q1("title", "val") or "val"
                    team_id = q1("team_id")
                    return self._send_json(HTTPStatus.OK, engine.get_opponents(title, team_id))

                if path == "/api/scouting/dossier":
                    title = q1("title", "val") or "val"
                    team_id = q1("team_id")
                    opp_id = q1("opponent_id")
                    if not opp_id:
                        return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "opponent_id query parameter is required"})
                    dossier = engine.get_dossier(title, team_id, opp_id)
                    fmt = (q1("format", "json") or "json").lower()
                    if fmt in ("md", "markdown"):
                        fname = f"strata9_dossier_{title}_{opp_id}.md"
                        return self._send_bytes(
                            HTTPStatus.OK,
                            "text/markdown; charset=utf-8",
                            dossier["markdown"].encode("utf-8"),
                            extra_headers={"Content-Disposition": f'attachment; filename="{fname}"'},
                        )
                    return self._send_json(HTTPStatus.OK, dossier)

                # Serve built frontend assets when static_dir is configured
                if static_dir and static_dir.is_dir():
                    rel = path.lstrip("/") or "index.html"
                    target = (static_dir / rel).resolve()
                    if str(target).startswith(str(static_dir.resolve())) and target.is_file():
                        ctype, _ = mimetypes.guess_type(str(target))
                        return self._send_bytes(HTTPStatus.OK, ctype or "application/octet-stream", target.read_bytes())
                    index_html = static_dir / "index.html"
                    if not path.startswith("/api/") and index_html.is_file():
                        return self._send_bytes(HTTPStatus.OK, "text/html; charset=utf-8", index_html.read_bytes())

                return self._send_json(HTTPStatus.NOT_FOUND, {"error": f"Route not found: {path}"})
            except ValueError as exc:
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except FileNotFoundError as exc:
                return self._send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except KeyError as exc:
                return self._send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except Exception as exc:  # pragma: no cover - defensive runtime boundary
                return self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            try:
                length = int(self.headers.get("Content-Length") or "0")
                raw_body = self.rfile.read(min(length, 262144)) if length > 0 else b"{}"
                payload = json.loads(raw_body.decode("utf-8") or "{}")
                if not isinstance(payload, dict):
                    return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON object payload required"})

                if path == "/api/tactical/what-if":
                    res = engine.simulate_what_if(payload)
                    return self._send_json(HTTPStatus.OK, res)

                if path == "/api/coach/brief":
                    title = str(payload.get("title") or "val").lower()
                    series_id = str(payload.get("series_id") or "")
                    if not series_id:
                        return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "series_id is required"})
                    map_index = int(payload.get("map_index") or 0)
                    round_number = payload.get("round_number")
                    rn = int(round_number) if round_number is not None else None
                    res = engine.coach_brief(title, series_id, map_index=map_index, round_number=rn)
                    return self._send_json(HTTPStatus.OK, res)

                if path == "/api/coach/ask":
                    title = str(payload.get("title") or "val").lower()
                    series_id = str(payload.get("series_id") or "")
                    question = str(payload.get("question") or "").strip()
                    if not series_id or not question:
                        return self._send_json(
                            HTTPStatus.BAD_REQUEST,
                            {"error": "Both series_id and question are required"},
                        )
                    map_index = int(payload.get("map_index") or 0)
                    round_number = payload.get("round_number")
                    rn = int(round_number) if round_number is not None else None
                    res = engine.coach_ask(title, series_id, question=question, map_index=map_index, round_number=rn)
                    return self._send_json(HTTPStatus.OK, res)

                return self._send_json(HTTPStatus.NOT_FOUND, {"error": f"Route not found: {path}"})
            except ValueError as exc:
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except FileNotFoundError as exc:
                return self._send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except json.JSONDecodeError:
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON request body"})
            except Exception as exc:  # pragma: no cover - defensive runtime boundary
                return self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    return ReusableThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Strata9 Cloud9 Multi-Title Tactical Intelligence API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--data-dir", default=None, help="Override STL_DATA_DIR path")
    parser.add_argument("--static-dir", default=None, help="Optional built frontend dist directory")
    args = parser.parse_args()

    engine = Strata9Engine(data_dir=args.data_dir)
    static_path = Path(args.static_dir) if args.static_dir else None
    srv = create_server(engine, host=args.host, port=args.port, static_dir=static_path)
    print(f"[Strata9] Listening on http://{args.host}:{args.port} | STL_DATA_DIR={engine.data_dir}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
