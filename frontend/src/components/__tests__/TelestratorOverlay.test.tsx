import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBriefMarkdown, buildBriefPayload } from '../../utils/briefExport';
import {
  TELESTRATOR_COLORS,
  TelestratorOverlay,
  composeTacticalBoardPng,
  summarizeTelestratorStrokes,
} from '../TelestratorOverlay';

function dragStroke(
  svg: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  mid?: { x: number; y: number },
) {
  fireEvent.pointerDown(svg, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
  if (mid) {
    fireEvent.pointerMove(svg, { clientX: mid.x, clientY: mid.y, pointerId: 1 });
  }
  fireEvent.pointerMove(svg, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

describe('TelestratorOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses strictly approved zero-blue/zero-purple broadcast pen colors', () => {
    const hexes = TELESTRATOR_COLORS.map((c) => c.hex);
    expect(hexes).toEqual(['#D99B26', '#D9483B', '#1E9E6A', '#F5F2EB']);
  });

  it('draws arrow, ring, and freehand strokes with callout tags and supports Undo/Clear', () => {
    const canvasRef = createRef<HTMLCanvasElement>();
    const { container } = render(
      <TelestratorOverlay baseCanvasRef={canvasRef} mapName="fracture" roundNumber={18} playheadSec={87.3}>
        <canvas ref={canvasRef} aria-label="Replay base canvas" width={640} height={356} />
      </TelestratorOverlay>,
    );

    const svg = screen.getByRole('application', { name: /Tactical Telestrator drawing layer/i });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 356,
      right: 640,
      bottom: 356,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 1. Arrow stroke with tag
    const noteInput = screen.getByLabelText(/Tactical callout label/i);
    fireEvent.change(noteInput, { target: { value: 'A-Drop Push' } });
    dragStroke(svg, { x: 120, y: 180 }, { x: 320, y: 120 });
    expect(container.querySelectorAll('g[data-stroke-tool="arrow"]')).toHaveLength(1);
    expect(screen.getByText('A-Drop Push')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo \(1\)/i })).not.toBeDisabled();

    // 2. Ring stroke in Crimson Flame
    fireEvent.click(screen.getByRole('button', { name: 'Ring' }));
    fireEvent.click(screen.getByRole('button', { name: /Pen color Crimson Flame/i }));
    dragStroke(svg, { x: 400, y: 200 }, { x: 470, y: 200 });
    expect(container.querySelectorAll('g[data-stroke-tool="ring"][data-stroke-color="#D9483B"]')).toHaveLength(1);

    // 3. Freehand stroke in Emerald Signal
    fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
    fireEvent.click(screen.getByRole('button', { name: /Pen color Emerald Signal/i }));
    dragStroke(svg, { x: 80, y: 240 }, { x: 260, y: 280 }, { x: 170, y: 250 });
    expect(container.querySelectorAll('g[data-stroke-tool="freehand"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Undo \(3\)/i })).toBeInTheDocument();

    // 4. Undo removes freehand, Clear empties all
    fireEvent.click(screen.getByRole('button', { name: /Undo \(3\)/i }));
    expect(container.querySelectorAll('g[data-stroke-tool="freehand"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Undo \(2\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(container.querySelectorAll('g[data-stroke-tool]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Undo \(0\)/i })).toBeDisabled();
  });

  it('composites base replay canvas and annotations into downloadable Tactical Board PNG', () => {
    const canvasRef = createRef<HTMLCanvasElement>();
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,iVBORw0KGgo=');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <TelestratorOverlay baseCanvasRef={canvasRef} mapName="fracture" roundNumber={18} playheadSec={87.3}>
        <canvas ref={canvasRef} aria-label="Replay base canvas" width={640} height={356} />
      </TelestratorOverlay>,
    );

    const svg = screen.getByRole('application', { name: /Tactical Telestrator drawing layer/i });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 356,
      right: 640,
      bottom: 356,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    dragStroke(svg, { x: 100, y: 100 }, { x: 280, y: 200 });
    fireEvent.click(screen.getByRole('button', { name: /Save Tactical Board PNG/i }));

    expect(toDataUrlSpy).toHaveBeenCalledWith('image/png');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved strata9_tactical_board_fracture_r18.png');

    const directUrl = composeTacticalBoardPng(canvasRef.current, [], {
      mapName: 'fracture',
      roundNumber: 18,
      playheadSec: 87.3,
    });
    expect(directUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('attaches telestrator frame summary and embeds annotations into Markdown and JSON briefs', () => {
    const canvasRef = createRef<HTMLCanvasElement>();
    const onAttach = vi.fn();

    render(
      <TelestratorOverlay
        baseCanvasRef={canvasRef}
        mapName="fracture"
        roundNumber={18}
        playheadSec={87.3}
        onAttachBoard={onAttach}
      >
        <canvas ref={canvasRef} aria-label="Replay base canvas" width={640} height={356} />
      </TelestratorOverlay>,
    );

    const svg = screen.getByRole('application', { name: /Tactical Telestrator drawing layer/i });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 356,
      right: 640,
      bottom: 356,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.change(screen.getByLabelText(/Tactical callout label/i), { target: { value: 'Retake Pin' } });
    dragStroke(svg, { x: 150, y: 120 }, { x: 360, y: 220 });

    fireEvent.click(screen.getByRole('button', { name: /Attach Frame to \.MD Brief/i }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    const attachment = onAttach.mock.calls[0][0];
    expect(attachment.stroke_count).toBe(1);
    expect(attachment.annotations[0].label).toBe('Retake Pin');

    const briefPayload = buildBriefPayload({
      title: 'val',
      seriesId: '2748746',
      mapIndex: 0,
      roundNumber: 18,
      contextLabel: 'FRACTURE R18',
      telemetry: {
        seriesLabel: 'Cloud9 vs NRG (2-0)',
        mapOrGame: 'FRACTURE (14-12)',
        roundNumber: 18,
        keyEvents: [],
        telestratorBoard: attachment,
      },
      brief: {
        source: 'live_llm',
        model: 'grok-4.7',
        latency_ms: 820,
        summary: 'Cloud9 won Fracture 14-12.',
        key_findings: ['R18 retake recovered from -2 deficit.'],
        drills: ['Drill A-site crossfire sync.'],
        context_tag: 'FRACTURE',
      },
      qa: null,
    });

    const md = buildBriefMarkdown(briefPayload);
    expect(md).toContain('## Tactical Board Telestrator Annotations');
    expect(md).toContain('strata9_tactical_board_fracture_r18.png');
    expect(md).toContain('Retake Pin');
    expect(briefPayload.telestrator_board?.stroke_count).toBe(1);
  });

  it('ignores accidental zero-movement clicks without polluting stroke history', () => {
    const canvasRef = createRef<HTMLCanvasElement>();
    const { container } = render(
      <TelestratorOverlay baseCanvasRef={canvasRef} mapName="fracture" roundNumber={18} playheadSec={12.0}>
        <canvas ref={canvasRef} aria-label="Replay base canvas" width={640} height={356} />
      </TelestratorOverlay>,
    );

    const svg = screen.getByRole('application', { name: /Tactical Telestrator drawing layer/i });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 356,
      right: 640,
      bottom: 356,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    dragStroke(svg, { x: 200, y: 150 }, { x: 201, y: 150 });
    expect(container.querySelectorAll('g[data-stroke-tool]')).toHaveLength(0);
  });

  it('summarizes multiple tools accurately with normalized geometry percentages', () => {
    const summary = summarizeTelestratorStrokes(
      [
        { id: '1', tool: 'arrow', color: TELESTRATOR_COLORS[0], points: [[0.1, 0.2], [0.6, 0.7]], label: 'Split A' },
        { id: '2', tool: 'ring', color: TELESTRATOR_COLORS[1], points: [[0.5, 0.5], [0.6, 0.5]] },
      ],
      'fracture',
      18,
      45.25,
    );
    expect(summary.board_filename).toBe('strata9_tactical_board_fracture_r18.png');
    expect(summary.annotations[0].geometry).toContain('(10%, 20%) -> (60%, 70%)');
    expect(summary.annotations[1].geometry).toContain('radius 10%');
  });
});
