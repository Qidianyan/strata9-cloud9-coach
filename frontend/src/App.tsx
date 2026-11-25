import { useEffect, useState } from 'react';
import { fetchLolSeries, fetchOverview, fetchValSeries } from './api';
import { FranchiseIndexView } from './components/FranchiseIndexView';
import { LolMacroView } from './components/LolMacroView';
import { ScoutingDossierView } from './components/ScoutingDossierView';
import { ValDeepDive } from './components/ValDeepDive';
import type {
  LolSeriesResponse,
  OverviewResponse,
  TitleId,
  ValSeriesResponse,
  ViewId,
} from './types';

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [title, setTitle] = useState<TitleId>('val');
  const [view, setView] = useState<ViewId>('match');

  const [valSeriesId, setValSeriesId] = useState<string>('2748746');
  const [lolSeriesId, setLolSeriesId] = useState<string>('2754509');

  const [valData, setValData] = useState<ValSeriesResponse | null>(null);
  const [lolData, setLolData] = useState<LolSeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState<boolean>(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchOverview(controller.signal)
      .then((ov) => {
        setOverview(ov);
        if (ov.local_series.val.length > 0 && !ov.local_series.val.some((s) => s.series_id === valSeriesId)) {
          setValSeriesId(ov.local_series.val[0].series_id);
        }
        if (ov.local_series.lol.length > 0 && !ov.local_series.lol.some((s) => s.series_id === lolSeriesId)) {
          setLolSeriesId(ov.local_series.lol[0].series_id);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setOverviewError(err instanceof Error ? err.message : 'Unable to reach Strata9 API');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (view !== 'match' || title !== 'val' || !valSeriesId) return;
    if (valData?.series_id === valSeriesId) return;
    const controller = new AbortController();
    setSeriesLoading(true);
    setSeriesError(null);
    fetchValSeries(valSeriesId, controller.signal)
      .then((res) => {
        setValData(res);
        setSeriesLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSeriesError(err instanceof Error ? err.message : 'Failed to parse VALORANT feed');
        setSeriesLoading(false);
      });
    return () => controller.abort();
  }, [view, title, valSeriesId, valData?.series_id]);

  useEffect(() => {
    if (view !== 'match' || title !== 'lol' || !lolSeriesId) return;
    if (lolData?.series_id === lolSeriesId) return;
    const controller = new AbortController();
    setSeriesLoading(true);
    setSeriesError(null);
    fetchLolSeries(lolSeriesId, controller.signal)
      .then((res) => {
        setLolData(res);
        setSeriesLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSeriesError(err instanceof Error ? err.message : 'Failed to parse LoL feed');
        setSeriesLoading(false);
      });
    return () => controller.abort();
  }, [view, title, lolSeriesId, lolData?.series_id]);

  const handleOpenLocalSeries = (targetTitle: TitleId, targetSeriesId: string) => {
    setTitle(targetTitle);
    if (targetTitle === 'val') setValSeriesId(targetSeriesId);
    else setLolSeriesId(targetSeriesId);
    setView('match');
  };

  const activeSeriesList =
    overview ? (title === 'val' ? overview.local_series.val : overview.local_series.lol) : [];
  const activeSeriesId = title === 'val' ? valSeriesId : lolSeriesId;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-group">
            <div className="brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 17L12 4L20 17H4Z" stroke="#E8FF3B" strokeWidth="2" strokeLinejoin="miter" />
                <path d="M8.5 14L12 8.2L15.5 14H8.5Z" fill="#E8FF3B" />
                <line x1="3" y1="20" x2="21" y2="20" stroke="#F3F4F6" strokeWidth="1.6" />
              </svg>
            </div>
            <div>
              <div className="brand-title">STRATA9</div>
              <div className="brand-subtitle">Cloud9 Industrial Broadcast Console</div>
            </div>
          </div>

          <div className="controls-cluster">
            <div className="segmented" role="tablist" aria-label="Esports Title">
              <button
                type="button"
                role="tab"
                aria-selected={title === 'val'}
                className={`segmented-btn ${title === 'val' ? 'is-active' : ''}`}
                onClick={() => setTitle('val')}
              >
                VALORANT (Cloud9)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={title === 'lol'}
                className={`segmented-btn ${title === 'lol' ? 'is-active' : ''}`}
                onClick={() => setTitle('lol')}
              >
                LoL (Cloud9 Kia)
              </button>
            </div>

            <nav className="segmented" aria-label="Workspace views">
              <button
                type="button"
                className={`segmented-btn ${view === 'match' ? 'is-active' : ''}`}
                onClick={() => setView('match')}
              >
                Match Deep-Dive
              </button>
              <button
                type="button"
                className={`segmented-btn ${view === 'scouting' ? 'is-active' : ''}`}
                onClick={() => setView('scouting')}
              >
                Scouting Dossier
              </button>
              <button
                type="button"
                className={`segmented-btn ${view === 'index' ? 'is-active' : ''}`}
                onClick={() => setView('index')}
              >
                Franchise Index
              </button>
            </nav>

            {view === 'match' && activeSeriesList.length > 0 && (
              <select
                aria-label="Select Cloud9 Match Feed"
                className="series-select"
                value={activeSeriesId}
                onChange={(e) => {
                  if (title === 'val') setValSeriesId(e.target.value);
                  else setLolSeriesId(e.target.value);
                }}
              >
                {activeSeriesList.map((s) => (
                  <option key={s.series_id} value={s.series_id}>
                    #{s.series_id} {s.c9_team_name} vs {s.opponent_name} ({s.series_score})
                  </option>
                ))}
              </select>
            )}

            <span className="telemetry-pill">
              <span className="live-dot" aria-hidden="true" />
              GRID ZSTD LIVE
            </span>
          </div>
        </div>
      </header>

      <main className="workspace">
        {overviewError && (
          <div className="status-banner is-error">
            <span>Backend connection error: {overviewError}</span>
          </div>
        )}

        {view === 'match' && seriesError && (
          <div className="status-banner is-error">
            <span>Stream error: {seriesError}</span>
          </div>
        )}

        {view === 'match' &&
          seriesLoading &&
          (title === 'val'
            ? !valData || valData.series_id !== valSeriesId
            : !lolData || lolData.series_id !== lolSeriesId) && (
            <div className="status-banner">
              <span className="mono">
                Streaming real GRID .jsonl.zst telemetry for series #{activeSeriesId}…
              </span>
            </div>
          )}

        {view === 'match' && title === 'val' && valData && <ValDeepDive series={valData} />}

        {view === 'match' && title === 'lol' && lolData && <LolMacroView series={lolData} />}

        {view === 'scouting' && (
          <ScoutingDossierView title={title} onOpenLocalSeries={handleOpenLocalSeries} />
        )}

        {view === 'index' && overview && (
          <FranchiseIndexView overview={overview} onOpenLocalSeries={handleOpenLocalSeries} />
        )}
      </main>

      <footer className="footer-bar">
        <span>
          STRATA9 / Sky&apos;s The Limit 2026 (Cloud9 x JetBrains Hackathon), read-only{' '}
          <code className="mono">STL_DATA_DIR</code>
        </span>
        <span>
          Telemetry copyright GRID eSports GmbH and Riot Games, Inc. Supplements copyright 2026 Cloud9 Esports, Inc.
        </span>
      </footer>
    </div>
  );
}
