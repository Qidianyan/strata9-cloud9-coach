import { useEffect, useState } from 'react';
import type { LolSeriesResponse, WhatIfResponse } from '../types';
import { AiCoachPanel } from './AiCoachPanel';
import { WhatIfSimulator } from './WhatIfSimulator';

interface LolMacroViewProps {
  series: LolSeriesResponse;
}

const OBJ_GLYPH: Record<string, string> = {
  BARON: 'B',
  ATAKHAN: 'A',
  DRAGON: 'D',
  HERALD: 'H',
  VOIDGRUB: 'G',
  TOWER: 'T',
  INHIBITOR: 'I',
};

export function LolMacroView({ series }: LolMacroViewProps) {
  const [gameIdx, setGameIdx] = useState(0);
  const [activeSwingRank, setActiveSwingRank] = useState<number>(1);
  const [objFilter, setObjFilter] = useState<'all' | 'neutral' | 'structures'>('all');
  const [attachedWhatIf, setAttachedWhatIf] = useState<WhatIfResponse | null>(null);

  useEffect(() => {
    setGameIdx(0);
    setActiveSwingRank(1);
    setAttachedWhatIf(null);
  }, [series.series_id]);

  useEffect(() => {
    setAttachedWhatIf(null);
  }, [gameIdx, activeSwingRank]);

  const game = series.games[gameIdx] ?? series.games[0];
  if (!game) {
    return (
      <div className="status-banner is-error">
        <span>No valid League of Legends games found for series {series.series_id}.</span>
      </div>
    );
  }

  const activeSwing =
    game.top_macro_swings.find((w) => w.rank === activeSwingRank) ?? game.top_macro_swings[0];

  const timeline = game.gold_timeline;
  const W = 940;
  const H = 260;
  const padL = 56;
  const padR = 24;
  const padT = 22;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxMin = Math.max(1, timeline[timeline.length - 1]?.minute ?? 30);
  const maxAbsGold = Math.max(4000, ...timeline.map((pt) => Math.abs(pt.gold_diff)));
  const yCeiling = Math.ceil(maxAbsGold / 2000) * 2000;
  const xForSec = (sec: number) =>
    padL + (Math.min(game.duration_sec, sec) / Math.max(1, game.duration_sec)) * plotW;
  const xForMin = (m: number) => padL + (m / maxMin) * plotW;
  const yForGold = (gd: number) => padT + plotH / 2 - (gd / yCeiling) * (plotH / 2 - 6);
  const zeroY = yForGold(0);

  const curvePoints = timeline.map(
    (pt) => `${xForMin(pt.minute).toFixed(1)},${yForGold(pt.gold_diff).toFixed(1)}`,
  );
  const areaPath =
    timeline.length > 1
      ? `M ${xForMin(timeline[0].minute).toFixed(1)},${zeroY.toFixed(1)} ` +
        timeline
          .map((pt) => `L ${xForMin(pt.minute).toFixed(1)},${yForGold(pt.gold_diff).toFixed(1)}`)
          .join(' ') +
        ` L ${xForMin(timeline[timeline.length - 1].minute).toFixed(1)},${zeroY.toFixed(1)} Z`
      : '';

  const filteredObjectives = game.objectives
    .filter((o) => {
      if (objFilter === 'neutral') return !['TOWER', 'INHIBITOR'].includes(o.category);
      if (objFilter === 'structures') return ['TOWER', 'INHIBITOR'].includes(o.category);
      return true;
    })
    .slice(0, 14);

  const c9Obj = game.objective_totals.c9;
  const oppObj = game.objective_totals.opp;
  const majorC9 = (c9Obj.dragons ?? 0) + (c9Obj.barons ?? 0) + (c9Obj.heralds ?? 0) + (c9Obj.atakhan ?? 0);
  const majorOpp =
    (oppObj.dragons ?? 0) + (oppObj.barons ?? 0) + (oppObj.heralds ?? 0) + (oppObj.atakhan ?? 0);

  return (
    <>
      <section className="panel match-banner" aria-label="League of Legends match overview">
        <div>
          <h1 className="match-headline">
            <span>
              {series.c9_team_name} vs {series.opponent_name}
            </span>
            <span className={`series-score-badge ${series.c9_won_series ? 'is-win' : 'is-loss'}`}>
              {series.c9_won_series ? 'WIN' : 'LOSS'} {series.series_score}
            </span>
          </h1>
          <div className="match-meta-row">
            <span className="match-meta-tag">League of Legends ({series.event || 'LCS / LTA'})</span>
            <span>{series.stage || 'Official Feed'}</span>
            <span className="mono">Series #{series.series_id}</span>
            <span className="mono">{series.scheduled_start.slice(0, 10)}</span>
          </div>
          <div className="audit-strip">
            <span className="audit-chip mono">
              {series.telemetry_audit.envelopes_streamed.toLocaleString()} envelopes,{' '}
              {series.telemetry_audit.events_streamed.toLocaleString()} events
            </span>
            <span className="audit-chip mono">
              Game {game.game_number} ({game.duration_label}), Side: {game.c9_side.toUpperCase()}
            </span>
            <span className="audit-chip mono">
              Kills: {game.c9_kills}-{game.opp_kills}
            </span>
          </div>
        </div>

        <div className="map-tabs" role="tablist" aria-label="Series games">
          {series.games.map((gm, idx) => (
            <button
              key={gm.game_id}
              type="button"
              role="tab"
              aria-selected={idx === gameIdx}
              className={`map-tab ${idx === gameIdx ? 'is-active' : ''}`}
              onClick={() => {
                setGameIdx(idx);
                setActiveSwingRank(1);
              }}
            >
              <span className="map-tab-label">
                Game {gm.game_number} ({gm.duration_label})
              </span>
              <span className="map-tab-score">
                {gm.c9_won ? 'WIN' : 'LOSS'} ({gm.final_gold_diff >= 0 ? '+' : ''}
                {(gm.final_gold_diff / 1000).toFixed(1)}k)
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="kpi-grid" aria-label="LoL macro KPIs">
        <div className="kpi-card">
          <div className="kpi-label">Gold Diff @ 15:00</div>
          <div className={`kpi-value ${game.gold_diff_15 >= 0 ? 'is-green' : 'is-crimson'}`}>
            {game.gold_diff_15 >= 0 ? '+' : ''}
            {game.gold_diff_15.toLocaleString()}g
          </div>
          <div className="kpi-meta mono">
            @10m {game.gold_diff_10 >= 0 ? '+' : ''}
            {game.gold_diff_10.toLocaleString()}g, @20m {game.gold_diff_20 >= 0 ? '+' : ''}
            {game.gold_diff_20.toLocaleString()}g
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Final Net Worth Diff</div>
          <div className={`kpi-value ${game.final_gold_diff >= 0 ? 'is-volt' : 'is-crimson'}`}>
            {game.final_gold_diff >= 0 ? '+' : ''}
            {game.final_gold_diff.toLocaleString()}g
          </div>
          <div className="kpi-meta mono">
            {game.c9_gold.toLocaleString()}g vs {game.opp_gold.toLocaleString()}g
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Epic Objectives</div>
          <div className="kpi-value is-volt">
            {majorC9}-{majorOpp}
          </div>
          <div className="kpi-meta mono">
            Drakes {c9Obj.dragons}-{oppObj.dragons}, Barons {c9Obj.barons}-{oppObj.barons}, Grubs{' '}
            {c9Obj.voidgrubs}-{oppObj.voidgrubs}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Structures Destroyed</div>
          <div className="kpi-value">
            {game.c9_towers}-{game.opp_towers}
          </div>
          <div className="kpi-meta mono">
            Heralds {c9Obj.heralds}-{oppObj.heralds}, Atakhan {c9Obj.atakhan}-{oppObj.atakhan}
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Gold diff and objective tempo chart">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              01 // Minute-by-Minute Gold Diff &amp; Objective Tempo: Game {game.game_number}
            </h2>
            <p className="panel-subtitle">
              Real team netWorth curve streamed from GRID events. Shaded band marks selected macro swing.
            </p>
          </div>
          <div className="legend-row" style={{ marginTop: 0 }}>
            <span className="legend-item text-volt">{series.c9_team_name} Objective</span>
            <span className="legend-item text-crimson">{series.opponent_name} Objective</span>
            <span className="legend-item mono">D=Drake, B=Baron, H=Herald, A=Atakhan</span>
          </div>
        </div>

        <div className="svg-stage">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={`Gold differential curve for Game ${game.game_number} of ${series.c9_team_name} vs ${series.opponent_name}`}
            style={{ display: 'block' }}
          >
            {[-1, -0.5, 0, 0.5, 1].map((frac) => {
              const gVal = Math.round(yCeiling * frac);
              const y = yForGold(gVal);
              return (
                <g key={frac}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={W - padR}
                    y2={y}
                    stroke={frac === 0 ? '#4E535B' : '#1D2024'}
                    strokeWidth={frac === 0 ? 1.5 : 1}
                    strokeDasharray={frac === 0 ? undefined : '3 4'}
                  />
                  <text
                    x={padL - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fill="#9A9EA5"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {gVal > 0 ? `+${gVal / 1000}k` : gVal < 0 ? `${gVal / 1000}k` : '0g'}
                  </text>
                </g>
              );
            })}

            {activeSwing && (
              <rect
                x={xForMin(activeSwing.start_min)}
                y={padT}
                width={Math.max(14, xForMin(activeSwing.end_min) - xForMin(activeSwing.start_min))}
                height={plotH}
                fill={activeSwing.gold_swing >= 0 ? 'rgba(232, 255, 59, 0.14)' : 'rgba(255, 59, 48, 0.16)'}
                stroke={activeSwing.gold_swing >= 0 ? '#E8FF3B' : '#FF3B30'}
                strokeWidth="1"
              />
            )}

            {areaPath && <path d={areaPath} fill="rgba(232, 255, 59, 0.1)" />}
            <polyline
              fill="none"
              stroke="#E8FF3B"
              strokeWidth="2.4"
              strokeLinejoin="round"
              points={curvePoints.join(' ')}
            />

            {game.objectives
              .filter((o) => !['TOWER', 'VOIDGRUB'].includes(o.category))
              .map((o, idx) => {
                const ox = xForSec(o.clock_sec);
                const oy = yForGold(o.gold_diff_at_time);
                const col = o.is_c9 ? '#E8FF3B' : '#FF3B30';
                return (
                  <g key={`${o.occurred_at}-${idx}`}>
                    <circle cx={ox} cy={oy} r={8.5} fill="#0B0C0D" stroke={col} strokeWidth="1.6" />
                    <text
                      x={ox}
                      y={oy + 3.2}
                      textAnchor="middle"
                      fill={col}
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {OBJ_GLYPH[o.category] ?? 'O'}
                    </text>
                  </g>
                );
              })}

            {timeline
              .filter((pt) => pt.minute % 5 === 0 || pt.minute === maxMin)
              .map((pt) => (
                <text
                  key={pt.minute}
                  x={xForMin(pt.minute)}
                  y={H - 10}
                  textAnchor="middle"
                  fill="#9A9EA5"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pt.minute}m
                </text>
              ))}
          </svg>
        </div>

        <div className="draft-grid">
          <div className="draft-box">
            <div className="kpi-label">
              {series.c9_team_name} Draft ({game.c9_side.toUpperCase()} SIDE)
            </div>
            <div className="champ-pills">
              {game.draft.c9_picks.map((c) => (
                <span key={c} className="champ-pill is-c9">
                  {c}
                </span>
              ))}
            </div>
            {game.draft.c9_bans.length > 0 && (
              <div className="champ-pills">
                <span className="kpi-label" style={{ alignSelf: 'center', marginRight: 4 }}>
                  Bans:
                </span>
                {game.draft.c9_bans.map((b) => (
                  <span key={b} className="champ-pill is-ban">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="draft-box">
            <div className="kpi-label">
              {series.opponent_name} Draft ({game.opp_side.toUpperCase()} SIDE)
            </div>
            <div className="champ-pills">
              {game.draft.opp_picks.map((c) => (
                <span key={c} className="champ-pill">
                  {c}
                </span>
              ))}
            </div>
            {game.draft.opp_bans.length > 0 && (
              <div className="champ-pills">
                <span className="kpi-label" style={{ alignSelf: 'center', marginRight: 4 }}>
                  Bans:
                </span>
                {game.draft.opp_bans.map((b) => (
                  <span key={b} className="champ-pill is-ban">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <AiCoachPanel
        title="lol"
        seriesId={series.series_id}
        mapIndex={gameIdx}
        contextLabel={`Game ${game.game_number} (${game.duration_label})`}
        telemetryExport={{
          seriesLabel: `${series.c9_team_name} vs ${series.opponent_name} (${series.series_score})`,
          mapOrGame: `Game ${game.game_number} (${game.duration_label}, ${game.c9_side.toUpperCase()} side)`,
          wpSwing: `Final ${game.final_gold_diff >= 0 ? '+' : ''}${game.final_gold_diff.toLocaleString()}g (@15m ${
            game.gold_diff_15 >= 0 ? '+' : ''
          }${game.gold_diff_15.toLocaleString()}g)`,
          impactScore: activeSwing?.impact_score,
          swingTag: activeSwing?.phase,
          headline: activeSwing
            ? `Window ${activeSwing.window_label}: ${activeSwing.gold_swing >= 0 ? '+' : ''}${activeSwing.gold_swing.toLocaleString()}g (Kills ${activeSwing.c9_kills}-${activeSwing.opp_kills})`
            : undefined,
          telemetryPrescription: activeSwing?.coaching_prescription,
          whatIfSimulation: attachedWhatIf,
          keyEvents: game.objectives
            .filter((o) => !['TOWER', 'VOIDGRUB'].includes(o.category))
            .slice(0, 10)
            .map((o) => ({
              clock_label: o.clock_label,
              kind: o.category,
              actor: `${o.actor} (${o.is_c9 ? series.c9_team_name : series.opponent_name})`,
              detail: `${o.label}, Gold Diff ${o.gold_diff_at_time >= 0 ? '+' : ''}${o.gold_diff_at_time.toLocaleString()}g`,
            })),
        }}
        quickQuestions={[
          {
            label: `Game ${game.game_number} Tempo`,
            prompt: `Break down Cloud9 Kia Game ${game.game_number} objective tempo and gold conversion`,
          },
          {
            label: 'Top Gold Swing',
            prompt: activeSwing
              ? `What drove the ${activeSwing.window_label} gold swing?`
              : 'Analyze mid-game dragon setups',
          },
          {
            label: 'Draft Win Conditions',
            prompt: 'Evaluate draft win conditions and side-lane pressure for Cloud9 Kia',
          },
        ]}
      />

      <WhatIfSimulator
        title="lol"
        lolSeed={{
          gameMinute: activeSwing ? Math.round((activeSwing.start_min + activeSwing.end_min) / 2) : 20,
          goldDiff: activeSwing ? activeSwing.gold_diff_after - activeSwing.gold_swing : game.gold_diff_15,
          dragonDiff: (c9Obj.dragons ?? 0) - (oppObj.dragons ?? 0),
          label: `Game ${game.game_number} (${activeSwing ? activeSwing.window_label : '15:00'})`,
        }}
        attachedResult={attachedWhatIf}
        onAttachToBrief={(sim) => setAttachedWhatIf(sim)}
      />

      <div className="tactical-grid">
        <section className="panel" aria-label="Top 5 Macro Swing Windows">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">04 // Top Macro Swing Windows</h2>
              <p className="panel-subtitle">Select any 2-minute window to highlight it on the Gold Curve</p>
            </div>
          </div>
          <div className="tp-list">
            {game.top_macro_swings.map((w) => {
              const active = w.rank === activeSwing?.rank;
              const positive = w.gold_swing >= 0;
              return (
                <button
                  key={w.rank}
                  type="button"
                  className={`tp-card ${positive ? 'is-positive' : 'is-negative'} ${active ? 'is-selected' : ''}`}
                  onClick={() => setActiveSwingRank(w.rank)}
                >
                  <div className="tp-top">
                    <span className={`tp-tag ${positive ? 'is-positive' : 'is-negative'}`}>
                      #{w.rank} {w.phase} ({w.window_label})
                    </span>
                    <span className={`tp-swing ${positive ? 'text-green' : 'text-crimson'}`}>
                      {w.gold_swing >= 0 ? '+' : ''}
                      {w.gold_swing.toLocaleString()}g
                    </span>
                  </div>
                  <div className="tp-headline">
                    Kills {w.c9_kills}-{w.opp_kills}, Post-window Diff: {w.gold_diff_after >= 0 ? '+' : ''}
                    {w.gold_diff_after.toLocaleString()}g
                  </div>
                  <p className="tp-rx">{w.coaching_prescription}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-label="Objective Chronology">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">05 // Objective &amp; Structure Chronology</h2>
              <p className="panel-subtitle">{game.objectives.length} verified GRID objective events</p>
            </div>
            <div className="segmented" role="group" aria-label="Filter objectives">
              {(['all', 'neutral', 'structures'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`segmented-btn ${objFilter === f ? 'is-active' : ''}`}
                  onClick={() => setObjFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'neutral' ? 'Neutral' : 'Towers'}
                </button>
              ))}
            </div>
          </div>
          <div className="obj-feed">
            {filteredObjectives.map((o, idx) => (
              <div key={`${o.occurred_at}-${idx}`} className="obj-row">
                <span className="mono text-secondary">{o.clock_label}</span>
                <span className={`obj-cat ${o.is_c9 ? 'is-c9' : 'is-opp'}`}>{o.category}</span>
                <span>
                  <strong>{o.label}</strong>,{' '}
                  <span className="text-muted">
                    {o.actor} ({o.is_c9 ? series.c9_team_name : series.opponent_name})
                  </span>
                </span>
                <span className={`mono ${o.gold_diff_at_time >= 0 ? 'text-green' : 'text-crimson'}`}>
                  {o.gold_diff_at_time >= 0 ? '+' : ''}
                  {(o.gold_diff_at_time / 1000).toFixed(1)}k
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel" aria-label="LoL Player Box Score">
        <div tabIndex={0} role="region" aria-labelledby="lol-boxscore-caption" className="table-wrapper">
          <table className="data-table">
            <caption id="lol-boxscore-caption">
              Game {game.game_number}: Verified Champion Box Score (Final GRID Full State)
            </caption>
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Champion</th>
                <th className="num">K / D / A</th>
                <th className="num">KDA</th>
                <th className="num">CS (CS/m)</th>
                <th className="num">Net Worth</th>
                <th className="num">Gold Share</th>
              </tr>
            </thead>
            <tbody>
              {game.players.map((p) => (
                <tr key={p.player_id}>
                  <th>
                    <span className={p.is_c9 ? 'text-volt' : 'text-primary'}>{p.name}</span>
                  </th>
                  <td data-label="Team">{p.team_name}</td>
                  <td data-label="Champion">{p.champion}</td>
                  <td data-label="K/D/A" className="num">
                    {p.kills} / {p.deaths} / {p.assists}
                  </td>
                  <td data-label="KDA" className="num">
                    {p.kda.toFixed(2)}
                  </td>
                  <td data-label="CS" className="num">
                    {p.cs} ({p.cs_per_min})
                  </td>
                  <td data-label="Net Worth" className="num">
                    {p.gold.toLocaleString()}g
                  </td>
                  <td data-label="Gold Share" className="num">
                    {p.gold_share_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
