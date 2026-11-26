import { type PointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import type { TelestratorAnnotationSummary, TelestratorBoardAttachment } from '../types';

export type TelestratorTool = 'arrow' | 'ring' | 'freehand';

export interface TelestratorColor {
  id: 'gold' | 'crimson' | 'emerald' | 'ivory';
  label: string;
  hex: string;
  swatchClass: string;
}

export const TELESTRATOR_COLORS: readonly TelestratorColor[] = [
  { id: 'gold', label: 'Molten Gold', hex: '#D99B26', swatchClass: 'pen-swatch-gold' },
  { id: 'crimson', label: 'Crimson Flame', hex: '#D9483B', swatchClass: 'pen-swatch-crimson' },
  { id: 'emerald', label: 'Emerald Signal', hex: '#1E9E6A', swatchClass: 'pen-swatch-emerald' },
  { id: 'ivory', label: 'Warm Ivory', hex: '#F5F2EB', swatchClass: 'pen-swatch-ivory' },
] as const;

export interface TelestratorStroke {
  id: string;
  tool: TelestratorTool;
  color: TelestratorColor;
  points: Array<[number, number]>;
  label?: string;
}

interface TelestratorOverlayProps {
  baseCanvasRef: RefObject<HTMLCanvasElement | null>;
  mapName: string;
  roundNumber: number;
  playheadSec: number;
  attachedBoard?: TelestratorBoardAttachment | null;
  onAttachBoard?: (attachment: TelestratorBoardAttachment | null) => void;
  children: ReactNode;
}

const SVG_W = 1000;
const SVG_H = 560;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function dist2d(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function computeArrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number,
): [number, number, number, number] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 6.5;
  const ax = x2 - headLen * Math.cos(angle - spread);
  const ay = y2 - headLen * Math.sin(angle - spread);
  const bx = x2 - headLen * Math.cos(angle + spread);
  const by = y2 - headLen * Math.sin(angle + spread);
  return [ax, ay, bx, by];
}

export function buildBoardFilename(mapName: string, roundNumber: number): string {
  const safeMap = mapName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'map';
  return `strata9_tactical_board_${safeMap}_r${roundNumber}.png`;
}

export function summarizeTelestratorStrokes(
  strokes: TelestratorStroke[],
  mapName: string,
  roundNumber: number,
  playheadSec: number,
): TelestratorBoardAttachment {
  const annotations: TelestratorAnnotationSummary[] = strokes.map((s, idx) => {
    const start = s.points[0] ?? [0, 0];
    const end = s.points[s.points.length - 1] ?? start;
    let geometry = '';
    if (s.tool === 'arrow') {
      geometry = `vector (${Math.round(start[0] * 100)}%, ${Math.round(start[1] * 100)}%) -> (${Math.round(end[0] * 100)}%, ${Math.round(end[1] * 100)}%)`;
    } else if (s.tool === 'ring') {
      const rPct = Math.round(dist2d(start, end) * 100);
      geometry = `zone center (${Math.round(start[0] * 100)}%, ${Math.round(start[1] * 100)}%), radius ${rPct}%`;
    } else {
      geometry = `path (${s.points.length} pts) from (${Math.round(start[0] * 100)}%, ${Math.round(start[1] * 100)}%) to (${Math.round(end[0] * 100)}%, ${Math.round(end[1] * 100)}%)`;
    }
    return {
      index: idx + 1,
      tool: s.tool,
      color_name: s.color.label,
      color_hex: s.color.hex,
      label: s.label,
      geometry,
    };
  });

  return {
    map: mapName,
    round_number: roundNumber,
    playhead_sec: Number(playheadSec.toFixed(1)),
    board_filename: buildBoardFilename(mapName, roundNumber),
    stroke_count: strokes.length,
    annotations,
    captured_at: new Date().toISOString(),
  };
}

export function composeTacticalBoardPng(
  baseCanvas: HTMLCanvasElement | null,
  strokes: TelestratorStroke[],
  meta: { mapName: string; roundNumber: number; playheadSec: number },
): string | null {
  const out = document.createElement('canvas');
  const w = baseCanvas && baseCanvas.width > 0 ? baseCanvas.width : 1280;
  const h = baseCanvas && baseCanvas.height > 0 ? baseCanvas.height : 712;
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0B0C0D';
  ctx.fillRect(0, 0, w, h);
  if (baseCanvas && baseCanvas.width > 0 && baseCanvas.height > 0) {
    try {
      ctx.drawImage(baseCanvas, 0, 0, w, h);
    } catch {
      // Keep obsidian backdrop if source canvas cannot be copied
    }
  }

  const scale = Math.max(1, w / 640);

  for (const s of strokes) {
    if (s.points.length < 2) continue;
    const p0 = s.points[0];
    const pLast = s.points[s.points.length - 1];
    const x1 = p0[0] * w;
    const y1 = p0[1] * h;
    const x2 = pLast[0] * w;
    const y2 = pLast[1] * h;

    ctx.save();
    ctx.strokeStyle = s.color.hex;
    ctx.fillStyle = s.color.hex;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * scale;

    if (s.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const [ax, ay, bx, by] = computeArrowHead(x1, y1, x2, y2, 13 * scale);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.closePath();
      ctx.fill();
    } else if (s.tool === 'ring') {
      const r = Math.max(8 * scale, Math.hypot(x2 - x1, y2 - y1));
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1 - 5 * scale, y1);
      ctx.lineTo(x1 + 5 * scale, y1);
      ctx.moveTo(x1, y1 - 5 * scale);
      ctx.lineTo(x1, y1 + 5 * scale);
      ctx.stroke();
    } else {
      ctx.beginPath();
      s.points.forEach(([nx, ny], idx) => {
        if (idx === 0) ctx.moveTo(nx * w, ny * h);
        else ctx.lineTo(nx * w, ny * h);
      });
      ctx.stroke();
    }

    if (s.label) {
      const lx = s.tool === 'ring' ? x1 : x2;
      const ly = s.tool === 'ring' ? Math.max(24 * scale, y1 - Math.hypot(x2 - x1, y2 - y1) - 8 * scale) : y2 - 10 * scale;
      ctx.font = `700 ${Math.round(10 * scale)}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(s.label).width + 12 * scale;
      const th = 18 * scale;
      const bx = Math.max(6 * scale, Math.min(w - tw - 6 * scale, lx - tw / 2));
      const by = Math.max(6 * scale, Math.min(h - th - 6 * scale, ly - th));
      ctx.fillStyle = 'rgba(11, 12, 13, 0.9)';
      ctx.fillRect(bx, by, tw, th);
      ctx.strokeStyle = s.color.hex;
      ctx.lineWidth = 1.2 * scale;
      ctx.strokeRect(bx, by, tw, th);
      ctx.fillStyle = '#F5F2EB';
      ctx.fillText(s.label, bx + 6 * scale, by + 13 * scale);
    }
    ctx.restore();
  }

  // Broadcast tactical board footer badge
  const stamp = `STRATA9 TELESTRATOR | ${meta.mapName.toUpperCase()} R${meta.roundNumber} | T+${meta.playheadSec.toFixed(1)}s | ${strokes.length} MARKS`;
  ctx.font = `600 ${Math.round(9.5 * scale)}px "JetBrains Mono", monospace`;
  const stW = ctx.measureText(stamp).width + 16 * scale;
  const stH = 20 * scale;
  ctx.fillStyle = 'rgba(11, 12, 13, 0.88)';
  ctx.fillRect(w - stW - 8 * scale, h - stH - 6 * scale, stW, stH);
  ctx.strokeStyle = '#D99B26';
  ctx.lineWidth = 1 * scale;
  ctx.strokeRect(w - stW - 8 * scale, h - stH - 6 * scale, stW, stH);
  ctx.fillStyle = '#F5F2EB';
  ctx.fillText(stamp, w - stW, h - 12 * scale);

  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function TelestratorOverlay({
  baseCanvasRef,
  mapName,
  roundNumber,
  playheadSec,
  attachedBoard,
  onAttachBoard,
  children,
}: TelestratorOverlayProps) {
  const [tool, setTool] = useState<TelestratorTool>('arrow');
  const [color, setColor] = useState<TelestratorColor>(TELESTRATOR_COLORS[0]);
  const [calloutText, setCalloutText] = useState<string>('');
  const [strokes, setStrokes] = useState<TelestratorStroke[]>([]);
  const [draft, setDraft] = useState<TelestratorStroke | null>(null);
  const [attachedSignature, setAttachedSignature] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftRef = useRef<TelestratorStroke | null>(null);

  // Reset drawings cleanly when coach switches map or round
  useEffect(() => {
    draftRef.current = null;
    setStrokes([]);
    setDraft(null);
    setAttachedSignature(null);
    setNotice(null);
  }, [mapName, roundNumber]);

  const toNormalizedPoint = (e: PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 640;
    const h = rect.height > 0 ? rect.height : 356;
    return [clamp01((e.clientX - rect.left) / w), clamp01((e.clientY - rect.top) / h)];
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore in synthetic jsdom pointer events
      }
    }
    const pt = toNormalizedPoint(e);
    const cleanedLabel = calloutText.trim();
    const nextDraft: TelestratorStroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tool,
      color,
      points: [pt, pt],
      label: cleanedLabel || undefined,
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const current = draftRef.current;
    if (!current) return;
    const pt = toNormalizedPoint(e);
    let updated: TelestratorStroke;
    if (current.tool === 'freehand') {
      const last = current.points[current.points.length - 1];
      if (last && dist2d(last, pt) < 0.008) return;
      updated = { ...current, points: [...current.points, pt] };
    } else {
      updated = { ...current, points: [current.points[0], pt] };
    }
    draftRef.current = updated;
    setDraft(updated);
  };

  const commitDraft = () => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    const start = current.points[0];
    const end = current.points[current.points.length - 1];
    const moved = start && end ? dist2d(start, end) >= 0.015 || current.points.length >= 3 : false;
    if (moved) {
      setStrokes((prev) => [...prev, current]);
      if (current.label) setCalloutText('');
    }
  };

  const cancelDraft = () => {
    draftRef.current = null;
    setDraft(null);
  };

  const handleUndo = () => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    if (attachedBoard && attachedBoard.map === mapName && attachedBoard.round_number === roundNumber) {
      if (next.length === 0) {
        onAttachBoard?.(null);
        setAttachedSignature(null);
        setNotice('Last mark undone — detached from brief');
      } else {
        const synced = summarizeTelestratorStrokes(next, mapName, roundNumber, playheadSec);
        onAttachBoard?.(synced);
        setAttachedSignature(next.map((s) => s.id).join(','));
        setNotice(`Synced ${synced.stroke_count} marks to Coach .MD/.JSON Export`);
      }
    }
  };

  const handleClear = () => {
    draftRef.current = null;
    setStrokes([]);
    setDraft(null);
    setAttachedSignature(null);
    if (attachedBoard) {
      onAttachBoard?.(null);
      setNotice('Telestrator cleared — detached from brief');
    } else {
      setNotice('Telestrator cleared');
    }
  };

  const handleSavePng = () => {
    const dataUrl = composeTacticalBoardPng(baseCanvasRef.current, strokes, {
      mapName,
      roundNumber,
      playheadSec,
    });
    if (!dataUrl) {
      setNotice('Unable to composite PNG board');
      return;
    }
    const fname = buildBoardFilename(mapName, roundNumber);
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fname;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setNotice(`Saved ${fname}`);
  };

  const handleAttachBrief = () => {
    if (strokes.length === 0) return;
    const summary = summarizeTelestratorStrokes(strokes, mapName, roundNumber, playheadSec);
    onAttachBoard?.(summary);
    setAttachedSignature(strokes.map((s) => s.id).join(','));
    setNotice(`Attached ${summary.stroke_count} marks to Coach .MD/.JSON Export`);
  };

  const allStrokes = draft ? [...strokes, draft] : strokes;
  const currentSignature = strokes.map((s) => s.id).join(',');
  const isBoardAttached =
    Boolean(attachedBoard) &&
    strokes.length > 0 &&
    attachedBoard?.round_number === roundNumber &&
    attachedBoard?.map === mapName &&
    attachedBoard?.stroke_count === strokes.length &&
    (attachedSignature === null || attachedSignature === currentSignature);

  return (
    <div className="telestrator-shell" data-section="telestrator-overlay">
      <div className="canvas-stage telestrator-stage">
        {children}
        <svg
          className="telestrator-svg"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          role="application"
          aria-label={`Tactical Telestrator drawing layer for ${mapName} Round ${roundNumber}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitDraft}
          onPointerCancel={cancelDraft}
        >
          {allStrokes.map((s) => {
            if (s.points.length < 2) return null;
            if (
              draft &&
              s.id === draft.id &&
              dist2d(s.points[0], s.points[s.points.length - 1]) < 0.005 &&
              s.points.length < 3
            ) {
              return null;
            }
            const [nx1, ny1] = s.points[0];
            const [nx2, ny2] = s.points[s.points.length - 1];
            const x1 = nx1 * SVG_W;
            const y1 = ny1 * SVG_H;
            const x2 = nx2 * SVG_W;
            const y2 = ny2 * SVG_H;
            const rPx = Math.max(10, Math.hypot(x2 - x1, y2 - y1));
            const [ax, ay, bx, by] = computeArrowHead(x1, y1, x2, y2, 18);
            const polyPts = s.points.map(([px, py]) => `${(px * SVG_W).toFixed(1)},${(py * SVG_H).toFixed(1)}`).join(' ');
            const lx = s.tool === 'ring' ? x1 : x2;
            const ly = s.tool === 'ring' ? Math.max(24, y1 - rPx - 10) : Math.max(24, y2 - 12);

            return (
              <g key={s.id} data-stroke-tool={s.tool} data-stroke-color={s.color.hex}>
                {s.tool === 'arrow' && (
                  <>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={s.color.hex}
                      strokeWidth="4.2"
                      strokeLinecap="round"
                    />
                    <polygon points={`${x2},${y2} ${ax},${ay} ${bx},${by}`} fill={s.color.hex} />
                  </>
                )}
                {s.tool === 'ring' && (
                  <>
                    <circle
                      cx={x1}
                      cy={y1}
                      r={rPx}
                      fill="none"
                      stroke={s.color.hex}
                      strokeWidth="3.8"
                      strokeDasharray="10 6"
                    />
                    <line x1={x1 - 7} y1={y1} x2={x1 + 7} y2={y1} stroke={s.color.hex} strokeWidth="2.4" />
                    <line x1={x1} y1={y1 - 7} x2={x1} y2={y1 + 7} stroke={s.color.hex} strokeWidth="2.4" />
                  </>
                )}
                {s.tool === 'freehand' && (
                  <polyline
                    fill="none"
                    stroke={s.color.hex}
                    strokeWidth="3.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polyPts}
                  />
                )}
                {s.label && (
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    fill="#F5F2EB"
                    stroke="#0B0C0D"
                    strokeWidth="4"
                    paintOrder="stroke"
                    fontSize="15"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="telestrator-bar" aria-label="Telestrator tactical drawing controls">
        <div className="telestrator-row">
          <div className="segmented" role="group" aria-label="Telestrator drawing tools">
            {(
              [
                { id: 'arrow', label: 'Arrow' },
                { id: 'ring', label: 'Ring' },
                { id: 'freehand', label: 'Freehand' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`segmented-btn ${tool === t.id ? 'is-active' : ''}`}
                onClick={() => setTool(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="pen-palette" role="group" aria-label="Telestrator pen color">
            {TELESTRATOR_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pen-swatch ${c.swatchClass} ${color.id === c.id ? 'is-selected' : ''}`}
                aria-label={`Pen color ${c.label}`}
                aria-pressed={color.id === c.id}
                title={c.label}
                onClick={() => setColor(c)}
              />
            ))}
          </div>

          <div className="controls-cluster">
            <button type="button" className="chip-btn" disabled={strokes.length === 0} onClick={handleUndo}>
              Undo ({strokes.length})
            </button>
            <button type="button" className="chip-btn" disabled={strokes.length === 0} onClick={handleClear}>
              Clear
            </button>
          </div>
        </div>

        <div className="telestrator-row">
          <input
            type="text"
            className="coach-input telestrator-note-input"
            value={calloutText}
            onChange={(e) => setCalloutText(e.target.value)}
            aria-label="Tactical callout label"
            placeholder="Tag next stroke (e.g. A-Drop Crossfire, Smoke CT)..."
            maxLength={40}
          />
          <div className="controls-cluster">
            <button type="button" className="chip-btn" onClick={handleSavePng}>
              Save Tactical Board PNG
            </button>
            {onAttachBoard && (
              <button
                type="button"
                className="chip-btn"
                disabled={strokes.length === 0}
                onClick={handleAttachBrief}
              >
                {isBoardAttached ? 'Frame Attached to Brief' : 'Attach Frame to .MD Brief'}
              </button>
            )}
          </div>
        </div>

        {notice && (
          <div className="audit-strip" style={{ marginTop: 0 }} role="status" aria-live="polite">
            <span className="audit-chip mono">{notice}</span>
          </div>
        )}
      </div>
    </div>
  );
}
