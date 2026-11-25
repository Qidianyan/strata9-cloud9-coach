"""Global Metadata Scouting Index & Automated Pre-Match Dossier Engine.

Reads all 6 official meta/*.csv tables + val/series.csv + lol/series.csv strictly from
STL_DATA_DIR, enforcing session_valid == True on every competitive statistic.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import C9_SQUADS, discover_local_feeds


def _is_true(value: str | None) -> bool:
    return (value or "").strip().lower() == "true"


class MetaIndex:
    """In-memory index over the official GRID metadata CSV tables."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.val_feeds, self.val_supplements, self.lol_feeds = discover_local_feeds(data_dir)

        self.tournaments: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "tournaments.csv")
        self.teams_rows: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "teams.csv")
        self.players_rows: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "players.csv")
        self.characters_rows: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "characters.csv")
        self.games_rows: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "games.csv")
        self.rosters_rows: List[Dict[str, str]] = self._read_csv(data_dir / "meta" / "rosters.csv")

        self.series_by_key: Dict[Tuple[str, str], Dict[str, str]] = {}
        for title in ("val", "lol"):
            for row in self._read_csv(data_dir / title / "series.csv"):
                row["title"] = title
                self.series_by_key[(title, row["series_id"])] = row

        self.teams_by_key: Dict[Tuple[str, str], Dict[str, str]] = {
            (r["title"], r["team_id"]): r for r in self.teams_rows
        }
        self.players_by_key: Dict[Tuple[str, str], Dict[str, str]] = {
            (r["title"], r["player_id"]): r for r in self.players_rows
        }
        self.characters_by_key: Dict[Tuple[str, str], Dict[str, str]] = {
            (r["title"], r["character_id"]): r for r in self.characters_rows
        }

        # Separate valid vs invalid games strictly using GRID's session_valid flag
        self.valid_games: List[Dict[str, str]] = []
        self.invalid_games_count: Dict[str, int] = {"val": 0, "lol": 0}
        self.valid_games_by_title: Dict[str, List[Dict[str, str]]] = {"val": [], "lol": []}
        self.valid_games_by_team: Dict[Tuple[str, str], List[Dict[str, str]]] = defaultdict(list)
        self.valid_games_by_series: Dict[Tuple[str, str], List[Dict[str, str]]] = defaultdict(list)
        self.valid_game_ids: set[Tuple[str, str, str, str]] = set()

        for g in self.games_rows:
            title = g["title"]
            if _is_true(g.get("session_valid")) and _is_true(g.get("finished")):
                self.valid_games.append(g)
                self.valid_games_by_title[title].append(g)
                self.valid_games_by_series[(title, g["series_id"])].append(g)
                self.valid_games_by_team[(title, g["team1_id"])].append(g)
                self.valid_games_by_team[(title, g["team2_id"])].append(g)
                self.valid_game_ids.add((title, g["series_id"], g["game_id"], g.get("session", "1")))
            else:
                self.invalid_games_count[title] = self.invalid_games_count.get(title, 0) + 1

        # Index rosters strictly for session_valid finished games
        self.rosters_by_game: Dict[Tuple[str, str, str], List[Dict[str, str]]] = defaultdict(list)
        self.rosters_by_team: Dict[Tuple[str, str], List[Dict[str, str]]] = defaultdict(list)
        for r in self.rosters_rows:
            key4 = (r["title"], r["series_id"], r["game_id"], r.get("session", "1"))
            if key4 not in self.valid_game_ids:
                continue
            self.rosters_by_game[(r["title"], r["series_id"], r["game_id"])].append(r)
            self.rosters_by_team[(r["title"], r["team_id"])].append(r)

        # Map game_id -> winner_team_id for quick character winrate calculations
        self.game_winner_map: Dict[Tuple[str, str, str], str] = {
            (g["title"], g["series_id"], g["game_id"]): g["winner_team_id"]
            for g in self.valid_games
        }
        self.game_by_uid: Dict[Tuple[str, str, str], Dict[str, str]] = {
            (g["title"], g["series_id"], g["game_id"]): g
            for g in self.valid_games
        }

    @staticmethod
    def _read_csv(path: Path) -> List[Dict[str, str]]:
        if not path.is_file():
            return []
        with path.open(newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    def has_local_feed(self, title: str, series_id: str) -> bool:
        if title == "val":
            return series_id in self.val_feeds
        if title == "lol":
            return series_id in self.lol_feeds
        return False

    def get_local_series_catalog(self) -> Dict[str, List[Dict[str, Any]]]:
        """Return detailed cards for every locally available Cloud9 telemetry feed."""
        result: Dict[str, List[Dict[str, Any]]] = {"val": [], "lol": []}
        for title, feed_map in (("val", self.val_feeds), ("lol", self.lol_feeds)):
            items: List[Dict[str, Any]] = []
            for sid in sorted(feed_map.keys()):
                sm = self.series_by_key.get((title, sid), {})
                games = sorted(
                    self.valid_games_by_series.get((title, sid), []),
                    key=lambda x: int(x.get("game_number") or 0),
                )
                c9_id = "79" if title == "val" else "47351"
                c9_wins = sum(1 for g in games if g["winner_team_id"] == c9_id)
                opp_wins = len(games) - c9_wins
                opponent_name = ""
                opponent_id = ""
                for g in games:
                    if g["team1_id"] == c9_id:
                        opponent_id, opponent_name = g["team2_id"], g["team2_name"]
                        break
                    if g["team2_id"] == c9_id:
                        opponent_id, opponent_name = g["team1_id"], g["team1_name"]
                        break
                items.append(
                    {
                        "series_id": sid,
                        "title": title,
                        "event": sm.get("event", ""),
                        "stage": sm.get("stage", ""),
                        "scheduled_start": sm.get("scheduled_start", ""),
                        "teams": sm.get("teams", ""),
                        "c9_team_id": c9_id,
                        "c9_team_name": C9_SQUADS[title].get(c9_id, "Cloud9"),
                        "opponent_id": opponent_id,
                        "opponent_name": opponent_name,
                        "series_score": f"{c9_wins}-{opp_wins}",
                        "c9_won_series": c9_wins > opp_wins,
                        "maps": [g["map"] for g in games],
                        "game_scores": [
                            {
                                "game_number": int(g["game_number"]),
                                "map": g["map"],
                                "c9_score": int(g["team1_score"]) if g["team1_id"] == c9_id else int(g["team2_score"]),
                                "opp_score": int(g["team2_score"]) if g["team1_id"] == c9_id else int(g["team1_score"]),
                                "c9_won": g["winner_team_id"] == c9_id,
                            }
                            for g in games
                        ],
                        "has_ability_supplement": sid in self.val_supplements if title == "val" else False,
                    }
                )
            items.sort(key=lambda x: x["scheduled_start"])
            result[title] = items
        return result

    def get_team_summary(self, title: str, team_id: str) -> Dict[str, Any]:
        team = self.teams_by_key.get((title, team_id))
        if not team:
            raise KeyError(f"Unknown team ({title}, {team_id})")

        games = self.valid_games_by_team.get((title, team_id), [])
        wins = sum(1 for g in games if g["winner_team_id"] == team_id)
        losses = len(games) - wins

        # Series win/loss from valid games
        series_map: Dict[str, List[Dict[str, str]]] = defaultdict(list)
        for g in games:
            series_map[g["series_id"]].append(g)
        series_wins = 0
        series_losses = 0
        for sid, sgames in series_map.items():
            w = sum(1 for g in sgames if g["winner_team_id"] == team_id)
            if w > len(sgames) - w:
                series_wins += 1
            elif w < len(sgames) - w:
                series_losses += 1

        # Map breakdown (VAL) or Side breakdown (LoL)
        map_stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "wins": 0})
        side_stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "wins": 0})
        patch_stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "wins": 0})

        for g in games:
            won = g["winner_team_id"] == team_id
            m = g["map"]
            map_stats[m]["played"] += 1
            if won:
                map_stats[m]["wins"] += 1

            side = g["team1_side"] if g["team1_id"] == team_id else g["team2_side"]
            if side:
                side_stats[side]["played"] += 1
                if won:
                    side_stats[side]["wins"] += 1

            patch = g.get("patch") or "unknown"
            patch_stats[patch]["played"] += 1
            if won:
                patch_stats[patch]["wins"] += 1

        # Character usage & winrate for this team
        char_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "wins": 0})
        for r in self.rosters_by_team.get((title, team_id), []):
            cname = r["character_name"]
            if not cname:
                continue
            char_counts[cname]["played"] += 1
            if self.game_winner_map.get((title, r["series_id"], r["game_id"])) == team_id:
                char_counts[cname]["wins"] += 1

        top_maps = [
            {
                "map": m,
                "played": d["played"],
                "wins": d["wins"],
                "losses": d["played"] - d["wins"],
                "winrate": round(d["wins"] / d["played"] * 100, 1) if d["played"] else 0.0,
            }
            for m, d in sorted(map_stats.items(), key=lambda kv: (-kv[1]["played"], kv[0]))
        ]
        top_characters = [
            {
                "character": c,
                "played": d["played"],
                "wins": d["wins"],
                "winrate": round(d["wins"] / d["played"] * 100, 1) if d["played"] else 0.0,
            }
            for c, d in sorted(char_counts.items(), key=lambda kv: (-kv[1]["played"], -kv[1]["wins"]))[:12]
        ]
        patch_trends = [
            {
                "patch": p,
                "played": d["played"],
                "wins": d["wins"],
                "winrate": round(d["wins"] / d["played"] * 100, 1) if d["played"] else 0.0,
            }
            for p, d in sorted(
                patch_stats.items(),
                key=lambda kv: [int(x) if x.isdigit() else 999 for x in kv[0].split(".")],
            )
        ]

        return {
            "title": title,
            "team_id": team_id,
            "name": team["name"],
            "other_names": [n.strip() for n in (team.get("other_names") or "").split(";") if n.strip()],
            "events": [e.strip() for e in (team.get("events") or "").split(";") if e.strip()],
            "series_played": len(series_map),
            "series_wins": series_wins,
            "series_losses": series_losses,
            "games_played": len(games),
            "game_wins": wins,
            "game_losses": losses,
            "game_winrate": round(wins / len(games) * 100, 1) if games else 0.0,
            "side_splits": {
                s: {
                    "played": d["played"],
                    "wins": d["wins"],
                    "winrate": round(d["wins"] / d["played"] * 100, 1) if d["played"] else 0.0,
                }
                for s, d in side_stats.items()
            },
            "map_pool": top_maps,
            "top_characters": top_characters,
            "patch_trends": patch_trends,
        }

    def get_meta_character_leaderboard(self, title: str, limit: int = 15) -> List[Dict[str, Any]]:
        stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "wins": 0})
        total_games = len(self.valid_games_by_title.get(title, []))
        for r in self.rosters_rows:
            if r["title"] != title:
                continue
            key4 = (title, r["series_id"], r["game_id"], r.get("session", "1"))
            if key4 not in self.valid_game_ids:
                continue
            cname = r["character_name"]
            if not cname:
                continue
            stats[cname]["played"] += 1
            if self.game_winner_map.get((title, r["series_id"], r["game_id"])) == r["team_id"]:
                stats[cname]["wins"] += 1

        rows = []
        for cname, d in sorted(stats.items(), key=lambda kv: (-kv[1]["played"], -kv[1]["wins"]))[:limit]:
            # Each map has 2 teams; pick presence % = played / (total_games * 2) * 100 or per game
            pick_rate = round(d["played"] / max(1, total_games) * 100, 1)
            rows.append(
                {
                    "character": cname,
                    "played": d["played"],
                    "wins": d["wins"],
                    "winrate": round(d["wins"] / d["played"] * 100, 1) if d["played"] else 0.0,
                    "pick_rate": pick_rate,
                }
            )
        return rows

    def get_overview(self) -> Dict[str, Any]:
        val_valid = len(self.valid_games_by_title["val"])
        lol_valid = len(self.valid_games_by_title["lol"])
        total_rows = (
            len(self.tournaments)
            + len(self.teams_rows)
            + len(self.players_rows)
            + len(self.characters_rows)
            + len(self.games_rows)
            + len(self.rosters_rows)
        )
        return {
            "corpus_stats": {
                "total_meta_rows": total_rows,
                "teams": len(self.teams_rows),
                "players": len(self.players_rows),
                "characters": len(self.characters_rows),
                "tournaments": len(self.tournaments),
                "total_games": len(self.games_rows),
                "valid_games": len(self.valid_games),
                "invalid_games_excluded": sum(self.invalid_games_count.values()),
                "val_valid_games": val_valid,
                "val_invalid_excluded": self.invalid_games_count["val"],
                "lol_valid_games": lol_valid,
                "lol_invalid_excluded": self.invalid_games_count["lol"],
                "local_val_feeds": len(self.val_feeds),
                "local_val_supplements": len(self.val_supplements),
                "local_lol_feeds": len(self.lol_feeds),
            },
            "cloud9_squads": [
                self.get_team_summary("val", "79"),
                self.get_team_summary("val", "3429"),
                self.get_team_summary("lol", "47351"),
            ],
            "local_series": self.get_local_series_catalog(),
            "meta_leaders": {
                "val": self.get_meta_character_leaderboard("val", limit=12),
                "lol": self.get_meta_character_leaderboard("lol", limit=12),
            },
        }

    def get_opponents(self, title: str, team_id: str) -> List[Dict[str, Any]]:
        """List all opponents faced by team_id in session_valid games, ranked by H2H sample size."""
        h2h: Dict[str, Dict[str, Any]] = {}
        for g in self.valid_games_by_team.get((title, team_id), []):
            opp_id = g["team2_id"] if g["team1_id"] == team_id else g["team1_id"]
            opp_meta = self.teams_by_key.get((title, opp_id))
            opp_name = opp_meta["name"] if opp_meta else (
                g["team2_name"] if g["team1_id"] == team_id else g["team1_name"]
            )
            entry = h2h.setdefault(
                opp_id,
                {
                    "opponent_id": opp_id,
                    "opponent_name": opp_name,
                    "h2h_games": 0,
                    "c9_game_wins": 0,
                    "series_ids": set(),
                    "has_local_feed": False,
                },
            )
            entry["h2h_games"] += 1
            if g["winner_team_id"] == team_id:
                entry["c9_game_wins"] += 1
            entry["series_ids"].add(g["series_id"])
            if self.has_local_feed(title, g["series_id"]):
                entry["has_local_feed"] = True

        out = []
        for opp_id, d in h2h.items():
            opp_games = self.valid_games_by_team.get((title, opp_id), [])
            opp_wins = sum(1 for g in opp_games if g["winner_team_id"] == opp_id)
            out.append(
                {
                    "opponent_id": opp_id,
                    "opponent_name": d["opponent_name"],
                    "h2h_series": len(d["series_ids"]),
                    "h2h_games": d["h2h_games"],
                    "c9_game_wins": d["c9_game_wins"],
                    "opp_game_wins": d["h2h_games"] - d["c9_game_wins"],
                    "c9_h2h_winrate": round(d["c9_game_wins"] / d["h2h_games"] * 100, 1),
                    "opp_overall_games": len(opp_games),
                    "opp_overall_winrate": round(opp_wins / len(opp_games) * 100, 1) if opp_games else 0.0,
                    "has_local_feed": d["has_local_feed"],
                }
            )
        out.sort(key=lambda x: (-int(x["has_local_feed"]), -x["h2h_games"], -x["opp_overall_games"]))
        return out

    def build_scouting_dossier(self, title: str, team_id: str, opponent_id: str) -> Dict[str, Any]:
        """Generate a live-verified Pre-Match Opponent Scouting Dossier + Markdown export."""
        c9 = self.get_team_summary(title, team_id)
        opp = self.get_team_summary(title, opponent_id)

        # Head-to-head games
        h2h_games = [
            g
            for g in self.valid_games_by_team.get((title, team_id), [])
            if (g["team1_id"] == opponent_id or g["team2_id"] == opponent_id)
        ]
        h2h_games.sort(key=lambda g: (g.get("started_at", ""), int(g.get("game_number") or 0)))

        h2h_c9_wins = sum(1 for g in h2h_games if g["winner_team_id"] == team_id)
        h2h_opp_wins = len(h2h_games) - h2h_c9_wins

        # H2H series history
        h2h_series_groups: Dict[str, List[Dict[str, str]]] = defaultdict(list)
        for g in h2h_games:
            h2h_series_groups[g["series_id"]].append(g)

        recent_h2h_series: List[Dict[str, Any]] = []
        for sid, sgames in h2h_series_groups.items():
            sm = self.series_by_key.get((title, sid), {})
            cw = sum(1 for g in sgames if g["winner_team_id"] == team_id)
            ow = len(sgames) - cw
            recent_h2h_series.append(
                {
                    "series_id": sid,
                    "event": sm.get("event", ""),
                    "stage": sm.get("stage", ""),
                    "date": (sm.get("scheduled_start") or (sgames[0].get("started_at") if sgames else ""))[:10],
                    "score": f"{cw}-{ow}",
                    "c9_won": cw > ow,
                    "has_local_feed": self.has_local_feed(title, sid),
                    "maps": [
                        {
                            "map": g["map"],
                            "c9_score": int(g["team1_score"]) if g["team1_id"] == team_id else int(g["team2_score"]),
                            "opp_score": int(g["team2_score"]) if g["team1_id"] == team_id else int(g["team1_score"]),
                            "c9_won": g["winner_team_id"] == team_id,
                        }
                        for g in sorted(sgames, key=lambda x: int(x.get("game_number") or 0))
                    ],
                }
            )
        recent_h2h_series.sort(key=lambda x: x["date"], reverse=True)

        # Map veto matrix (VALORANT) or Side priority matrix (LoL)
        c9_map_lookup = {m["map"]: m for m in c9["map_pool"]}
        opp_map_lookup = {m["map"]: m for m in opp["map_pool"]}
        h2h_by_map: Dict[str, Dict[str, int]] = defaultdict(lambda: {"played": 0, "c9_wins": 0})
        for g in h2h_games:
            h2h_by_map[g["map"]]["played"] += 1
            if g["winner_team_id"] == team_id:
                h2h_by_map[g["map"]]["c9_wins"] += 1

        veto_matrix: List[Dict[str, Any]] = []
        if title == "val":
            all_maps = sorted(set(c9_map_lookup.keys()) | set(opp_map_lookup.keys()))
            for mp in all_maps:
                cm = c9_map_lookup.get(mp, {"played": 0, "wins": 0, "winrate": 0.0})
                om = opp_map_lookup.get(mp, {"played": 0, "wins": 0, "winrate": 0.0})
                hm = h2h_by_map.get(mp, {"played": 0, "c9_wins": 0})
                delta = round(cm["winrate"] - om["winrate"], 1)
                if om["played"] >= 3 and om["winrate"] >= 60.0 and delta <= -10.0:
                    rec = "PRIORITY BAN"
                elif cm["played"] >= 3 and cm["winrate"] >= 55.0 and delta >= 8.0:
                    rec = "PRIORITY PICK"
                elif om["played"] <= 1 and cm["played"] >= 3 and cm["winrate"] >= 50.0:
                    rec = "PUNISH PICK"
                elif cm["played"] == 0 and om["played"] >= 3 and om["winrate"] >= 45.0:
                    rec = "PERMABAN / AVOID"
                else:
                    rec = "CONTEST / DECIDER"
                veto_matrix.append(
                    {
                        "map": mp,
                        "c9_played": cm["played"],
                        "c9_winrate": cm["winrate"],
                        "opp_played": om["played"],
                        "opp_winrate": om["winrate"],
                        "h2h_record": f"{hm['c9_wins']}-{hm['played'] - hm['c9_wins']}" if hm["played"] else "0-0",
                        "edge_delta": delta,
                        "recommendation": rec,
                    }
                )
            veto_matrix.sort(key=lambda x: -x["edge_delta"])
        else:
            for side in ("blue", "red"):
                cs = c9["side_splits"].get(side, {"played": 0, "wins": 0, "winrate": 0.0})
                os_ = opp["side_splits"].get(side, {"played": 0, "wins": 0, "winrate": 0.0})
                delta = round(cs["winrate"] - os_["winrate"], 1)
                veto_matrix.append(
                    {
                        "map": f"Summoner's Rift ({side.title()} Side)",
                        "c9_played": cs["played"],
                        "c9_winrate": cs["winrate"],
                        "opp_played": os_["played"],
                        "opp_winrate": os_["winrate"],
                        "h2h_record": f"{h2h_c9_wins}-{h2h_opp_wins}",
                        "edge_delta": delta,
                        "recommendation": "SIDE PREFERENCE" if delta >= 0 else "COUNTER-PREP",
                    }
                )

        # Opponent recent active roster + signature picks (from most recent 8 games)
        opp_recent_games = sorted(
            self.valid_games_by_team.get((title, opponent_id), []),
            key=lambda g: (g.get("started_at", ""), int(g.get("game_number") or 0)),
            reverse=True,
        )
        recent_game_uids = {(title, g["series_id"], g["game_id"]) for g in opp_recent_games[:10]}
        player_picks: Dict[str, Dict[str, Any]] = {}
        for r in self.rosters_by_team.get((title, opponent_id), []):
            uid = (title, r["series_id"], r["game_id"])
            if uid not in recent_game_uids:
                continue
            pid = r["player_id"]
            entry = player_picks.setdefault(
                pid,
                {
                    "player_id": pid,
                    "player_name": r["player_name"],
                    "games": 0,
                    "wins": 0,
                    "chars": Counter(),
                    "char_wins": Counter(),
                },
            )
            entry["games"] += 1
            won = self.game_winner_map.get(uid) == opponent_id
            if won:
                entry["wins"] += 1
            if r["character_name"]:
                entry["chars"][r["character_name"]] += 1
                if won:
                    entry["char_wins"][r["character_name"]] += 1

        opponent_roster = []
        for d in sorted(player_picks.values(), key=lambda x: -x["games"])[:6]:
            top_c = [
                {
                    "character": c,
                    "games": cnt,
                    "wins": d["char_wins"][c],
                    "winrate": round(d["char_wins"][c] / cnt * 100, 1),
                }
                for c, cnt in d["chars"].most_common(3)
            ]
            opponent_roster.append(
                {
                    "player_id": d["player_id"],
                    "player_name": d["player_name"],
                    "recent_games": d["games"],
                    "recent_winrate": round(d["wins"] / d["games"] * 100, 1) if d["games"] else 0.0,
                    "signature_picks": top_c,
                }
            )

        # Coaching strategic bullets grounded purely in real statistics
        tactical_brief: List[str] = []
        if title == "val":
            bans = sorted(
                [m for m in veto_matrix if m["recommendation"] in ("PRIORITY BAN", "PERMABAN / AVOID")],
                key=lambda m: (-m["opp_winrate"], m["edge_delta"]),
            )
            if not bans:
                # Fallback to opponent's strongest map with >=2 games and >=50% WR
                bans = sorted(
                    [m for m in veto_matrix if m["opp_played"] >= 2 and m["opp_winrate"] >= 50.0],
                    key=lambda m: (-m["opp_winrate"], m["edge_delta"]),
                )
            picks = [m for m in veto_matrix if m["recommendation"] in ("PRIORITY PICK", "PUNISH PICK")]
            if bans:
                b = bans[0]
                tactical_brief.append(
                    f"First-rotation Ban Target: {b['map'].title()} — {opp['name']} holds a {b['opp_winrate']}% winrate "
                    f"across {b['opp_played']} valid maps vs {c9['name']}'s {b['c9_winrate']}% ({b['c9_played']} maps)."
                )
            if picks:
                p = picks[0]
                tactical_brief.append(
                    f"Highest-Edge Map Pick: {p['map'].title()} — {c9['name']} leads by +{p['edge_delta']}pp "
                    f"({p['c9_winrate']}% across {p['c9_played']} maps vs {opp['name']}'s {p['opp_winrate']}%)."
                )
        else:
            blue_row = veto_matrix[0]
            red_row = veto_matrix[1]
            best_side = blue_row if blue_row["c9_winrate"] >= red_row["c9_winrate"] else red_row
            tactical_brief.append(
                f"Side Selection Edge: {c9['name']} posts {best_side['c9_winrate']}% on {best_side['map']} "
                f"({best_side['c9_played']} valid games) vs {opp['name']}'s {best_side['opp_winrate']}%."
            )

        if opp["top_characters"]:
            tc = opp["top_characters"][0]
            tc2 = opp["top_characters"][1] if len(opp["top_characters"]) > 1 else None
            c1 = tc["character"].title() if title == "val" else tc["character"]
            c2 = (tc2["character"].title() if title == "val" else tc2["character"]) if tc2 else ""
            extra = f" and {c2} ({tc2['played']}G, {tc2['winrate']}% WR)" if tc2 else ""
            tactical_brief.append(
                f"Opponent Draft Identity: {opp['name']} anchors compositions around {c1} "
                f"({tc['played']} games, {tc['winrate']}% WR){extra}."
            )

        if h2h_games:
            tactical_brief.append(
                f"Verified H2H Record (session_valid): {c9['name']} is {h2h_c9_wins}-{h2h_opp_wins} in maps/games "
                f"across {len(h2h_series_groups)} series against {opp['name']}."
            )
        else:
            tactical_brief.append(
                f"First-Time / Unplayed H2H in Corpus: Zero prior valid H2H games recorded; rely on overall "
                f"map/champion profile ({opp['games_played']} valid games at {opp['game_winrate']}% WR)."
            )

        # Render ready-to-share Markdown scouting dossier
        md_lines = [
            f"# Strata9 Pre-Match Scouting Dossier: {c9['name']} vs {opp['name']}",
            f"- **Title**: {'VALORANT' if title == 'val' else 'League of Legends'}",
            f"- **Data Integrity**: Official GRID `meta/*.csv` corpus (`session_valid == True` strictly enforced)",
            f"- **Head-to-Head**: {c9['name']} **{h2h_c9_wins}–{h2h_opp_wins}** {opp['name']} ({len(h2h_series_groups)} series)",
            f"- **Overall Form**: {c9['name']} {c9['game_wins']}-{c9['game_losses']} ({c9['game_winrate']}%) | "
            f"{opp['name']} {opp['game_wins']}-{opp['game_losses']} ({opp['game_winrate']}%)",
            "",
            "## Key Coaching Directives",
        ]
        for bullet in tactical_brief:
            md_lines.append(f"- {bullet}")

        md_lines.extend(["", "## Map / Side Veto Matrix", "", "| Map / Side | C9 WR (G) | Opp WR (G) | H2H | Edge | Action |", "|---|---:|---:|---:|---:|---|"])
        for row in veto_matrix:
            md_lines.append(
                f"| {row['map']} | {row['c9_winrate']}% ({row['c9_played']}) | "
                f"{row['opp_winrate']}% ({row['opp_played']}) | {row['h2h_record']} | "
                f"{row['edge_delta']:+.1f}pp | **{row['recommendation']}** |"
            )

        md_lines.extend(["", f"## {opp['name']} Active Roster & Comfort Picks (Last 10 Valid Games)", "", "| Player | Games | Recent WR | Signature Picks |", "|---|---:|---:|---|"])
        for p in opponent_roster:
            picks_str = ", ".join(f"{s['character']} ({s['games']}G, {s['winrate']}%)" for s in p["signature_picks"])
            md_lines.append(f"| {p['player_name']} | {p['recent_games']} | {p['recent_winrate']}% | {picks_str} |")

        if recent_h2h_series:
            md_lines.extend(["", "## Verified Head-to-Head Match History", ""])
            for s in recent_h2h_series:
                maps_desc = ", ".join(f"{m['map']} ({m['c9_score']}-{m['opp_score']})" for m in s["maps"])
                md_lines.append(f"- **{s['date']}** · {s['event']} ({s['stage']}) · Series `{s['series_id']}`: **{s['score']}** — {maps_desc}")

        return {
            "title": title,
            "c9_team": {
                "team_id": c9["team_id"],
                "name": c9["name"],
                "games_played": c9["games_played"],
                "game_wins": c9["game_wins"],
                "game_losses": c9["game_losses"],
                "game_winrate": c9["game_winrate"],
                "top_characters": c9["top_characters"][:8],
            },
            "opponent": {
                "team_id": opp["team_id"],
                "name": opp["name"],
                "games_played": opp["games_played"],
                "game_wins": opp["game_wins"],
                "game_losses": opp["game_losses"],
                "game_winrate": opp["game_winrate"],
                "top_characters": opp["top_characters"][:8],
                "active_roster": opponent_roster,
            },
            "h2h": {
                "series_count": len(h2h_series_groups),
                "games_count": len(h2h_games),
                "c9_game_wins": h2h_c9_wins,
                "opp_game_wins": h2h_opp_wins,
                "c9_winrate": round(h2h_c9_wins / len(h2h_games) * 100, 1) if h2h_games else None,
                "recent_series": recent_h2h_series,
            },
            "veto_matrix": veto_matrix,
            "tactical_brief": tactical_brief,
            "markdown": "\n".join(md_lines),
        }
