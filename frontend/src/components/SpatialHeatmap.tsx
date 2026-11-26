import { useMemo, useState } from 'react';
import type { ValMapData, ValSpatialCast } from '../types';

interface SpatialHeatmapProps {
  mapData: ValMapData;
  selectedRound: number;
  c9Name: string;
  oppName: string;
}

type TeamFilter = 'both' | 'c9' | 'opp';
type ScopeMode = 'all' | 'round';
type SlotFilter = 'ALL' | 'ABILITY_1' | 'ABILITY_2' | 'GRENADE' | 'ULTIMATE';

export function SpatialHeatmap({ mapData, selectedRound, c9Name, oppName }: SpatialHeatmapProps) {
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('both');
  const [scope, setScope] = useState<ScopeMode>('all');
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('ALL');
  const [showGrid, setShowGrid] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [showKills, setShowKills] = useState(true);
  const [hovered, setHovered] = useState<ValSpatialCast | null>(null);

  const filteredCasts = useMemo(() => {
    return mapData.spatial.ability_casts.filter((c) => {
      if (scope === 'round' && c.round !== selectedRound) return false;
      if (teamFilter === 'c9' && !c.is_c9) return false;
      if (teamFilter === 'opp' && c.is_c9) return false;
      if (slotFilter !== 'ALL' && c.slot !== slotFilter) return false;
      return true;
    });
  }, [mapData.spatial.ability_casts, scope, selectedRound, teamFilter, slotFilter]);

  const filteredKills = useMemo(() => {
    return mapData.spatial.opening_kills.filter((k) => {
      if (scope === 'round' && k.round !== selectedRound) return false;
      if (teamFilter === 'c9' && !k.is_c9) return false;
      if (teamFilter === 'opp' && k.is_c9) return false;
      return true;
    });
  }, [mapData.spatial.opening_kills, scope, selectedRound, teamFilter]);

  const densityCells = useMemo(() => {
    const gSize = mapData.spatial.grid_size || 18;
    const mapCounts = new Map<string, { gx: number; gy: number; c9: number; opp: number }>();
    for (const c of filteredCasts) {
      const gx = Math.min(gSize - 1, Math.max(0, Math.floor(c.nx * gSize)));
      const gy = Math.min(gSize - 1, Math.max(0, Math.floor(c.ny * gSize)));
      const key = `${gx}:${gy}`;
      const existing = mapCounts.get(key) ?? { gx, gy, c9: 0, opp: 0 };
      if (c.is_c9) existing.c9 += 1;
      else existing.opp += 1;
      mapCounts.set(key, existing);
    }
    let peak = 1;
    for (const cell of mapCounts.values()) {
      peak = Math.max(peak, cell.c9 + cell.opp);
    }
    return Array.from(mapCounts.values()).map((cell) => ({
      ...cell,
      total: cell.c9 + cell.opp,
      intensity: (cell.c9 + cell.opp) / peak,
      c9Dominant: cell.c9 >= cell.opp,
    }));
  }, [filteredCasts, mapData.spatial.grid_size]);

  const W = 560;
  const H = 440;
  const pad = 28;
  const plotW = W - pad * 2;
  const plotH = H - pad * 2;
  const gSize = mapData.spatial.grid_size || 18;
  const cellW = plotW / gSize;
  const cellH = plotH / gSize;

  return (
    <section className="panel" aria-label="2D Ability-Cast Spatial Heatmap">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            04 // Spatial Ability-Cast Radar: {mapData.map.toUpperCase()}
          </h2>
          <p className="panel-subtitle">
            Real 3D positions and aim vectors joined from{' '}
            <code className="mono">val-ability-supplements</code> ({filteredCasts.length} casts plotted)
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Round scope">
          <button
            type="button"
            className={`segmented-btn ${scope === 'all' ? 'is-active' : ''}`}
            onClick={() => setScope('all')}
          >
            All Rounds
          </button>
          <button
            type="button"
            className={`segmented-btn ${scope === 'round' ? 'is-active' : ''}`}
            onClick={() => setScope('round')}
          >
            Round {selectedRound}
          </button>
        </div>
      </div>

      <div className="heatmap-controls">
        {(['both', 'c9', 'opp'] as TeamFilter[]).map((tf) => (
          <button
            key={tf}
            type="button"
            className={`chip-btn ${teamFilter === tf ? 'is-active' : ''}`}
            onClick={() => setTeamFilter(tf)}
          >
            {tf === 'both' ? 'Both Teams' : tf === 'c9' ? c9Name : oppName}
          </button>
        ))}

        <button
          type="button"
          className={`chip-btn ${showGrid ? 'is-active' : ''}`}
          onClick={() => setShowGrid((v) => !v)}
        >
          {showGrid ? 'Heat Grid: On' : 'Heat Grid: Off'}
        </button>
        <button
          type="button"
          className={`chip-btn ${showVectors ? 'is-active' : ''}`}
          onClick={() => setShowVectors((v) => !v)}
        >
          {showVectors ? 'Aim Rays: On' : 'Aim Rays: Off'}
        </button>
        <button
          type="button"
          className={`chip-btn ${showKills ? 'is-active' : ''}`}
          onClick={() => setShowKills((v) => !v)}
        >
          {showKills ? 'Opening Kills: On' : 'Opening Kills: Off'}
        </button>

        <select
          aria-label="Filter ability slot"
          className="chip-btn"
          value={slotFilter}
          onChange={(e) => setSlotFilter(e.target.value as SlotFilter)}
        >
          <option value="ALL">All Slots</option>
          <option value="ABILITY_1">Ability 1</option>
          <option value="ABILITY_2">Ability 2</option>
          <option value="GRENADE">Signature / Grenade</option>
          <option value="ULTIMATE">Ultimate</option>
        </select>
      </div>

      <div className="svg-stage">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`2D spatial heatmap of ${filteredCasts.length} ability casts on ${mapData.map}`}
          style={{ display: 'block' }}
        >
          {Array.from({ length: 7 }).map((_, idx) => {
            const x = pad + (plotW / 6) * idx;
            const y = pad + (plotH / 6) * idx;
            return (
              <g key={idx}>
                <line x1={x} y1={pad} x2={x} y2={H - pad} stroke="#1D2024" strokeWidth="1" />
                <line x1={pad} y1={y} x2={W - pad} y2={y} stroke="#1D2024" strokeWidth="1" />
              </g>
            );
          })}
          <rect x={pad} y={pad} width={plotW} height={plotH} fill="none" stroke="#363A40" strokeWidth="1.2" />

          <text x={pad + 4} y={18} fill="#9A9EA5" fontSize="10" fontFamily="JetBrains Mono, monospace">
            X[{Math.round(mapData.bounds.min_x)}, {Math.round(mapData.bounds.max_x)}] cm
          </text>
          <text
            x={W - pad}
            y={18}
            textAnchor="end"
            fill="#9A9EA5"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            Y[{Math.round(mapData.bounds.min_y)}, {Math.round(mapData.bounds.max_y)}] cm
          </text>

          {showGrid &&
            densityCells.map((cell) => {
              const alpha = 0.1 + cell.intensity * 0.44;
              const fill = cell.c9Dominant
                ? `rgba(232, 255, 59, ${alpha.toFixed(2)})`
                : `rgba(255, 59, 48, ${alpha.toFixed(2)})`;
              return (
                <rect
                  key={`${cell.gx}-${cell.gy}`}
                  x={pad + cell.gx * cellW}
                  y={pad + cell.gy * cellH}
                  width={cellW - 1}
                  height={cellH - 1}
                  rx={2}
                  fill={fill}
                />
              );
            })}

          {filteredCasts.map((c) => {
            const cx = pad + c.nx * plotW;
            const cy = pad + c.ny * plotH;
            const rayLen = c.slot === 'ULTIMATE' ? 18 : 12;
            const vx = c.vx * rayLen;
            const vy = -c.vy * rayLen;
            const isHovered = hovered?.grid_event_id === c.grid_event_id;
            const strokeColor = c.is_c9 ? '#E8FF3B' : '#FF7A72';
            const fillColor = c.is_c9 ? '#E8FF3B' : '#FF3B30';

            return (
              <g
                key={c.grid_event_id}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered((prev) => (prev?.grid_event_id === c.grid_event_id ? null : prev))}
                style={{ cursor: 'crosshair' }}
              >
                {showVectors && (Math.abs(c.vx) > 0.01 || Math.abs(c.vy) > 0.01) && (
                  <line
                    x1={cx}
                    y1={cy}
                    x2={cx + vx}
                    y2={cy + vy}
                    stroke={strokeColor}
                    strokeOpacity={isHovered ? 1 : 0.65}
                    strokeWidth={isHovered ? 2 : 1.1}
                  />
                )}
                {c.slot === 'ULTIMATE' && (
                  <circle cx={cx} cy={cy} r={6.5} fill="none" stroke="#34C759" strokeWidth="1.5" />
                )}
                {c.is_c9 ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 5.2 : 3.2}
                    fill={fillColor}
                    stroke="#0B0C0D"
                    strokeWidth="0.8"
                  />
                ) : (
                  <rect
                    x={cx - (isHovered ? 4 : 2.8)}
                    y={cy - (isHovered ? 4 : 2.8)}
                    width={isHovered ? 8 : 5.6}
                    height={isHovered ? 8 : 5.6}
                    transform={`rotate(45 ${cx} ${cy})`}
                    fill={fillColor}
                    stroke="#0B0C0D"
                    strokeWidth="0.8"
                  />
                )}
              </g>
            );
          })}

          {showKills &&
            filteredKills.map((k, idx) => {
              const kx = pad + k.nx * plotW;
              const ky = pad + k.ny * plotH;
              const col = k.is_c9 ? '#34C759' : '#F3F4F6';
              return (
                <g key={`${k.round}-${idx}`}>
                  <line x1={kx - 5} y1={ky - 5} x2={kx + 5} y2={ky + 5} stroke={col} strokeWidth="1.8" />
                  <line x1={kx + 5} y1={ky - 5} x2={kx - 5} y2={ky + 5} stroke={col} strokeWidth="1.8" />
                </g>
              );
            })}

          <text x={pad + 4} y={H - 10} fill="#9A9EA5" fontSize="10" fontFamily="JetBrains Mono, monospace">
            SCOPE: {scope === 'all' ? `ALL ${mapData.total_rounds} ROUNDS` : `ROUND ${selectedRound}`} /{' '}
            {filteredCasts.length} CASTS / {filteredKills.length} OPENING KILLS
          </text>
        </svg>
      </div>

      <div className="spatial-readout">
        {hovered ? (
          <>
            <span>
              <strong>{hovered.player_name}</strong> ({hovered.agent}),{' '}
              <span className="text-volt">{hovered.ability}</span> [{hovered.slot}], R{hovered.round}
            </span>
            <span>
              POS ({Math.round(hovered.x)}, {Math.round(hovered.y)}, {Math.round(hovered.z)}) / AIM (
              {hovered.vx.toFixed(2)}, {hovered.vy.toFixed(2)}) / Q:{hovered.quality}
            </span>
          </>
        ) : (
          <span>
            Hover any ability node on the radar to inspect exact 3D caster coordinates, aim ray vector, and
            supplement quality flag.
          </span>
        )}
      </div>

      <div className="legend-row">
        <span className="legend-item">
          <span aria-hidden="true" className="swatch-volt-dot" />
          {c9Name} Cast (Circle)
        </span>
        <span className="legend-item">
          <span aria-hidden="true" className="swatch-crimson-diamond" />
          {oppName} Cast (Diamond)
        </span>
        <span className="legend-item">
          <span aria-hidden="true" className="swatch-ult-ring" />
          Ultimate Halo
        </span>
        <span className="legend-item">
          <span aria-hidden="true" className="text-green">
            X
          </span>
          Opening Kill
        </span>
      </div>
    </section>
  );
}
