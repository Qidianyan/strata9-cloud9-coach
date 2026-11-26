import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TelestratorBoardAttachment, ValMapData, ValReplayEvent, ValReplayTrack, ValRound } from '../types';
import { TelestratorOverlay } from './TelestratorOverlay';

interface RoundReplayCanvasProps {
  mapData: ValMapData;
  round: ValRound;
  c9Name: string;
  oppName: string;
  attachedBoard?: TelestratorBoardAttachment | null;
  onAttachBoard?: (attachment: TelestratorBoardAttachment | null) => void;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

function fmtSec(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

function interpolateTrack(
  track: ValReplayTrack,
  t: number,
): { nx: number; ny: number; trail: Array<[number, number]> } | null {
  const pts = track.samples;
  if (!pts.length) return null;

  const trail: Array<[number, number]> = [];
  if (t <= pts[0][0]) {
    return { nx: pts[0][1], ny: pts[0][2], trail: [[pts[0][1], pts[0][2]]] };
  }

  for (let i = 0; i < pts.length; i += 1) {
    const [ptT, px, py] = pts[i];
    if (ptT <= t) {
      trail.push([px, py]);
    } else {
      const prev = pts[i - 1];
      const dt = Math.max(0.001, ptT - prev[0]);
      const alpha = Math.max(0, Math.min(1, (t - prev[0]) / dt));
      const nx = prev[1] + (px - prev[1]) * alpha;
      const ny = prev[2] + (py - prev[2]) * alpha;
      trail.push([nx, ny]);
      return { nx, ny, trail };
    }
  }

  const last = pts[pts.length - 1];
  return { nx: last[1], ny: last[2], trail };
}

function describeEvent(ev: ValReplayEvent): string {
  if (ev.kind === 'kill') {
    return `${ev.killer} [${ev.weapon}] eliminated ${ev.victim}`;
  }
  if (ev.kind === 'plant') {
    return `${ev.player} planted Spike`;
  }
  if (ev.kind === 'begin_defuse') {
    return `${ev.player} tapped Spike defuse`;
  }
  if (ev.kind === 'defuse') {
    return `${ev.player} DEFUSED Spike`;
  }
  if (ev.kind === 'explode') {
    return 'Spike DETONATED';
  }
  return `${ev.player} cast ${ev.ability} (${ev.slot})`;
}

export function RoundReplayCanvas({
  mapData,
  round,
  c9Name,
  oppName,
  attachedBoard,
  onAttachBoard,
}: RoundReplayCanvasProps) {
  const replay = round.replay;
  const duration = Math.max(5, replay?.duration_sec ?? 60);
  const freezeEnd = replay?.freezetime_end_sec ?? 0;

  const initialTime = useMemo(() => {
    if (!replay || !replay.events.length) return freezeEnd;
    const keyEv =
      replay.events.find((e) => e.kind === 'plant') ??
      replay.events.find((e) => e.kind === 'kill') ??
      replay.events[Math.floor(replay.events.length / 2)];
    return keyEv ? Math.min(duration, Number((keyEv.t + 0.6).toFixed(1))) : freezeEnd;
  }, [replay, duration, freezeEnd]);

  const [playhead, setPlayhead] = useState<number>(initialTime);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setPlaying(false);
    setPlayhead(initialTime);
  }, [round.round_number, mapData.game_id, initialTime]);

  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      setPlayhead((prev) => {
        const next = prev + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, speed, duration]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !replay) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 356;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Obsidian Graphite Backdrop
    ctx.fillStyle = '#0B0C0D';
    ctx.fillRect(0, 0, cssW, cssH);

    const padX = 28;
    const padTop = 38;
    const padBottom = 26;
    const plotW = Math.max(120, cssW - padX * 2);
    const plotH = Math.max(120, cssH - padTop - padBottom);
    const toX = (nx: number) => padX + nx * plotW;
    const toY = (ny: number) => padTop + ny * plotH;

    // 2. Precision Grid & Bounds Frame
    ctx.strokeStyle = '#1D2024';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i += 1) {
      const gx = padX + (plotW / 8) * i;
      const gy = padTop + (plotH / 8) * i;
      ctx.beginPath();
      ctx.moveTo(gx, padTop);
      ctx.lineTo(gx, padTop + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padX, gy);
      ctx.lineTo(padX + plotW, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = '#363A40';
    ctx.strokeRect(padX, padTop, plotW, plotH);

    ctx.fillStyle = 'rgba(154, 158, 165, 0.16)';
    for (const ghost of mapData.spatial.ability_casts) {
      ctx.fillRect(toX(ghost.nx) - 1, toY(ghost.ny) - 1, 2, 2);
    }

    // 3. Player Trajectory Trails & Live Animated Pawns
    let c9Alive = 0;
    let oppAlive = 0;

    for (const tr of replay.tracks) {
      const isDead = tr.death_t !== null && playhead >= tr.death_t;
      if (!isDead) {
        if (tr.is_c9) c9Alive += 1;
        else oppAlive += 1;
      }

      const evalT = isDead && tr.death_t !== null ? tr.death_t : playhead;
      const state = interpolateTrack(tr, evalT);
      if (!state) continue;

      const baseCol = tr.is_c9 ? '#E8FF3B' : '#FF3B30';

      if (state.trail.length > 1) {
        ctx.save();
        ctx.strokeStyle = tr.is_c9 ? 'rgba(232, 255, 59, 0.36)' : 'rgba(255, 59, 48, 0.34)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        state.trail.forEach(([tx, ty], idx) => {
          if (idx === 0) ctx.moveTo(toX(tx), toY(ty));
          else ctx.lineTo(toX(tx), toY(ty));
        });
        ctx.stroke();
        ctx.restore();
      }

      const px = toX(state.nx);
      const py = toY(state.ny);

      if (isDead) {
        ctx.strokeStyle = tr.is_c9 ? 'rgba(232, 255, 59, 0.48)' : 'rgba(255, 59, 48, 0.48)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(px - 4.5, py - 4.5);
        ctx.lineTo(px + 4.5, py + 4.5);
        ctx.moveTo(px + 4.5, py - 4.5);
        ctx.lineTo(px - 4.5, py + 4.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = baseCol;
        ctx.strokeStyle = '#0B0C0D';
        ctx.lineWidth = 1.5;
        if (tr.is_c9) {
          ctx.beginPath();
          ctx.arc(px, py, 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(px, py - 6);
          ctx.lineTo(px + 6, py);
          ctx.lineTo(px, py + 6);
          ctx.lineTo(px - 6, py);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#F3F4F6';
        ctx.fillText(tr.name, px + 8, py + 3);
      }
    }

    // 4. Active Ability Ripples, Aim Vectors, Kill Tracers & Spike Beacons
    let spikeStatus = 'UNPLANTED';
    let spikePos: [number, number] | null = null;
    const recentKills: ValReplayEvent[] = [];

    for (const ev of replay.events) {
      if (ev.t > playhead) break;
      const age = playhead - ev.t;

      if (ev.kind === 'plant' && ev.nx !== undefined && ev.ny !== undefined) {
        spikeStatus = `PLANTED (${ev.player})`;
        spikePos = [toX(ev.nx), toY(ev.ny)];
      } else if (ev.kind === 'begin_defuse' && ev.nx !== undefined && ev.ny !== undefined) {
        spikeStatus = `DEFUSING (${ev.player})`;
        spikePos = [toX(ev.nx), toY(ev.ny)];
      } else if (ev.kind === 'defuse' && ev.nx !== undefined && ev.ny !== undefined) {
        spikeStatus = `DEFUSED (${ev.player})`;
        spikePos = [toX(ev.nx), toY(ev.ny)];
      } else if (ev.kind === 'explode' && ev.nx !== undefined && ev.ny !== undefined) {
        spikeStatus = 'DETONATED';
        spikePos = [toX(ev.nx), toY(ev.ny)];
      }

      if (ev.kind === 'ability' && age <= 3.2 && ev.nx !== undefined && ev.ny !== undefined) {
        const ax = toX(ev.nx);
        const ay = toY(ev.ny);
        const progress = age / 3.2;
        const alpha = Math.max(0.12, 1 - progress);
        const radius = 6 + progress * 24;
        const isUlt = ev.slot === 'ULTIMATE';
        const rgb = isUlt ? '52, 199, 89' : ev.is_c9 ? '232, 255, 59' : '255, 59, 48';

        ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
        ctx.lineWidth = isUlt ? 2.2 : 1.5;
        ctx.beginPath();
        ctx.arc(ax, ay, radius, 0, Math.PI * 2);
        ctx.stroke();

        if (ev.vx !== undefined && ev.vy !== undefined && (Math.abs(ev.vx) > 0.01 || Math.abs(ev.vy) > 0.01)) {
          const rayLen = isUlt ? 32 : 22;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + ev.vx * rayLen, ay - ev.vy * rayLen);
          ctx.stroke();
        }

        if (age <= 1.8 && ev.ability) {
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, alpha + 0.15).toFixed(2)})`;
          ctx.fillText(ev.ability.toUpperCase(), ax + 8, ay - 7);
        }
      }

      if (ev.kind === 'kill') {
        if (age <= 4.5) recentKills.push(ev);
        if (age <= 4.0 && ev.kx !== undefined && ev.ky !== undefined && ev.vx !== undefined && ev.vy !== undefined) {
          const alpha = Math.max(0.18, 1 - age / 4.0);
          const col = ev.is_c9 ? `rgba(232, 255, 59, ${alpha.toFixed(2)})` : `rgba(255, 59, 48, ${alpha.toFixed(2)})`;
          const kx = toX(ev.kx);
          const ky = toY(ev.ky);
          const vx = toX(ev.vx);
          const vy = toY(ev.vy);

          ctx.strokeStyle = col;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(vx, vy);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(vx, vy, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    if (spikePos) {
      const [sx, sy] = spikePos;
      const pulse = 9 + Math.sin(playhead * 6) * 3;
      const isDefused = spikeStatus.startsWith('DEFUSED');
      const spikeCol = isDefused ? '#34C759' : '#FF3B30';
      ctx.strokeStyle = spikeCol;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = spikeCol;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.fillText(`SPIKE ${spikeStatus}`, sx + 12, sy - 4);
    }

    // 5. Top Broadcast Canvas HUD Bar
    ctx.fillStyle = '#15171A';
    ctx.fillRect(0, 0, cssW, 28);
    ctx.strokeStyle = '#2A2D31';
    ctx.beginPath();
    ctx.moveTo(0, 28);
    ctx.lineTo(cssW, 28);
    ctx.stroke();

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#E8FF3B';
    ctx.fillText(`R${round.round_number} // ${mapData.map.toUpperCase()}`, 12, 18);

    ctx.fillStyle = '#F3F4F6';
    ctx.fillText(`T+${fmtSec(playhead)} / ${fmtSec(duration)}`, Math.min(200, cssW * 0.34), 18);

    ctx.fillStyle = '#34C759';
    const aliveTxt = `ALIVE ${c9Name} ${c9Alive}v${oppAlive} ${oppName}`;
    ctx.fillText(aliveTxt, Math.max(cssW - 220, cssW * 0.58), 18);

    ctx.font = '500 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#9A9EA5';
    ctx.fillText(
      `GRID TRACKS: ${replay.tracks.length} PLAYERS, ${replay.events.length} EVENTS, SPIKE: ${spikeStatus}`,
      padX,
      cssH - 8,
    );

    if (recentKills.length > 0) {
      const latest = recentKills[recentKills.length - 1];
      const label = `${latest.killer} [${latest.weapon}] > ${latest.victim}`;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 16;
      const bx = Math.max(padX + 6, cssW - padX - tw - 6);
      ctx.fillStyle = 'rgba(21, 23, 26, 0.92)';
      ctx.fillRect(bx, padTop + 8, tw, 22);
      ctx.strokeStyle = latest.is_c9 ? '#E8FF3B' : '#FF3B30';
      ctx.strokeRect(bx, padTop + 8, tw, 22);
      ctx.fillStyle = '#F3F4F6';
      ctx.fillText(label, bx + 8, padTop + 22);
    }

    ctx.restore();
  }, [mapData.map, mapData.spatial.ability_casts, round.round_number, replay, playhead, duration, c9Name, oppName]);

  useEffect(() => {
    drawFrame();
  }, [drawFrame]);

  useEffect(() => {
    const onResize = () => drawFrame();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawFrame]);

  if (!replay) {
    return (
      <section className="panel" aria-label="2D Round Tactical Replay">
        <p className="panel-subtitle">No replay trajectory data available for Round {round.round_number}.</p>
      </section>
    );
  }

  const keyEvents = replay.events.filter((e) => e.kind !== 'ability' || e.slot === 'ULTIMATE');
  // Display up to 6 key events cleanly without clipping behind panel boundaries
  const displayEvents = (keyEvents.length >= 4 ? keyEvents : replay.events).slice(0, 6);

  return (
    <section className="panel" aria-label="2D Dynamic Round Replay">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            01 // 2D Tactical Round Replay: R{round.round_number} ({mapData.map.toUpperCase()})
          </h2>
          <p className="panel-subtitle">
            Canvas2D playback from real GRID movement waypoints, kill vectors, and supplement aim rays
          </p>
        </div>
        <span className="badge badge-volt">
          {playing ? 'PLAYING' : 'PAUSED'} {speed}x
        </span>
      </div>

      <TelestratorOverlay
        baseCanvasRef={canvasRef}
        mapName={mapData.map}
        roundNumber={round.round_number}
        playheadSec={playhead}
        attachedBoard={attachedBoard}
        onAttachBoard={onAttachBoard}
      >
        <canvas
          ref={canvasRef}
          className="replay-canvas"
          aria-label={`Canvas2D animated round replay for ${mapData.map} Round ${round.round_number}`}
        />
      </TelestratorOverlay>

      <div className="replay-transport">
        <div className="transport-row">
          <div className="controls-cluster">
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                if (playhead >= duration - 0.1) setPlayhead(freezeEnd);
                setPlaying((p) => !p);
              }}
            >
              {playing ? 'Pause' : 'Play Round'}
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                setPlaying(false);
                setPlayhead(freezeEnd);
              }}
            >
              Barrier Drop
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => setPlayhead((t) => Math.max(0, Number((t - 3).toFixed(1))))}
            >
              -3s
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => setPlayhead((t) => Math.min(duration, Number((t + 3).toFixed(1))))}
            >
              +3s
            </button>
          </div>

          <div className="segmented" role="group" aria-label="Playback speed">
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                className={`segmented-btn ${speed === sp ? 'is-active' : ''}`}
                onClick={() => setSpeed(sp)}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        <div className="scrubber-wrap">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(duration, playhead)}
            aria-label="Round replay timeline scrubber"
            className="replay-range"
            onChange={(e) => {
              setPlaying(false);
              setPlayhead(Number(e.target.value));
            }}
          />
          <div className="event-tick-bar" aria-hidden="true">
            {replay.events.map((ev, idx) => {
              const leftPct = Math.max(0, Math.min(100, (ev.t / duration) * 100));
              const tickClass =
                ev.kind === 'kill'
                  ? 'tick-kill'
                  : ev.kind === 'plant' || ev.kind === 'defuse' || ev.kind === 'begin_defuse'
                    ? 'tick-spike'
                    : 'tick-ability';
              return (
                <span
                  key={`${ev.t}-${idx}`}
                  className={`event-tick ${tickClass}`}
                  style={{ left: `${leftPct}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="replay-event-log" aria-label="Round replay event timestamps">
        {displayEvents.map((ev, idx) => {
          const isCurrent = Math.abs(ev.t - playhead) <= 1.2;
          const kindClass =
            ev.kind === 'kill'
              ? 'text-crimson'
              : ev.kind === 'plant' || ev.kind === 'defuse'
                ? 'text-green'
                : 'text-volt';
          return (
            <button
              key={`${ev.kind}-${ev.t}-${idx}`}
              type="button"
              className={`replay-ev-btn ${isCurrent ? 'is-current' : ''}`}
              onClick={() => {
                setPlaying(false);
                setPlayhead(Math.min(duration, ev.t + 0.15));
              }}
            >
              <span className="mono text-muted">{fmtSec(ev.t)}</span>
              <span className={`mono ${kindClass}`}>{ev.kind.toUpperCase()}</span>
              <span className="text-primary">{describeEvent(ev)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
