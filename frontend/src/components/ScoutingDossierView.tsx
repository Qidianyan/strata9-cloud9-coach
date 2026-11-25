import { useEffect, useState } from 'react';
import { fetchDossier, fetchOpponents, getDossierMarkdownUrl } from '../api';
import type { OpponentRow, ScoutingDossierResponse, TitleId } from '../types';

interface ScoutingDossierViewProps {
  title: TitleId;
  onOpenLocalSeries: (title: TitleId, seriesId: string) => void;
}

const SQUAD_OPTIONS: Record<TitleId, Array<{ id: string; label: string }>> = {
  val: [
    { id: '79', label: 'Cloud9 (VCT Americas)' },
    { id: '3429', label: 'Cloud9 GC (Game Changers)' },
  ],
  lol: [{ id: '47351', label: 'Cloud9 Kia (LCS / LTA)' }],
};

export function ScoutingDossierView({ title, onOpenLocalSeries }: ScoutingDossierViewProps) {
  const [teamId, setTeamId] = useState<string>(SQUAD_OPTIONS[title][0].id);
  const [opponents, setOpponents] = useState<OpponentRow[]>([]);
  const [selectedOppId, setSelectedOppId] = useState<string>('');
  const [dossier, setDossier] = useState<ScoutingDossierResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTeamId(SQUAD_OPTIONS[title][0].id);
  }, [title]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchOpponents(title, teamId, controller.signal)
      .then((res) => {
        setOpponents(res.opponents);
        if (res.opponents.length > 0) {
          setSelectedOppId((prev) =>
            res.opponents.some((o) => o.opponent_id === prev) ? prev : res.opponents[0].opponent_id,
          );
        } else {
          setSelectedOppId('');
          setDossier(null);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load opponents');
      });
    return () => controller.abort();
  }, [title, teamId]);

  useEffect(() => {
    if (!selectedOppId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDossier(title, teamId, selectedOppId, controller.signal)
      .then((res) => {
        setDossier(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to build scouting dossier');
        setLoading(false);
      });
    return () => controller.abort();
  }, [title, teamId, selectedOppId]);

  const handleCopyMarkdown = async () => {
    if (!dossier) return;
    try {
      await navigator.clipboard.writeText(dossier.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <section className="panel match-banner" aria-label="Scouting Dossier Controls">
        <div>
          <h1 className="match-headline">
            {dossier ? `${dossier.c9_team.name} vs ${dossier.opponent.name}` : 'Automated Scouting Dossier'}
          </h1>
          <div className="match-meta-row">
            <span className="match-meta-tag">Pre-Match Opponent Scouting Dossier</span>
            <span>Official GRID Meta Corpus (session_valid == True)</span>
          </div>
          <div className="controls-cluster" style={{ marginTop: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span className="text-muted">Squad</span>
              <select
                className="series-select"
                style={{ minWidth: 190 }}
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {SQUAD_OPTIONS[title].map((sq) => (
                  <option key={sq.id} value={sq.id}>
                    {sq.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span className="text-muted">Opponent</span>
              <select
                className="series-select"
                value={selectedOppId}
                onChange={(e) => setSelectedOppId(e.target.value)}
              >
                {opponents.map((o) => (
                  <option key={o.opponent_id} value={o.opponent_id}>
                    {o.opponent_name} (H2H {o.c9_game_wins}-{o.opp_game_wins}, {o.h2h_games}G)
                    {o.has_local_feed ? ' [LIVE FEED]' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {dossier && (
          <div className="controls-cluster">
            <button type="button" className="action-btn is-secondary" onClick={handleCopyMarkdown}>
              {copied ? 'Copied Markdown' : 'Copy Brief (.md)'}
            </button>
            <a
              className="action-btn"
              href={getDossierMarkdownUrl(title, teamId, selectedOppId)}
              download={`strata9_dossier_${title}_${selectedOppId}.md`}
            >
              Export Markdown Dossier
            </a>
          </div>
        )}
      </section>

      {error && (
        <div className="status-banner is-error">
          <span>Error: {error}</span>
        </div>
      )}

      {loading && !dossier && (
        <div className="status-banner">
          <span>Generating verified scouting dossier from official GRID metadata…</span>
        </div>
      )}

      {dossier && (
        <>
          <section className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Verified H2H Maps/Games</div>
              <div className="kpi-value is-volt">
                {dossier.h2h.c9_game_wins}-{dossier.h2h.opp_game_wins}
              </div>
              <div className="kpi-meta mono">
                Across {dossier.h2h.series_count} series ({dossier.h2h.c9_winrate ?? 0}% C9 WR)
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{dossier.c9_team.name} Corpus Form</div>
              <div className="kpi-value is-green">{dossier.c9_team.game_winrate}%</div>
              <div className="kpi-meta mono">
                {dossier.c9_team.game_wins}-{dossier.c9_team.game_losses} ({dossier.c9_team.games_played} valid)
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{dossier.opponent.name} Corpus Form</div>
              <div className="kpi-value">{dossier.opponent.game_winrate}%</div>
              <div className="kpi-meta mono">
                {dossier.opponent.game_wins}-{dossier.opponent.game_losses} ({dossier.opponent.games_played} valid)
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Opponent Top Priority Pick</div>
              <div
                className="kpi-value is-volt"
                style={{ fontSize: 22, textTransform: title === 'val' ? 'capitalize' : 'none' }}
              >
                {dossier.opponent.top_characters[0]?.character ?? 'N/A'}
              </div>
              <div className="kpi-meta mono">
                {dossier.opponent.top_characters[0]
                  ? `${dossier.opponent.top_characters[0].played} games (${dossier.opponent.top_characters[0].winrate}% WR)`
                  : ''}
              </div>
            </div>
          </section>

          <section className="panel" aria-label="Coaching directives">
            <div className="panel-header">
              <h2 className="panel-title">Executive Coaching Directives</h2>
            </div>
            <ul className="brief-list">
              {dossier.tactical_brief.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          <div className="tactical-grid">
            <section className="panel" aria-label="Map and Side Veto Matrix">
              <div tabIndex={0} role="region" aria-labelledby="veto-table-caption" className="table-wrapper">
                <table className="data-table">
                  <caption id="veto-table-caption">
                    {title === 'val' ? 'Map Veto & Pick Edge Matrix' : 'Side Priority Comparison Matrix'}
                  </caption>
                  <thead>
                    <tr>
                      <th>{title === 'val' ? 'Map' : 'Side'}</th>
                      <th className="num">C9 WR (G)</th>
                      <th className="num">Opp WR (G)</th>
                      <th className="num">H2H</th>
                      <th className="num">Edge</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.veto_matrix.map((row) => {
                      const isPick = row.recommendation.includes('PICK') || row.recommendation.includes('PREFERENCE');
                      const isBan = row.recommendation.includes('BAN');
                      return (
                        <tr key={row.map}>
                          <th style={{ textTransform: 'capitalize' }}>{row.map}</th>
                          <td data-label="C9 WR" className="num">
                            {row.c9_winrate}% ({row.c9_played})
                          </td>
                          <td data-label="Opp WR" className="num">
                            {row.opp_winrate}% ({row.opp_played})
                          </td>
                          <td data-label="H2H" className="num">
                            {row.h2h_record}
                          </td>
                          <td
                            data-label="Edge"
                            className={`num ${row.edge_delta >= 0 ? 'text-green' : 'text-crimson'}`}
                          >
                            {row.edge_delta >= 0 ? '+' : ''}
                            {row.edge_delta}pp
                          </td>
                          <td data-label="Action">
                            <span
                              className={`badge ${isPick ? 'badge-pick' : isBan ? 'badge-ban' : 'badge-volt'}`}
                            >
                              {isPick ? '▲' : isBan ? '✕' : '◆'} {row.recommendation}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel" aria-label="Opponent Active Roster">
              <div tabIndex={0} role="region" aria-labelledby="opp-roster-caption" className="table-wrapper">
                <table className="data-table">
                  <caption id="opp-roster-caption">
                    {dossier.opponent.name}: Active Roster Comfort Picks (Last 10 Valid Games)
                  </caption>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="num">Games</th>
                      <th className="num">WR</th>
                      <th>Signature Picks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.opponent.active_roster.map((p) => (
                      <tr key={p.player_id}>
                        <th>{p.player_name}</th>
                        <td data-label="Games" className="num">
                          {p.recent_games}
                        </td>
                        <td data-label="WR" className="num">
                          {p.recent_winrate}%
                        </td>
                        <td data-label="Signature Picks" style={{ whiteSpace: 'normal' }}>
                          {p.signature_picks
                            .map((s) => `${s.character} (${s.games}G, ${s.winrate}%)`)
                            .join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {dossier.h2h.recent_series.length > 0 && (
            <section className="panel" aria-label="Verified Head-to-Head Match History">
              <div className="panel-header">
                <h2 className="panel-title">Verified Head-to-Head Series History</h2>
              </div>
              <div className="tp-list">
                {dossier.h2h.recent_series.map((s) => (
                  <div
                    key={s.series_id}
                    className="obj-row"
                    style={{ gridTemplateColumns: '92px 80px minmax(0, 1fr) auto' }}
                  >
                    <span className="mono">{s.date}</span>
                    <span className={`badge ${s.c9_won ? 'badge-pick' : 'badge-ban'}`}>
                      {s.c9_won ? 'W' : 'L'} {s.score}
                    </span>
                    <span>
                      <strong>{s.event}</strong> ({s.stage}),{' '}
                      <span className="mono text-muted">
                        {s.maps.map((m) => `${m.map} ${m.c9_score}-${m.opp_score}`).join(' / ')}
                      </span>
                    </span>
                    {s.has_local_feed ? (
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => onOpenLocalSeries(title, s.series_id)}
                      >
                        Open Live Stream
                      </button>
                    ) : (
                      <span className="audit-chip">Meta Indexed</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
