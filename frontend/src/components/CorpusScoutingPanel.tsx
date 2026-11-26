import { useEffect, useState } from 'react';
import { fetchCorpusScouting } from '../api';
import type { CorpusScoutingResponse, TitleId } from '../types';

interface CorpusScoutingPanelProps {
  title: TitleId;
  onOpenLocalSeries?: (title: TitleId, seriesId: string) => void;
}

export function CorpusScoutingPanel({ title, onOpenLocalSeries }: CorpusScoutingPanelProps) {
  const [data, setData] = useState<CorpusScoutingResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchCorpusScouting(title, controller.signal)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to aggregate GRID corpus');
        setLoading(false);
      });
    return () => controller.abort();
  }, [title]);

  const val = data?.val;
  const lol = data?.lol;

  return (
    <section className="panel" aria-label="Cross-Series GRID Corpus Scouting Matrix" data-section="corpus-scouting">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            Cross-Series GRID Corpus Scouting Matrix ({title === 'val' ? 'VALORANT' : 'League of Legends'})
          </h2>
          <p className="panel-subtitle">
            Live multi-match aggregation streamed read-only from external STL_DATA_DIR with Wilson 95% CI
          </p>
        </div>
        <div className="controls-cluster">
          <span className="badge badge-pick">ZERO DATA IN GIT</span>
          {title === 'val' && val && (
            <span className="badge badge-volt mono">
              {val.series_count} series, {val.rounds_count} rounds, {val.spatial_casts_count.toLocaleString()} casts
            </span>
          )}
          {title === 'lol' && lol && (
            <span className="badge badge-volt mono">
              {lol.series_count} series, {lol.games_count} games, {lol.snapshots_count} min snapshots
            </span>
          )}
        </div>
      </div>

      {error && <div className="status-banner is-error">{error}</div>}
      {loading && !(title === 'val' ? val : lol) && (
        <div className="status-banner">
          <span className="mono">Aggregating real multi-series GRID .jsonl.zst feeds...</span>
        </div>
      )}

      {!loading && !error && title === 'val' && val && val.series_count === 0 && (
        <div className="status-banner">
          <span>No local VALORANT .jsonl.zst feeds found in STL_DATA_DIR. Sparse-checkout feeds to enable multi-series aggregation.</span>
        </div>
      )}

      {!loading && !error && title === 'lol' && lol && lol.series_count === 0 && (
        <div className="status-banner">
          <span>No local League of Legends .jsonl.zst feeds found in STL_DATA_DIR. Sparse-checkout feeds to enable multi-series aggregation.</span>
        </div>
      )}

      {title === 'val' && val && val.series_count > 0 && (
        <div className="corpus-stack">
          <ul className="brief-list">
            {val.coaching_directives.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>

          <div tabIndex={0} role="region" aria-labelledby="val-corpus-map-caption" className="table-wrapper">
            <table className="data-table">
              <caption id="val-corpus-map-caption">
                Multi-Series Map Winrate, ATK/DEF Split, FK Conversion &amp; Wilson 95% CI ({val.series_count} Live Feeds)
              </caption>
              <thead>
                <tr>
                  <th>Map</th>
                  <th className="num">Maps (W-L)</th>
                  <th className="num">Round WR (95% CI)</th>
                  <th className="num">ATK / DEF</th>
                  <th className="num">FK Conv%</th>
                  <th className="num">Post-Plant%</th>
                  <th>Cloud9 Counter Directive</th>
                </tr>
              </thead>
              <tbody>
                {val.map_matrix.map((m) => (
                  <tr key={m.map}>
                    <th scope="row" style={{ textTransform: 'capitalize' }}>{m.map}</th>
                    <td data-label="Maps" className="num">
                      {m.map_wins}-{m.maps_played - m.map_wins} ({m.maps_played})
                    </td>
                    <td data-label="Round WR" className={`num ${m.round_winrate >= 50 ? 'text-green' : 'text-crimson'}`}>
                      {m.round_winrate}% ({m.wilson_ci_low}-{m.wilson_ci_high}%)
                    </td>
                    <td data-label="ATK / DEF" className="num">
                      {m.atk_winrate}% / {m.def_winrate}%
                    </td>
                    <td data-label="FK Conv%" className="num">
                      {m.fk_conversion_rate}%
                    </td>
                    <td data-label="Post-Plant%" className="num">
                      {m.post_plant_winrate}%
                    </td>
                    <td data-label="Directive" style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                      {m.counter_directive}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tactical-grid">
            <div className="corpus-subcard">
              <h3 className="coach-subhead">Empirical Buy-Tier Winrates (Wilson 95% CI)</h3>
              <div className="econ-tier-list">
                {val.economy_matrix.map((e) => (
                  <div key={e.buy_tier} className="econ-tier-row">
                    <div className="whatif-field-head">
                      <span className="mono text-primary">{e.buy_tier}</span>
                      <span className="mono text-volt">
                        {e.winrate}% ({e.rounds_won}/{e.rounds_played})
                      </span>
                    </div>
                    <div className="tier-bar-track">
                      <div className="tier-bar-fill" style={{ width: `${Math.max(4, Math.min(100, e.winrate))}%` }} />
                    </div>
                    <div className="kpi-meta mono">
                      95% CI: {e.wilson_ci_low}% to {e.wilson_ci_high}% | Avg Econ {e.avg_econ_diff >= 0 ? '+' : ''}$
                      {e.avg_econ_diff.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="corpus-subcard">
              <h3 className="coach-subhead">Aggregated 3x3 Spatial Utility Hotzones ({val.spatial_casts_count.toLocaleString()} Casts)</h3>
              <div className="hotzone-grid" role="grid" aria-label="Aggregated spatial ability hotzones">
                {val.spatial_hotzones.map((z) => (
                  <div
                    key={`${z.gx}-${z.gy}`}
                    className={`hotzone-cell ${z.intensity >= 0.65 ? 'is-hot' : z.intensity >= 0.35 ? 'is-warm' : ''}`}
                  >
                    <div className="hotzone-label">{z.label}</div>
                    <div className="mono text-volt">{z.total_casts}</div>
                    <div className="kpi-meta mono">C9 {z.c9_share_pct}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div tabIndex={0} role="region" aria-labelledby="val-corpus-opp-caption" className="table-wrapper">
            <table className="data-table">
              <caption id="val-corpus-opp-caption">
                Cross-Series Opponent Tendencies &amp; Provenance ({val.series_count} Streamed .jsonl.zst Feeds)
              </caption>
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th className="num">Series</th>
                  <th className="num">C9 Round WR (95% CI)</th>
                  <th className="num">C9 FK%</th>
                  <th className="num">Post-Plant%</th>
                  <th>Counter Strategy</th>
                </tr>
              </thead>
              <tbody>
                {val.opponent_tendencies.map((o) => (
                  <tr key={o.opponent}>
                    <th scope="row">{o.opponent}</th>
                    <td data-label="Series" className="num">
                      {o.series_count} ({o.c9_map_wins}/{o.maps_played} maps)
                    </td>
                    <td
                      data-label="C9 Round WR"
                      className={`num ${o.c9_round_winrate >= 50 ? 'text-green' : 'text-crimson'}`}
                    >
                      {o.c9_round_winrate}% ({o.wilson_ci_low}-{o.wilson_ci_high}%)
                    </td>
                    <td data-label="C9 FK%" className="num">
                      {o.c9_fk_winrate}%
                    </td>
                    <td data-label="Post-Plant%" className="num">
                      {o.c9_post_plant_winrate}%
                    </td>
                    <td data-label="Counter Strategy" style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                      {o.counter_strategy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="audit-strip">
            {val.evidence_series.map((s) => (
              <button
                key={s.series_id}
                type="button"
                className="chip-btn mono"
                onClick={() => onOpenLocalSeries?.('val', s.series_id)}
              >
                #{s.series_id} vs {s.opponent} ({s.score}, {s.rounds_parsed}R)
              </button>
            ))}
          </div>
        </div>
      )}

      {title === 'lol' && lol && lol.series_count > 0 && (
        <div className="corpus-stack">
          <ul className="brief-list">
            {lol.coaching_directives.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>

          <div className="tactical-grid">
            <div tabIndex={0} role="region" aria-labelledby="lol-corpus-obj-caption" className="table-wrapper">
              <table className="data-table">
                <caption id="lol-corpus-obj-caption">
                  Cloud9 Kia Objective Control &amp; Conversion Matrix ({lol.games_count} Real Games)
                </caption>
                <thead>
                  <tr>
                    <th>Objective Metric</th>
                    <th className="num">Control%</th>
                    <th className="num">WR When Secured (95% CI)</th>
                  </tr>
                </thead>
                <tbody>
                  {lol.objective_control.map((o) => (
                    <tr key={o.metric_key}>
                      <th scope="row">{o.metric}</th>
                      <td data-label="Control%" className="num">
                        {o.control_rate}% ({o.secured_games}/{o.total_games})
                      </td>
                      <td data-label="WR Secured" className="num text-green">
                        {o.winrate_when_secured}% ({o.wilson_ci_low}-{o.wilson_ci_high}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="corpus-subcard">
              <h3 className="coach-subhead">Empirical Gold-Diff Bucket Winrates ({lol.snapshots_count} Min Samples)</h3>
              <div className="econ-tier-list">
                {lol.gold_bucket_matrix.map((b) => (
                  <div key={b.bucket} className="econ-tier-row">
                    <div className="whatif-field-head">
                      <span className="mono text-primary">{b.bucket}</span>
                      <span className="mono text-volt">
                        {b.winrate}% ({b.minute_samples}m)
                      </span>
                    </div>
                    <div className="tier-bar-track">
                      <div className="tier-bar-fill" style={{ width: `${Math.max(4, Math.min(100, b.winrate))}%` }} />
                    </div>
                    <div className="kpi-meta mono">
                      Wilson 95% CI: {b.wilson_ci_low}% to {b.wilson_ci_high}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {lol.opponent_tendencies.length > 0 && (
            <div tabIndex={0} role="region" aria-labelledby="lol-corpus-opp-caption" className="table-wrapper">
              <table className="data-table">
                <caption id="lol-corpus-opp-caption">
                  Cross-Series Cloud9 Kia Opponent Tendencies ({lol.series_count} Streamed .jsonl.zst Feeds)
                </caption>
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th className="num">Games (W-L)</th>
                    <th className="num">C9 WR (95% CI)</th>
                    <th className="num">Avg GD@15</th>
                    <th className="num">Baron / Drake%</th>
                    <th>Counter Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {lol.opponent_tendencies.map((o) => (
                    <tr key={o.opponent}>
                      <th scope="row">{o.opponent}</th>
                      <td data-label="Games" className="num">
                        {o.c9_game_wins}-{o.games_played - o.c9_game_wins} ({o.games_played})
                      </td>
                      <td data-label="C9 WR" className={`num ${o.c9_winrate >= 50 ? 'text-green' : 'text-crimson'}`}>
                        {o.c9_winrate}% ({o.wilson_ci_low}-{o.wilson_ci_high}%)
                      </td>
                      <td data-label="Avg GD@15" className="num">
                        {o.avg_gold_diff_15 >= 0 ? '+' : ''}
                        {o.avg_gold_diff_15}g
                      </td>
                      <td data-label="Baron / Drake%" className="num">
                        {o.baron_control_pct}% / {o.dragon_control_pct}%
                      </td>
                      <td data-label="Counter Strategy" style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                        {o.counter_strategy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="audit-strip">
            {lol.evidence_series.map((s) => (
              <button
                key={s.series_id}
                type="button"
                className="chip-btn mono"
                onClick={() => onOpenLocalSeries?.('lol', s.series_id)}
              >
                #{s.series_id} vs {s.opponent} ({s.score}, GD@15 {s.avg_gold_diff_15 >= 0 ? '+' : ''}
                {s.avg_gold_diff_15}g)
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
