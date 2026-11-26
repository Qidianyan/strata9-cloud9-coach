import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatIfSimulator } from '../WhatIfSimulator';

describe('WhatIfSimulator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/tactical/what-if on mount and updates Wilson CI when preset clicked (VAL)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const isAdv = body.c9_alive === 5 && body.opp_alive === 3;
      return new Response(
        JSON.stringify({
          title: 'val',
          baselineWinProb: 0.48,
          simulatedWinProb: isAdv ? 0.84 : 0.48,
          deltaWinPct: isAdv ? 36.0 : 0.0,
          baseline_ci: [0.38, 0.58],
          simulated_ci: isAdv ? [0.74, 0.91] : [0.38, 0.58],
          wilson_ci_low: isAdv ? 0.74 : 0.38,
          wilson_ci_high: isAdv ? 0.91 : 0.58,
          effective_sample_n: 84,
          corpus_matches_used: 6,
          matched_rounds: 62,
          scenario: body,
          feature_attributions: { manpower_logit: isAdv ? 0.9 : 0.0 },
          coaching_decision: isAdv
            ? 'GREEN LIGHT (+36.0pp EV gain -> 84.0%): commit this tactical adjustment immediately.'
            : 'MARGINAL SWING (+0.0pp -> 48.0%): outcome hinges on first-contact trade spacing.',
          counter_actions: ['Enforce buddy-trade discipline and play Spike clock.'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const onAttach = vi.fn();
    render(
      <WhatIfSimulator
        title="val"
        valSeed={{
          map: 'fracture',
          side: 'attacker',
          econDiff: 0,
          buyTier: 'full_buy',
          firstKill: 'none',
          siteState: 'unplanted',
          label: 'FRACTURE R18',
        }}
        onAttachToBrief={onAttach}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/MARGINAL SWING/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Preset: 5v3 Full Execute/i }));

    await waitFor(() => {
      expect(screen.getByText(/GREEN LIGHT/i)).toBeInTheDocument();
      expect(screen.getByText('+36.0pp')).toBeInTheDocument();
      expect(screen.getByText(/Wilson 95% CI: 74\.0% to 91\.0%/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Attach What-If to Export/i }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach.mock.calls[0][0].deltaWinPct).toBe(36.0);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('supports LoL Cloud9 Kia macro presets and Baron objective simulation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const isBaron = body.objective_decision === 'secure_baron';
      return new Response(
        JSON.stringify({
          title: 'lol',
          baselineWinProb: 0.52,
          simulatedWinProb: isBaron ? 0.87 : 0.52,
          deltaWinPct: isBaron ? 35.0 : 0.0,
          baseline_ci: [0.41, 0.63],
          simulated_ci: isBaron ? [0.76, 0.94] : [0.41, 0.63],
          wilson_ci_low: isBaron ? 0.76 : 0.41,
          wilson_ci_high: isBaron ? 0.94 : 0.63,
          effective_sample_n: 58,
          corpus_matches_used: 4,
          matched_rounds: 44,
          scenario: body,
          feature_attributions: { objective_logit: isBaron ? 0.8 : 0.0 },
          coaching_decision: isBaron
            ? 'COMMIT MACRO PLAY (+35.0pp -> 87.0%): strong positive EV at 22m.'
            : 'CONTEST WITH WAVE PRIO (+0.0pp -> 52.0%): hold teleport flank.',
          counter_actions: ['Establish river vision 45s prior to Baron setup.'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    render(
      <WhatIfSimulator
        title="lol"
        lolSeed={{ gameMinute: 22, goldDiff: 1000, dragonDiff: 1, label: 'Game 2 (20:49-22:59)' }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/CONTEST WITH WAVE PRIO/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Preset: 5v3 Baron Commit/i }));

    await waitFor(() => {
      expect(screen.getByText(/COMMIT MACRO PLAY/i)).toBeInTheDocument();
      expect(screen.getByText('+35.0pp')).toBeInTheDocument();
    });
  });

  it('displays server validation error banner gracefully on HTTP 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: "Field 'econ_diff' cannot be NaN or Infinity." }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<WhatIfSimulator title="val" />);

    await waitFor(() => {
      expect(screen.getByText(/cannot be NaN or Infinity/i)).toBeInTheDocument();
    });
  });
});
