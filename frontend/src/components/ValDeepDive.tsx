import { useEffect, useState } from 'react';
import type { ValSeriesResponse } from '../types';
import { AiCoachPanel } from './AiCoachPanel';
import { RoundReplayCanvas } from './RoundReplayCanvas';
import { SpatialHeatmap } from './SpatialHeatmap';

interface ValDeepDiveProps {
  series: ValSeriesResponse;
}

export function ValDeepDive({ series }: ValDeepDiveProps) {
  const [mapIdx, setMapIdx] = useState(0);
  const [selectedRoundNum, setSelectedRoundNum] = useState<number>(1);

  useEffect(() => {
    setMapIdx(0);
    const firstMap = series.maps[0];
    if (firstMap) {
      const topTp = firstMap.top_turning_points[0];
      setSelectedRoundNum(topTp ? topTp.round_number : firstMap.rounds[0]?.round_number ?? 1);
    }
  }, [series.series_id, series.maps]);

  const activeMap = series.maps[mapIdx] ?? series.maps[0];
  if (!activeMap) {
    return (
      <div className="status-banner is-error">
        <span>No valid maps found in GRID stream for series {series.series_id}.</span>
      </div>
    );
  }

  const handleSelectMap = (idx: number) => {
    setMapIdx(idx);
    const targetMap = series.maps[idx];
    if (targetMap) {
      const topTp = targetMap.top_turning_points[0];
      setSelectedRoundNum(topTp ? topTp.round_number : targetMap.rounds[0]?.round_number ?? 1);
    }
  };

  const selectedRound =
    activeMap.rounds.find((r) => r.round_number === selectedRoundNum) ?? activeMap.rounds[0];

  const sparkW = 1320;
  const sparkH = 76;
  const rounds = activeMap.rounds;
  const stepX = rounds.length > 1 ? (sparkW - 36) / (rounds.length - 1) : 0;
  const sparkPoints = rounds.map((r, i) => {
    const x = 18 + i * stepX;
    const y = sparkH / 2 - (r.wp_swing / 100) * (sparkH / 2 - 12);
    return { x, y, r };
  });
  const polylineStr = sparkPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const audit = series.telemetry_audit;
  const sup = audit.ability_supplement;
  const negTp = activeMap.top_turning_points.find((tp) => tp.wp_swing < 0);

  return (
    <>
      <section className="panel match-banner" aria-label="VALORANT match overview">
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
            <span className="match-meta-tag">VALORANT ({series.event || 'VCT Americas'})</span>
            <span>{series.stage || 'Official Feed'}</span>
            <span className="mono">Series #{series.series_id}</span>
            <span className="mono">{series.scheduled_start.slice(0, 10)}</span>
          </div>
          <div className="audit-strip">
            <span className="audit-chip mono">
              {audit.envelopes_streamed.toLocaleString()} envelopes, {audit.events_streamed.toLocaleString()} events
            </span>
            <span className="audit-chip mono">
              Supplement: {sup.joined_usable.toLocaleString()} casts joined ({sup.sampling_hz ?? 5} Hz)
            </span>
            {audit.rolled_back_games_dropped > 0 && (
              <span className="audit-chip is-warn">
                {audit.rolled_back_games_dropped} GRID map restart rollback dropped (series-!started-game)
              </span>
            )}
          </div>
        </div>

        <div className="map-tabs" role="tablist" aria-label="Series maps">
          {series.maps.map((m, idx) => (
            <button
              key={m.game_id}
              type="button"
              role="tab"
              aria-selected={idx === mapIdx}
              className={`map-tab ${idx === mapIdx ? 'is-active' : ''}`}
              onClick={() => handleSelectMap(idx)}
            >
              <span className="map-tab-label">
                Map {m.game_number}: {m.map}
              </span>
              <span className="map-tab-score">
                {m.c9_won ? 'W' : 'L'} {m.c9_score}-{m.opp_score}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="kpi-grid" aria-label="Map telemetry KPIs">
        <div className="kpi-card">
          <div className="kpi-label">Opening Duel Winrate</div>
          <div className="kpi-value is-volt">{activeMap.summary.opening_duel_winrate}%</div>
          <div className="kpi-meta mono">
            {activeMap.summary.opening_duels_won}/{activeMap.total_rounds} FK, ATK {activeMap.summary.c9_atk_record}, DEF{' '}
            {activeMap.summary.c9_def_record}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">First-Kill Round Conversion</div>
          <div className="kpi-value is-green">{activeMap.summary.fk_conversion_rate}%</div>
          <div className="kpi-meta">Rounds won after {series.c9_team_name} scores first blood</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Post-Plant Conversion</div>
          <div className="kpi-value">{activeMap.summary.post_plant_winrate}%</div>
          <div className="kpi-meta mono">
            {activeMap.summary.c9_plants} spikes planted by {series.c9_team_name}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Spatial Utility Casts Joined</div>
          <div className="kpi-value is-volt">
            {(
              activeMap.summary.c9_ability_casts_spatial + activeMap.summary.opp_ability_casts_spatial
            ).toLocaleString()}
          </div>
          <div className="kpi-meta mono">
            {series.c9_team_name} {activeMap.summary.c9_ability_casts_spatial} vs {series.opponent_name}{' '}
            {activeMap.summary.opp_ability_casts_spatial}
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Round-by-round turning-point timeline">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              Round-by-Round Win-Probability Scrubber: {activeMap.map.toUpperCase()} ({activeMap.c9_score}-
              {activeMap.opp_score})
            </h2>
            <p className="panel-subtitle">
              Acid-yellow corner dot marks Top 5 Turning-Point rounds. Select any round to load Canvas2D replay.
            </p>
          </div>
          <div className="legend-row" style={{ marginTop: 0 }}>
            <span className="legend-item">ATK (Triangle)</span>
            <span className="legend-item">DEF (Diamond)</span>
            <span className="legend-item text-volt">Top 5 Swing</span>
          </div>
        </div>

        <div className="svg-stage" style={{ marginBottom: 12 }}>
          <svg
            viewBox={`0 0 ${sparkW} ${sparkH}`}
            width="100%"
            height="76"
            role="img"
            aria-label="Round-by-round win probability swing curve"
            style={{ display: 'block' }}
          >
            <line x1={18} y1={sparkH / 2} x2={sparkW - 18} y2={sparkH / 2} stroke="#2A2D31" strokeDasharray="4 4" />
            <text x={20} y={14} fill="#9A9EA5" fontSize="9.5" fontFamily="JetBrains Mono, monospace">
              +WP SWING (C9)
            </text>
            <text x={20} y={sparkH - 5} fill="#9A9EA5" fontSize="9.5" fontFamily="JetBrains Mono, monospace">
              -WP SWING ({series.opponent_name.toUpperCase()})
            </text>
            <polyline fill="none" stroke="#8E9299" strokeWidth="1.5" points={polylineStr} />
            {sparkPoints.map(({ x, y, r }) => {
              const active = r.round_number === selectedRound?.round_number;
              const col = r.c9_won ? '#34C759' : '#FF3B30';
              return (
                <g
                  key={r.round_number}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedRoundNum(r.round_number)}
                >
                  {r.is_turning_point && (
                    <circle cx={x} cy={y} r={active ? 8 : 6.5} fill="none" stroke="#E8FF3B" strokeWidth="1.6" />
                  )}
                  <circle cx={x} cy={y} r={active ? 4.8 : 3.2} fill={col} stroke="#0B0C0D" strokeWidth="1" />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="round-strip" role="listbox" aria-label="Select round">
          {rounds.map((r) => {
            const isSel = r.round_number === selectedRound?.round_number;
            return (
              <div key={r.round_number} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {(r.round_number === 13 || r.round_number === 25) && (
                  <span
                    className="half-divider"
                    aria-hidden="true"
                    title={r.round_number === 13 ? 'Half-Time' : 'Overtime'}
                  />
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  className={`round-pill ${r.c9_won ? 'is-c9-win' : 'is-c9-loss'} ${
                    r.is_turning_point ? 'is-turning-point' : ''
                  } ${isSel ? 'is-selected' : ''}`}
                  onClick={() => setSelectedRoundNum(r.round_number)}
                  title={`R${r.round_number}: ${r.headline} (${r.wp_swing >= 0 ? '+' : ''}${r.wp_swing}% WP)`}
                >
                  {r.is_turning_point && <span className="tp-dot" aria-hidden="true" />}
                  <span className="round-num">R{r.round_number}</span>
                  <span className="round-glyph">
                    {r.c9_side === 'attacker' ? '▲' : '◆'}
                    {r.bomb_planted ? ' ◉' : ''}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {selectedRound && (
          <div className="round-inspector">
            <div>
              <div className="tp-top">
                <span className={`tp-tag ${selectedRound.c9_won ? 'is-positive' : 'is-negative'}`}>
                  {selectedRound.swing_tag.replace(/_/g, ' ')}
                </span>
                <span className="mono text-secondary">
                  UTC {selectedRound.occurred_at.slice(11, 19)} ({selectedRound.c9_side.toUpperCase()})
                </span>
              </div>
              <h3 className="tp-headline" style={{ fontSize: 15 }}>
                {selectedRound.headline}
              </h3>
              <p className="tp-rx">{selectedRound.coaching_prescription}</p>
            </div>

            <div className="inspector-grid">
              <div className="mini-stat">
                <div className="mini-stat-label">WP Swing / Impact</div>
                <div className={`mini-stat-value ${selectedRound.wp_swing >= 0 ? 'text-green' : 'text-crimson'}`}>
                  {selectedRound.wp_swing >= 0 ? '+' : ''}
                  {selectedRound.wp_swing}% ({selectedRound.impact_score})
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-stat-label">Economy Diff</div>
                <div className="mini-stat-value">
                  {selectedRound.econ_diff >= 0 ? '+' : ''}${selectedRound.econ_diff.toLocaleString()}
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-stat-label">Buy Matchup</div>
                <div className="mini-stat-value">
                  {selectedRound.c9_buy_class} vs {selectedRound.opp_buy_class}
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-stat-label">Opening Duel</div>
                <div className="mini-stat-value">
                  {selectedRound.first_kill
                    ? `${selectedRound.first_kill.killer} > ${selectedRound.first_kill.victim}`
                    : 'None'}
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-stat-label">Spike / Win Type</div>
                <div className="mini-stat-value">
                  {selectedRound.bomb_planted ? `Planted (${selectedRound.bomb_planter})` : 'No Plant'} /{' '}
                  {selectedRound.win_type}
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-stat-label">Utility Casts</div>
                <div className="mini-stat-value">
                  {series.c9_team_name} {selectedRound.c9_ability_casts} / {selectedRound.opp_ability_casts}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedRound && (
        <div className="tactical-grid" data-section="replay-coach-deck">
          <RoundReplayCanvas
            mapData={activeMap}
            round={selectedRound}
            c9Name={series.c9_team_name}
            oppName={series.opponent_name}
          />
          <AiCoachPanel
            title="val"
            seriesId={series.series_id}
            mapIndex={mapIdx}
            roundNumber={selectedRound.round_number}
            contextLabel={`${activeMap.map.toUpperCase()} R${selectedRound.round_number}`}
            telemetryExport={{
              seriesLabel: `${series.c9_team_name} vs ${series.opponent_name} (${series.series_score})`,
              mapOrGame: `${activeMap.map.toUpperCase()} (${activeMap.c9_score}-${activeMap.opp_score})`,
              roundNumber: selectedRound.round_number,
              wpSwing: `${selectedRound.wp_swing >= 0 ? '+' : ''}${selectedRound.wp_swing}%`,
              impactScore: selectedRound.impact_score,
              swingTag: selectedRound.swing_tag,
              econDiff: `${selectedRound.econ_diff >= 0 ? '+' : ''}$${selectedRound.econ_diff.toLocaleString()}`,
              buyMatchup: `${selectedRound.c9_buy_class} vs ${selectedRound.opp_buy_class}`,
              openingDuel: selectedRound.first_kill
                ? `${selectedRound.first_kill.killer} (${selectedRound.first_kill.killer_team}) > ${selectedRound.first_kill.victim}`
                : 'None',
              spikeStatus: selectedRound.bomb_planted
                ? `Planted (${selectedRound.bomb_planter}) / ${selectedRound.win_type}`
                : `No Plant / ${selectedRound.win_type}`,
              headline: selectedRound.headline,
              telemetryPrescription: selectedRound.coaching_prescription,
              keyEvents: (selectedRound.replay?.events ?? [])
                .filter((ev) => ['kill', 'plant', 'defuse', 'explode'].includes(ev.kind))
                .map((ev) => ({
                  clock_label: `${ev.t.toFixed(1)}s`,
                  kind: ev.kind,
                  actor: ev.killer ?? ev.player ?? 'Unknown',
                  target: ev.victim,
                  detail: ev.weapon ?? ev.kind,
                  coords:
                    typeof ev.raw_x === 'number' && typeof ev.raw_y === 'number'
                      ? `(${Math.round(ev.raw_x)}, ${Math.round(ev.raw_y)})`
                      : undefined,
                })),
            }}
            quickQuestions={[
              {
                label: `Diagnose R${selectedRound.round_number}`,
                prompt: `Diagnose ${activeMap.map.toUpperCase()} R${selectedRound.round_number} execution and coordinate spacing`,
              },
              {
                label: negTp ? `Fix R${negTp.round_number} Leak` : 'Retake Protocol',
                prompt: negTp
                  ? `How do we fix the R${negTp.round_number} ${negTp.swing_tag.toLowerCase().replace(/_/g, ' ')}?`
                  : `Improve ${activeMap.map.toUpperCase()} defender retakes`,
              },
              {
                label: 'Audit Utility Timing',
                prompt: 'Audit Cloud9 opening-duel conversion and utility timing on this map',
              },
            ]}
          />
        </div>
      )}

      <div className="tactical-grid">
        <SpatialHeatmap
          mapData={activeMap}
          selectedRound={selectedRound?.round_number ?? 1}
          c9Name={series.c9_team_name}
          oppName={series.opponent_name}
        />

        <section className="panel" aria-label="Top 5 Turning-Point Coach Prescriptions">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">04 // Top 5 Crucial Swing Rounds</h2>
              <p className="panel-subtitle">
                Ranked by leverage-weighted WP swing. Select a card to load its Canvas2D replay.
              </p>
            </div>
          </div>
          <div className="tp-list">
            {activeMap.top_turning_points.map((tp) => {
              const active = tp.round_number === selectedRound?.round_number;
              return (
                <button
                  key={`${tp.map}-${tp.round_number}`}
                  type="button"
                  className={`tp-card ${tp.c9_won ? 'is-positive' : 'is-negative'} ${active ? 'is-selected' : ''}`}
                  onClick={() => setSelectedRoundNum(tp.round_number)}
                >
                  <div className="tp-top">
                    <span className={`tp-tag ${tp.c9_won ? 'is-positive' : 'is-negative'}`}>
                      #{tp.rank} {tp.swing_tag.replace(/_/g, ' ')}
                    </span>
                    <span className={`tp-swing ${tp.wp_swing >= 0 ? 'text-green' : 'text-crimson'}`}>
                      {tp.wp_swing >= 0 ? '+' : ''}
                      {tp.wp_swing}% WP ({tp.score})
                    </span>
                  </div>
                  <div className="tp-headline">{tp.headline}</div>
                  <p className="tp-rx">{tp.coaching_prescription}</p>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel" aria-label="Map Player Box Score">
        <div tabIndex={0} role="region" aria-labelledby="val-boxscore-caption" className="table-wrapper">
          <table className="data-table">
            <caption id="val-boxscore-caption">
              {activeMap.map.toUpperCase()}: Verified Player Telemetry Box Score (Final GRID Full State)
            </caption>
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Agent</th>
                <th className="num">K / D / A</th>
                <th className="num">K/D</th>
                <th className="num">ADR</th>
                <th className="num">HS%</th>
                <th className="num">FK / FD</th>
                <th className="num">Utility Casts</th>
              </tr>
            </thead>
            <tbody>
              {activeMap.players.map((p) => (
                <tr key={p.player_id}>
                  <th>
                    <span className={p.is_c9 ? 'text-volt' : 'text-primary'}>{p.name}</span>
                  </th>
                  <td data-label="Team">{p.team_name}</td>
                  <td data-label="Agent">{p.agent}</td>
                  <td data-label="K/D/A" className="num">
                    {p.kills} / {p.deaths} / {p.assists}
                  </td>
                  <td data-label="K/D" className="num">
                    {p.kd_ratio.toFixed(2)}
                  </td>
                  <td data-label="ADR" className="num">
                    {p.adr.toFixed(1)}
                  </td>
                  <td data-label="HS%" className="num">
                    {p.hs_pct.toFixed(1)}%
                  </td>
                  <td data-label="FK/FD" className="num">
                    {p.first_kills} / {p.first_deaths}
                  </td>
                  <td data-label="Utility Casts" className="num">
                    {p.ability_casts}
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
