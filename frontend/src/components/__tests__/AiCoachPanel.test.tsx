import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCoachPanel } from '../AiCoachPanel';
import { buildBriefMarkdown, buildBriefPayload } from '../../utils/briefExport';

describe('AiCoachPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads coaching brief on mount and submits tactical Q&A requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/coach/brief')) {
        return new Response(
          JSON.stringify({
            source: 'live_llm',
            model: 'wb/glm-5.3',
            latency_ms: 842,
            summary: 'Cloud9 dominated Fracture attack 11-2 before recovering R18.',
            key_findings: ['R18 neT defused Spike after -2 player deficit.'],
            drills: ['Drill A-site retake crossfires with Killjoy nanoswarm delay.'],
            context_tag: 'Cloud9 vs NRG (FRACTURE 14-12)',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          source: 'live_llm',
          model: 'wb/glm-5.3',
          latency_ms: 615,
          question: 'Diagnose Fracture R18 execution',
          answer: 'neT anchored the 2v3 retake after Xeppaa traded Verno and FNS.',
          drills: ['Practice double-swing timing from A Drop onto sand.'],
          citations: ['Series #2748746 FRACTURE R18'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    render(
      <AiCoachPanel
        title="val"
        seriesId="2748746"
        mapIndex={0}
        roundNumber={18}
        contextLabel="FRACTURE R18"
        quickQuestions={[
          { label: 'Diagnose R18', prompt: 'Diagnose Fracture R18 execution' },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Cloud9 dominated Fracture attack 11-2/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/LIVE LLM: wb\/glm-5\.3/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Diagnose R18/i }));

    await waitFor(() => {
      expect(screen.getByText(/neT anchored the 2v3 retake/i)).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('exports current round tactical brief as Markdown and JSON in one click', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          source: 'live_llm',
          model: 'wb/glm-5.3',
          latency_ms: 710,
          summary: 'Cloud9 flipped Fracture R18 with a coordinated 2v3 A-site retake.',
          key_findings: ['Xeppaa cleared FNS at Dish to enable neT defuse.'],
          drills: ['Run 10x Fracture A-site retake utility timing reps.'],
          context_tag: 'Cloud9 vs NRG (FRACTURE 14-12)',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const capturedBlobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const createUrlSpy = vi.fn((blob: Blob | MediaSource) => {
      capturedBlobs.push(blob as Blob);
      return `blob:strata9-${capturedBlobs.length}`;
    });
    const revokeUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrlSpy, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrlSpy, configurable: true, writable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const telemetryExport = {
      seriesLabel: 'Cloud9 vs NRG (2-0)',
      mapOrGame: 'FRACTURE (14-12)',
      roundNumber: 18,
      wpSwing: '+26.1%',
      impactScore: 88,
      swingTag: 'CLUTCH_DEFUSE',
      econDiff: '-$4,200',
      buyMatchup: 'Full vs Full',
      openingDuel: 's0m (NRG) > OXY',
      spikeStatus: 'Planted (s0m) / bombDefused',
      headline: 'R18: Cloud9 clutch defuse on Fracture A site',
      telemetryPrescription: 'Hold flash-swing spacing on A Drop entry.',
      keyEvents: [
        {
          clock_label: '64.2s',
          kind: 'kill',
          actor: 'Xeppaa',
          target: 'FNS',
          detail: 'vandal',
          coords: '(8192, -6602)',
        },
        {
          clock_label: '79.4s',
          kind: 'defuse',
          actor: 'neT',
          detail: 'defuse',
          coords: '(8059, -6478)',
        },
      ],
    };

    render(
      <AiCoachPanel
        title="val"
        seriesId="2748746"
        mapIndex={0}
        roundNumber={18}
        contextLabel="FRACTURE R18"
        telemetryExport={telemetryExport}
        quickQuestions={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export tactical brief as Markdown/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Export tactical brief as Markdown/i }));
    fireEvent.click(screen.getByRole('button', { name: /Export tactical brief as JSON/i }));

    expect(createUrlSpy).toHaveBeenCalledTimes(2);
    expect(revokeUrlSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Saved strata9_val_2748746_r18_brief.json');

    const readBlobText = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });

    const mdText = await readBlobText(capturedBlobs[0]);
    expect(mdText).toContain('# Strata9 Tactical Coaching Brief');
    expect(mdText).toContain('R18');
    expect(mdText).toContain('+26.1%');
    expect(mdText).toContain('Xeppaa -> FNS');
    expect(mdText).toContain('Run 10x Fracture A-site retake utility timing reps.');

    const jsonParsed = JSON.parse(await readBlobText(capturedBlobs[1]));
    expect(jsonParsed.schema).toBe('strata9.coaching_brief.v1');
    expect(jsonParsed.context.round_number).toBe(18);
    expect(jsonParsed.telemetry.wp_swing).toBe('+26.1%');
    expect(jsonParsed.telemetry.key_events).toHaveLength(2);
    expect(jsonParsed.brief.drills[0]).toContain('Fracture A-site retake');

    const directPayload = buildBriefPayload({
      title: 'val',
      seriesId: '2748746',
      mapIndex: 0,
      roundNumber: 18,
      contextLabel: 'FRACTURE R18',
      telemetry: telemetryExport,
      brief: jsonParsed.brief,
      qa: null,
    });
    expect(buildBriefMarkdown(directPayload)).toContain('(8059, -6478)');

    Object.defineProperty(URL, 'createObjectURL', { value: origCreate, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: origRevoke, configurable: true, writable: true });
  });

  it('embeds attached What-If simulation delta and Wilson CI into exported Markdown and JSON briefs', () => {
    const payload = buildBriefPayload({
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
        whatIfSimulation: {
          title: 'val',
          baselineWinProb: 0.44,
          simulatedWinProb: 0.78,
          deltaWinPct: 34.0,
          baseline_ci: [0.34, 0.54],
          simulated_ci: [0.68, 0.86],
          wilson_ci_low: 0.68,
          wilson_ci_high: 0.86,
          effective_sample_n: 92,
          corpus_matches_used: 6,
          matched_rounds: 64,
          scenario: { buy_tier: 'full_buy' },
          feature_attributions: { manpower_logit: 0.85 },
          coaching_decision: 'GREEN LIGHT (+34.0pp EV gain -> 78.0%): commit immediately.',
          counter_actions: ['Lock buddy-trade spacing after Spike plant.'],
        },
      },
      brief: {
        source: 'live_llm',
        model: 'grok-4.7',
        latency_ms: 920,
        summary: 'Cloud9 won Fracture 14-12.',
        key_findings: ['R18 clutch recovery.'],
        drills: ['Drill A-site crossfires.'],
        context_tag: 'FRACTURE',
      },
      qa: null,
    });

    const md = buildBriefMarkdown(payload);
    expect(md).toContain('## Tactical What-If Simulation');
    expect(md).toContain('+34.0pp');
    expect(md).toContain('68.0% - 86.0%');
    expect(md).toContain('Lock buddy-trade spacing after Spike plant.');
    expect(payload.what_if_simulation?.simulatedWinProb).toBe(0.78);
  });
});
