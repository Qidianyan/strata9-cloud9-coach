import { useEffect, useRef, useState } from 'react';
import { requestWhatIfSimulation } from '../api';
import type { TitleId, WhatIfRequestPayload, WhatIfResponse } from '../types';

export interface ValWhatIfSeed {
  map: string;
  side: 'attacker' | 'defender';
  econDiff: number;
  buyTier: 'eco' | 'pistol' | 'half_buy' | 'force_buy' | 'full_buy';
  firstKill: 'opp' | 'none' | 'c9';
  siteState: 'unplanted' | 'planted_default' | 'planted_crossfire' | 'save_weapons';
  label: string;
}

export interface LolWhatIfSeed {
  gameMinute: number;
  goldDiff: number;
  dragonDiff: number;
  label: string;
}

interface WhatIfSimulatorProps {
  title: TitleId;
  valSeed?: ValWhatIfSeed;
  lolSeed?: LolWhatIfSeed;
  attachedResult?: WhatIfResponse | null;
  onAttachToBrief?: (result: WhatIfResponse) => void;
}

const VAL_BUY_OPTIONS: Array<{ value: NonNullable<WhatIfRequestPayload['buy_tier']>; label: string }> = [
  { value: 'eco', label: 'Eco' },
  { value: 'pistol', label: 'Pistol' },
  { value: 'half_buy', label: 'Half' },
  { value: 'force_buy', label: 'Force' },
  { value: 'full_buy', label: 'Full Buy' },
];

const VAL_SITE_OPTIONS: Array<{ value: NonNullable<WhatIfRequestPayload['site_state']>; label: string }> = [
  { value: 'unplanted', label: 'Unplanted' },
  { value: 'planted_default', label: 'Spike Planted' },
  { value: 'planted_crossfire', label: 'Post-Plant Crossfire' },
  { value: 'save_weapons', label: 'Save Rifles' },
];

const LOL_OBJ_OPTIONS: Array<{
  value: NonNullable<WhatIfRequestPayload['objective_decision']>;
  label: string;
}> = [
  { value: 'concede_objective', label: 'Concede Pit' },
  { value: 'trade_crossmap_tower', label: 'Cross-Map Tower' },
  { value: 'neutral_lane_reset', label: 'Wave Reset' },
  { value: 'contest_dragon', label: 'Contest Drake' },
  { value: 'secure_atakhan', label: 'Secure Atakhan' },
  { value: 'secure_dragon_soul', label: 'Dragon Soul' },
  { value: 'secure_baron', label: 'Commit Baron' },
];

export function WhatIfSimulator({
  title,
  valSeed,
  lolSeed,
  attachedResult,
  onAttachToBrief,
}: WhatIfSimulatorProps) {
  // VALORANT state
  const [side, setSide] = useState<'attacker' | 'defender'>(valSeed?.side ?? 'attacker');
  const [econDiff, setEconDiff] = useState<number>(valSeed?.econDiff ?? 0);
  const [buyTier, setBuyTier] = useState<NonNullable<WhatIfRequestPayload['buy_tier']>>(
    valSeed?.buyTier ?? 'full_buy',
  );
  const [siteState, setSiteState] = useState<NonNullable<WhatIfRequestPayload['site_state']>>(
    valSeed?.siteState ?? 'unplanted',
  );
  const [firstKill, setFirstKill] = useState<NonNullable<WhatIfRequestPayload['first_kill']>>(
    valSeed?.firstKill ?? 'none',
  );

  // LoL state
  const [gameMinute, setGameMinute] = useState<number>(lolSeed?.gameMinute ?? 22);
  const [goldDiff, setGoldDiff] = useState<number>(lolSeed?.goldDiff ?? 0);
  const [objectiveDecision, setObjectiveDecision] = useState<
    NonNullable<WhatIfRequestPayload['objective_decision']>
  >('neutral_lane_reset');
  const [dragonDiff, setDragonDiff] = useState<number>(lolSeed?.dragonDiff ?? 0);

  // Shared manpower state
  const [c9Alive, setC9Alive] = useState<number>(5);
  const [oppAlive, setOppAlive] = useState<number>(5);

  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const reqSeqRef = useRef(0);

  const alignedValEcon = Math.max(-20000, Math.min(20000, Math.round((valSeed?.econDiff ?? 0) / 100) * 100));
  const alignedLolGold = Math.max(-15000, Math.min(15000, Math.round((lolSeed?.goldDiff ?? 0) / 100) * 100));

  // Re-seed sliders whenever selected round / map / game changes
  useEffect(() => {
    if (title === 'val' && valSeed) {
      setSide(valSeed.side);
      setEconDiff(alignedValEcon);
      setBuyTier(valSeed.buyTier);
      setSiteState(valSeed.siteState);
      setFirstKill(valSeed.firstKill);
      setC9Alive(5);
      setOppAlive(5);
    } else if (title === 'lol' && lolSeed) {
      setGameMinute(Math.max(8, Math.min(45, lolSeed.gameMinute)));
      setGoldDiff(alignedLolGold);
      setDragonDiff(Math.max(-4, Math.min(4, lolSeed.dragonDiff)));
      setObjectiveDecision('neutral_lane_reset');
      setC9Alive(5);
      setOppAlive(5);
    }
  }, [
    title,
    valSeed?.map,
    valSeed?.side,
    alignedValEcon,
    valSeed?.buyTier,
    valSeed?.firstKill,
    valSeed?.siteState,
    lolSeed?.gameMinute,
    alignedLolGold,
    lolSeed?.dragonDiff,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const mySeq = ++reqSeqRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const payload: WhatIfRequestPayload =
        title === 'val'
          ? {
              title: 'val',
              map: valSeed?.map ?? 'all',
              baseline_side: valSeed?.side ?? 'attacker',
              side,
              baseline_econ_diff: alignedValEcon,
              econ_diff: econDiff,
              baseline_buy_tier: valSeed?.buyTier ?? 'full_buy',
              buy_tier: buyTier,
              baseline_c9_alive: 5,
              baseline_opp_alive: 5,
              c9_alive: c9Alive,
              opp_alive: oppAlive,
              baseline_site_state: valSeed?.siteState ?? 'unplanted',
              site_state: siteState,
              baseline_first_kill: valSeed?.firstKill ?? 'none',
              first_kill: firstKill,
            }
          : {
              title: 'lol',
              game_minute: gameMinute,
              baseline_gold_diff: alignedLolGold,
              gold_diff: goldDiff,
              baseline_c9_alive: 5,
              baseline_opp_alive: 5,
              c9_alive: c9Alive,
              opp_alive: oppAlive,
              baseline_objective_decision: 'neutral_lane_reset',
              objective_decision: objectiveDecision,
              baseline_dragon_diff: lolSeed?.dragonDiff ?? 0,
              dragon_diff: dragonDiff,
            };

      requestWhatIfSimulation(payload, controller.signal)
        .then((res) => {
          if (mySeq !== reqSeqRef.current) return;
          setResult(res);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (mySeq !== reqSeqRef.current) return;
          setError(err instanceof Error ? err.message : 'Simulation failed');
          setLoading(false);
        });
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    title,
    valSeed?.map,
    valSeed?.econDiff,
    valSeed?.buyTier,
    valSeed?.siteState,
    valSeed?.firstKill,
    lolSeed?.goldDiff,
    lolSeed?.dragonDiff,
    side,
    econDiff,
    buyTier,
    siteState,
    firstKill,
    gameMinute,
    goldDiff,
    objectiveDecision,
    dragonDiff,
    c9Alive,
    oppAlive,
  ]);

  const applyPreset = (preset: string) => {
    if (title === 'val') {
      if (preset === 'force_spike') {
        setSide('attacker');
        setBuyTier('force_buy');
        setEconDiff(2000);
        setFirstKill('c9');
        setSiteState('planted_crossfire');
        setC9Alive(4);
        setOppAlive(3);
      } else if (preset === 'save_rifles') {
        setSide('defender');
        setBuyTier('eco');
        setEconDiff(-6000);
        setFirstKill('opp');
        setSiteState('save_weapons');
        setC9Alive(2);
        setOppAlive(4);
      } else if (preset === 'man_adv') {
        setSide('attacker');
        setBuyTier('full_buy');
        setEconDiff(4000);
        setFirstKill('c9');
        setSiteState('planted_default');
        setC9Alive(5);
        setOppAlive(3);
      } else if (preset === 'reset') {
        setSide(valSeed?.side ?? 'attacker');
        setEconDiff(alignedValEcon);
        setBuyTier(valSeed?.buyTier ?? 'full_buy');
        setSiteState(valSeed?.siteState ?? 'unplanted');
        setFirstKill(valSeed?.firstKill ?? 'none');
        setC9Alive(5);
        setOppAlive(5);
      }
    } else {
      if (preset === 'baron_push') {
        setGoldDiff(Math.min(15000, Math.max(2500, goldDiff + 2500)));
        setObjectiveDecision('secure_baron');
        setC9Alive(5);
        setOppAlive(3);
      } else if (preset === 'concede_crossmap') {
        setGoldDiff(-3500);
        setObjectiveDecision('trade_crossmap_tower');
        setC9Alive(4);
        setOppAlive(5);
      } else if (preset === 'dragon_soul') {
        setObjectiveDecision('secure_dragon_soul');
        setDragonDiff(Math.min(4, Math.max(2, dragonDiff + 1)));
        setC9Alive(5);
        setOppAlive(4);
      } else if (preset === 'reset') {
        setGameMinute(Math.max(8, Math.min(45, lolSeed?.gameMinute ?? 22)));
        setGoldDiff(alignedLolGold);
        setDragonDiff(Math.max(-4, Math.min(4, lolSeed?.dragonDiff ?? 0)));
        setObjectiveDecision('neutral_lane_reset');
        setC9Alive(5);
        setOppAlive(5);
      }
    }
  };

  const basePct = result ? +(result.baselineWinProb * 100).toFixed(1) : 50;
  const simPct = result ? +(result.simulatedWinProb * 100).toFixed(1) : 50;
  const ciLowPct = result ? +(result.wilson_ci_low * 100).toFixed(1) : 40;
  const ciHighPct = result ? +(result.wilson_ci_high * 100).toFixed(1) : 60;
  const delta = result ? result.deltaWinPct : 0;
  const isAttached =
    Boolean(attachedResult && result) &&
    attachedResult?.simulatedWinProb === result?.simulatedWinProb &&
    attachedResult?.deltaWinPct === result?.deltaWinPct;

  const contextLabel = title === 'val' ? (valSeed?.label ?? 'VALORANT Round') : (lolSeed?.label ?? 'LoL Macro State');

  return (
    <section className="panel" aria-label="Interactive Tactical What-If Simulator" data-section="what-if-simulator">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">05 // Tactical What-If Win-Probability Sandbox</h2>
          <p className="panel-subtitle">
            Empirical GRID corpus model with Wilson 95% CI ({contextLabel})
          </p>
        </div>
        <div className="controls-cluster">
          {result && (
            <span className="badge badge-volt mono">
              n={result.effective_sample_n} ({result.corpus_matches_used} series)
            </span>
          )}
          {onAttachToBrief && (
            <button
              type="button"
              className="action-btn is-secondary"
              disabled={!result}
              onClick={() => result && onAttachToBrief(result)}
            >
              {isAttached ? 'Attached to Coach Export' : 'Attach What-If to Export'}
            </button>
          )}
        </div>
      </div>

      <div className="heatmap-controls">
        {title === 'val' ? (
          <>
            <button type="button" className="chip-btn" onClick={() => applyPreset('man_adv')}>
              Preset: 5v3 Full Execute
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('force_spike')}>
              Preset: Force + Crossfire
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('save_rifles')}>
              Preset: 2v4 Save Rifles
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('reset')}>
              Reset to Round Baseline
            </button>
          </>
        ) : (
          <>
            <button type="button" className="chip-btn" onClick={() => applyPreset('baron_push')}>
              Preset: 5v3 Baron Commit
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('dragon_soul')}>
              Preset: Dragon Soul Setup
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('concede_crossmap')}>
              Preset: Deficit Cross-Map
            </button>
            <button type="button" className="chip-btn" onClick={() => applyPreset('reset')}>
              Reset to Window Baseline
            </button>
          </>
        )}
      </div>

      <div className="whatif-grid">
        <div className="whatif-controls">
          {title === 'val' ? (
            <>
              <div className="whatif-field">
                <div className="whatif-field-head">
                  <label htmlFor="whatif-econ-slider">Economy Differential (Cloud9 vs Opp)</label>
                  <output htmlFor="whatif-econ-slider" className="mono text-volt">
                    {econDiff >= 0 ? '+' : ''}${econDiff.toLocaleString()}
                  </output>
                </div>
                <input
                  id="whatif-econ-slider"
                  type="range"
                  className="whatif-range"
                  min={-20000}
                  max={20000}
                  step={100}
                  value={econDiff}
                  onChange={(e) => setEconDiff(Number(e.target.value))}
                />
              </div>

              <div className="whatif-field">
                <span className="whatif-label">Buy Tier Strategy</span>
                <div className="segmented" role="group" aria-label="Buy Tier Strategy">
                  {VAL_BUY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`segmented-btn ${buyTier === opt.value ? 'is-active' : ''}`}
                      onClick={() => setBuyTier(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="whatif-field">
                <span className="whatif-label">Spike / Site Call</span>
                <div className="segmented" role="group" aria-label="Spike and Site Call">
                  {VAL_SITE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`segmented-btn ${siteState === opt.value ? 'is-active' : ''}`}
                      onClick={() => setSiteState(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="whatif-dual-row">
                <div className="whatif-field">
                  <span className="whatif-label">Opening Duel</span>
                  <div className="segmented" role="group" aria-label="Opening Duel Outcome">
                    {(['opp', 'none', 'c9'] as const).map((fk) => (
                      <button
                        key={fk}
                        type="button"
                        className={`segmented-btn ${firstKill === fk ? 'is-active' : ''}`}
                        onClick={() => setFirstKill(fk)}
                      >
                        {fk === 'c9' ? 'C9 First Kill' : fk === 'opp' ? 'Opp First Kill' : 'Neutral'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="whatif-field">
                  <span className="whatif-label">Side</span>
                  <div className="segmented" role="group" aria-label="Round Side">
                    {(['attacker', 'defender'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`segmented-btn ${side === s ? 'is-active' : ''}`}
                        onClick={() => setSide(s)}
                      >
                        {s === 'attacker' ? 'Attack' : 'Defense'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="whatif-field">
                <div className="whatif-field-head">
                  <label htmlFor="whatif-gold-slider">Team Gold Differential (Cloud9 Kia vs Opp)</label>
                  <output htmlFor="whatif-gold-slider" className="mono text-volt">
                    {goldDiff >= 0 ? '+' : ''}
                    {goldDiff.toLocaleString()}g
                  </output>
                </div>
                <input
                  id="whatif-gold-slider"
                  type="range"
                  className="whatif-range"
                  min={-15000}
                  max={15000}
                  step={100}
                  value={goldDiff}
                  onChange={(e) => setGoldDiff(Number(e.target.value))}
                />
              </div>

              <div className="whatif-field">
                <label htmlFor="whatif-obj-select" className="whatif-label">
                  Macro Objective Call
                </label>
                <select
                  id="whatif-obj-select"
                  className="series-select"
                  style={{ maxWidth: '100%', width: '100%' }}
                  value={objectiveDecision}
                  onChange={(e) =>
                    setObjectiveDecision(e.target.value as NonNullable<WhatIfRequestPayload['objective_decision']>)
                  }
                >
                  {LOL_OBJ_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="whatif-dual-row">
                <div className="whatif-field">
                  <div className="whatif-field-head">
                    <label htmlFor="whatif-minute-slider">Game Clock</label>
                    <output htmlFor="whatif-minute-slider" className="mono">
                      {gameMinute}:00
                    </output>
                  </div>
                  <input
                    id="whatif-minute-slider"
                    type="range"
                    className="whatif-range"
                    min={8}
                    max={45}
                    step={1}
                    value={gameMinute}
                    onChange={(e) => setGameMinute(Number(e.target.value))}
                  />
                </div>

                <div className="whatif-field">
                  <div className="whatif-field-head">
                    <label htmlFor="whatif-drake-slider">Dragon Differential</label>
                    <output htmlFor="whatif-drake-slider" className="mono">
                      {dragonDiff >= 0 ? `+${dragonDiff}` : dragonDiff}
                    </output>
                  </div>
                  <input
                    id="whatif-drake-slider"
                    type="range"
                    className="whatif-range"
                    min={-4}
                    max={4}
                    step={1}
                    value={dragonDiff}
                    onChange={(e) => setDragonDiff(Number(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          <div className="whatif-dual-row">
            <div className="whatif-field">
              <div className="whatif-field-head">
                <label htmlFor="whatif-c9-alive">Cloud9 Alive</label>
                <output htmlFor="whatif-c9-alive" className="mono text-volt">
                  {c9Alive} players
                </output>
              </div>
              <input
                id="whatif-c9-alive"
                type="range"
                className="whatif-range"
                min={1}
                max={5}
                step={1}
                value={c9Alive}
                onChange={(e) => setC9Alive(Number(e.target.value))}
              />
            </div>

            <div className="whatif-field">
              <div className="whatif-field-head">
                <label htmlFor="whatif-opp-alive">Opponent Alive</label>
                <output htmlFor="whatif-opp-alive" className="mono text-crimson">
                  {oppAlive} players
                </output>
              </div>
              <input
                id="whatif-opp-alive"
                type="range"
                className="whatif-range"
                min={1}
                max={5}
                step={1}
                value={oppAlive}
                onChange={(e) => setOppAlive(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="whatif-readout" aria-live="polite">
          {error && <div className="status-banner is-error">{error}</div>}

          <div className="whatif-metrics-row">
            <div className="mini-stat">
              <div className="mini-stat-label">Baseline Win Prob</div>
              <div className="whatif-big-num mono">{basePct.toFixed(1)}%</div>
              <div className="kpi-meta mono">
                {result
                  ? `CI ${(result.baseline_ci[0] * 100).toFixed(1)}-${(result.baseline_ci[1] * 100).toFixed(1)}%`
                  : 'Calibrating...'}
              </div>
            </div>

            <div className="mini-stat">
              <div className="mini-stat-label">Simulated Win Prob</div>
              <div className="whatif-big-num mono text-volt">{simPct.toFixed(1)}%</div>
              <div className="kpi-meta mono">
                Wilson 95% CI: {ciLowPct.toFixed(1)}% to {ciHighPct.toFixed(1)}%
              </div>
            </div>

            <div className="mini-stat">
              <div className="mini-stat-label">Delta Win% (EV)</div>
              <div
                className={`whatif-big-num mono ${
                  delta > 0.5 ? 'text-green' : delta < -0.5 ? 'text-crimson' : 'text-primary'
                }`}
              >
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(1)}pp
              </div>
              <div className="kpi-meta mono">{loading ? 'Recalculating...' : `Manpower ${c9Alive}v${oppAlive}`}</div>
            </div>
          </div>

          <div className="ci-meter-box">
            <div className="whatif-field-head">
              <span className="whatif-label">Calibrated Win Probability &amp; Wilson 95% CI Band</span>
              <span className="mono text-secondary">
                {ciLowPct.toFixed(1)}% [ {simPct.toFixed(1)}% ] {ciHighPct.toFixed(1)}%
              </span>
            </div>
            <div className="ci-track" role="img" aria-label={`Simulated win probability ${simPct}% with 95% confidence band ${ciLowPct}% to ${ciHighPct}%`}>
              <div className="ci-midline" aria-hidden="true" />
              <div
                className="ci-band"
                style={{
                  left: `${Math.max(0, Math.min(100, ciLowPct))}%`,
                  width: `${Math.max(2, Math.min(100, ciHighPct - ciLowPct))}%`,
                }}
              />
              <div
                className="ci-baseline-pin"
                style={{ left: `${Math.max(0, Math.min(100, basePct))}%` }}
                title={`Baseline: ${basePct}%`}
              />
              <div
                className="ci-sim-pin"
                style={{ left: `${Math.max(0, Math.min(100, simPct))}%` }}
                title={`Simulated: ${simPct}%`}
              />
            </div>
            <div className="ci-scale mono text-muted">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {result && (
            <div className="coach-brief-box">
              <p className="coach-summary">{result.coaching_decision}</p>
              <ul className="coach-bullets">
                {result.counter_actions.map((act, idx) => (
                  <li key={idx}>{act}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
