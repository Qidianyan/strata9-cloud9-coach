import type { OverviewResponse, TitleId } from '../types';

interface FranchiseIndexViewProps {
  overview: OverviewResponse;
  onOpenLocalSeries: (title: TitleId, seriesId: string) => void;
}

export function FranchiseIndexView({ overview, onOpenLocalSeries }: FranchiseIndexViewProps) {
  const s = overview.corpus_stats;

  return (
    <>
      <section className="panel match-banner" aria-label="Global GRID Corpus Summary">
        <div>
          <h1 className="match-headline">Cloud9 Multi-Title Franchise Intelligence</h1>
          <div className="match-meta-row">
            <span className="match-meta-tag">Official GRID Multi-Title Metadata Index</span>
            <span>Read-only streaming from STL_DATA_DIR</span>
          </div>
          <div className="audit-strip">
            <span className="audit-chip mono">{s.total_meta_rows.toLocaleString()} meta CSV rows indexed</span>
            <span className="audit-chip mono">
              {s.valid_games.toLocaleString()} session_valid games ({s.invalid_games_excluded} invalid excluded)
            </span>
            <span className="audit-chip mono">
              {s.local_val_feeds} VAL and {s.local_lol_feeds} LoL real .jsonl.zst feeds ready
            </span>
          </div>
        </div>
      </section>

      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Teams Indexed</div>
          <div className="kpi-value is-volt">{s.teams}</div>
          <div className="kpi-meta">Across VCT, Game Changers, LCK, LEC, LCS, and LTA</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pro Players Indexed</div>
          <div className="kpi-value">{s.players.toLocaleString()}</div>
          <div className="kpi-meta">{s.characters} Agents and Champions tracked</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Valid VALORANT Maps</div>
          <div className="kpi-value is-green">{s.val_valid_games.toLocaleString()}</div>
          <div className="kpi-meta mono">{s.val_invalid_excluded} invalid sessions filtered out</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Valid LoL Games</div>
          <div className="kpi-value is-green">{s.lol_valid_games.toLocaleString()}</div>
          <div className="kpi-meta mono">{s.lol_invalid_excluded} invalid sessions filtered out</div>
        </div>
      </section>

      <section className="squad-grid" aria-label="Cloud9 Squads">
        {overview.cloud9_squads.map((sq) => (
          <article key={`${sq.title}-${sq.team_id}`} className="panel">
            <div className="tp-top">
              <span className="badge badge-volt">
                {sq.title === 'val' ? 'VALORANT' : 'League of Legends'} (ID {sq.team_id})
              </span>
              <span className="mono text-muted">
                {sq.series_wins}W-{sq.series_losses}L Series
              </span>
            </div>
            <h2 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 20 }}>
              {sq.name}
            </h2>
            <div className="kpi-value is-volt" style={{ fontSize: 28 }}>
              {sq.game_winrate}%
              <span className="text-secondary" style={{ fontSize: 13, marginLeft: 8 }}>
                ({sq.game_wins}-{sq.game_losses} valid games)
              </span>
            </div>

            <div className="kpi-label" style={{ marginTop: 12 }}>
              Top Picked {sq.title === 'val' ? 'Agents' : 'Champions'}
            </div>
            <div className="champ-pills">
              {sq.top_characters.slice(0, 5).map((c) => (
                <span key={c.character} className="champ-pill is-c9">
                  {c.character} {c.winrate}% ({c.played})
                </span>
              ))}
            </div>

            <div className="kpi-label" style={{ marginTop: 12 }}>
              Patch-by-Patch Winrate Trend
            </div>
            <div className="patch-bars" aria-label={`Patch winrates for ${sq.name}`}>
              {sq.patch_trends.slice(-8).map((pt) => {
                const barCls =
                  pt.winrate >= 55 ? 'patch-bar-high' : pt.winrate >= 45 ? 'patch-bar-mid' : 'patch-bar-low';
                return (
                  <div
                    key={pt.patch}
                    className="patch-col"
                    title={`Patch ${pt.patch}: ${pt.winrate}% (${pt.wins}/${pt.played})`}
                  >
                    <div
                      className={`patch-bar-fill ${barCls}`}
                      style={{ height: `${Math.max(8, Math.round(pt.winrate * 0.62))}px` }}
                    />
                    <span className="patch-bar-label">{pt.patch.slice(0, 6)}</span>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </section>

      <section className="panel" aria-label="Local Cloud9 Telemetry Feeds">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Checked-Out Real Cloud9 .jsonl.zst Match Feeds (10 Series)</h2>
            <p className="panel-subtitle">Select any series to stream-parse its full event feed live from STL_DATA_DIR</p>
          </div>
        </div>
        <div className="tactical-grid">
          <div className="tp-list">
            <div className="kpi-label">VALORANT VCT Americas (6 Feeds + 6 Ability Supplements)</div>
            {overview.local_series.val.map((m) => (
              <button
                key={m.series_id}
                type="button"
                className={`tp-card ${m.c9_won_series ? 'is-positive' : 'is-negative'}`}
                onClick={() => onOpenLocalSeries('val', m.series_id)}
              >
                <div className="tp-top">
                  <span className="mono text-secondary">
                    #{m.series_id} ({m.scheduled_start.slice(0, 10)}) {m.event}
                  </span>
                  <span className={`badge ${m.c9_won_series ? 'badge-pick' : 'badge-ban'}`}>
                    {m.c9_won_series ? 'W' : 'L'} {m.series_score}
                  </span>
                </div>
                <div className="tp-headline">
                  {m.c9_team_name} vs {m.opponent_name}
                </div>
                <div className="mono text-muted">
                  {m.game_scores.map((g) => `${g.map} ${g.c9_score}-${g.opp_score}`).join(', ')}
                </div>
              </button>
            ))}
          </div>

          <div className="tp-list">
            <div className="kpi-label">League of Legends LCS / LTA (4 Cloud9 Kia Feeds)</div>
            {overview.local_series.lol.map((m) => (
              <button
                key={m.series_id}
                type="button"
                className={`tp-card ${m.c9_won_series ? 'is-positive' : 'is-negative'}`}
                onClick={() => onOpenLocalSeries('lol', m.series_id)}
              >
                <div className="tp-top">
                  <span className="mono text-secondary">
                    #{m.series_id} ({m.scheduled_start.slice(0, 10)}) {m.event}
                  </span>
                  <span className={`badge ${m.c9_won_series ? 'badge-pick' : 'badge-ban'}`}>
                    {m.c9_won_series ? 'W' : 'L'} {m.series_score}
                  </span>
                </div>
                <div className="tp-headline">
                  {m.c9_team_name} vs {m.opponent_name}
                </div>
                <div className="mono text-muted">
                  {m.game_scores.length} games ready for Gold Diff &amp; Objective Tempo
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="tactical-grid">
        <section className="panel">
          <div tabIndex={0} role="region" aria-labelledby="val-meta-caption" className="table-wrapper">
            <table className="data-table">
              <caption id="val-meta-caption">VALORANT Global Agent Meta ({s.val_valid_games} Valid Maps)</caption>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="num">Picks</th>
                  <th className="num">Wins</th>
                  <th className="num">Winrate</th>
                </tr>
              </thead>
              <tbody>
                {overview.meta_leaders.val.map((row) => (
                  <tr key={row.character}>
                    <th>{row.character}</th>
                    <td data-label="Picks" className="num">
                      {row.played}
                    </td>
                    <td data-label="Wins" className="num">
                      {row.wins}
                    </td>
                    <td data-label="Winrate" className="num">
                      {row.winrate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div tabIndex={0} role="region" aria-labelledby="lol-meta-caption" className="table-wrapper">
            <table className="data-table">
              <caption id="lol-meta-caption">League of Legends Global Champion Meta ({s.lol_valid_games} Valid Games)</caption>
              <thead>
                <tr>
                  <th>Champion</th>
                  <th className="num">Picks</th>
                  <th className="num">Wins</th>
                  <th className="num">Winrate</th>
                </tr>
              </thead>
              <tbody>
                {overview.meta_leaders.lol.map((row) => (
                  <tr key={row.character}>
                    <th>{row.character}</th>
                    <td data-label="Picks" className="num">
                      {row.played}
                    </td>
                    <td data-label="Wins" className="num">
                      {row.wins}
                    </td>
                    <td data-label="Winrate" className="num">
                      {row.winrate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
