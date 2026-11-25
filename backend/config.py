"""Configuration and GRID dataset discovery (strictly index-first, no data copies)."""

from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Dict, List, Tuple

C9_SQUADS: Dict[str, Dict[str, str]] = {
    "val": {
        "79": "Cloud9",
        "3429": "Cloud9 GC",
    },
    "lol": {
        "47351": "Cloud9 Kia",
    },
}

DEFAULT_C9_TEAM: Dict[str, str] = {
    "val": "79",
    "lol": "47351",
}


def resolve_data_dir(explicit: str | Path | None = None) -> Path:
    """Resolve STL_DATA_DIR without ever copying or committing licensed GRID files."""
    candidates: List[Path] = []
    if explicit is not None:
        candidates.append(Path(explicit))
    env_dir = os.environ.get("STL_DATA_DIR")
    if env_dir:
        candidates.append(Path(env_dir))

    project_root = Path(__file__).resolve().parent.parent
    candidates.extend(
        [
            project_root.parent / "stl-hackathon-2026-grid-starter",
            Path("/Volumes/Extra/datasets/cloud9-grid-starter"),
        ]
    )

    for candidate in candidates:
        resolved = candidate.expanduser()
        if (resolved / "meta" / "games.csv").is_file():
            return resolved

    searched = ", ".join(str(c) for c in candidates)
    raise FileNotFoundError(
        f"GRID starter dataset not found. Set STL_DATA_DIR to your local clone of "
        f"stl-hackathon-2026-grid-starter. Checked: {searched}"
    )


def discover_local_feeds(data_dir: Path) -> Tuple[Dict[str, Path], Dict[str, Path], Dict[str, Path]]:
    """Use series.csv (index-first) to check which .jsonl.zst feeds exist locally on disk."""
    val_feeds: Dict[str, Path] = {}
    val_supplements: Dict[str, Path] = {}
    lol_feeds: Dict[str, Path] = {}

    val_csv = data_dir / "val" / "series.csv"
    if val_csv.is_file():
        with val_csv.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                sid = row["series_id"].strip()
                rel = row.get("file", "").strip()
                if rel:
                    p = data_dir / rel
                    if p.is_file():
                        val_feeds[sid] = p
                sup_rel = row.get("ability_supplement", "").strip()
                if sup_rel:
                    sp = data_dir / sup_rel
                    if sp.is_file():
                        val_supplements[sid] = sp

    lol_csv = data_dir / "lol" / "series.csv"
    if lol_csv.is_file():
        with lol_csv.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                sid = row["series_id"].strip()
                rel = row.get("file", "").strip()
                if rel:
                    p = data_dir / rel
                    if p.is_file():
                        lol_feeds[sid] = p

    return val_feeds, val_supplements, lol_feeds
