import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorpusScoutingPanel } from '../CorpusScoutingPanel';

describe('CorpusScoutingPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders VALORANT multi-series corpus map matrix, economy tiers, hotzones and provenance chips', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          generated_from: 'live_grid_zst_corpus',
          data_dir_mode: 'external_stl_data_dir_read_only',
          zero_data_committed: true,
          requested_title: 'val',
          val: {
            title: 'val',
            series_count: 6,
            maps_count: 14,
            rounds_count: 304,
            spatial_casts_count: 9120,
            rolled_back_games_dropped: 1,
            evidence_series: [
              {
                series_id: '2748746',
                event: 'VCT Americas',
                stage: 'Kickoff',
                date: '2025-01-18',
                opponent: 'NRG',
                score: '2-0',
                c9_won: true,
                maps: ['fracture 14-12', 'lotus 13-10'],
                rounds_parsed: 49,
                spatial_casts: 1577,
                has_supplement: true,
              },
            ],
            map_matrix: [
              {
                map: 'fracture',
                maps_played: 3,
                map_wins: 2,
                map_winrate: 66.7,
                rounds_played: 64,
                round_wins: 39,
                round_winrate: 60.9,
                wilson_ci_low: 48.7,
                wilson_ci_high: 71.9,
                atk_winrate: 68.0,
                def_winrate: 53.0,
                fk_winrate: 54.0,
                fk_conversion_rate: 78.0,
                post_plant_winrate: 84.0,
                avg_c9_casts_per_round: 14.8,
                series_ids: ['2748746', '2775953'],
                counter_directive: 'Attack-weighted map: prioritize early defender reclear utility.',
              },
            ],
            economy_matrix: [
              {
                buy_tier: 'FULL BUY',
                tier_key: 'full_buy',
                rounds_played: 190,
                rounds_won: 109,
                winrate: 57.4,
                wilson_ci_low: 50.3,
                wilson_ci_high: 64.2,
                avg_econ_diff: 1450,
              },
            ],
            opponent_tendencies: [
              {
                opponent: 'NRG',
                series_count: 2,
                series_ids: ['2748746', '2775953'],
                maps_played: 5,
                c9_map_wins: 4,
                rounds_played: 113,
                c9_round_winrate: 54.9,
                wilson_ci_low: 45.7,
                wilson_ci_high: 63.7,
                c9_fk_winrate: 50.4,
                c9_post_plant_winrate: 81.2,
                c9_anti_eco_winrate: 76.0,
                counter_strategy: 'Fast-plant edge vs NRG: prioritize safe Spike drops.',
              },
            ],
            spatial_hotzones: [
              { gx: 0, gy: 0, label: 'NW Sector', c9_casts: 510, opp_casts: 490, total_casts: 1000, c9_share_pct: 51.0, intensity: 0.8 },
              { gx: 1, gy: 1, label: 'Center Control', c9_casts: 680, opp_casts: 570, total_casts: 1250, c9_share_pct: 54.4, intensity: 1.0 },
            ],
            coaching_directives: ['Primary Map Edge: Fracture (60.9% round WR across 64 rounds).'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const onOpenSeries = vi.fn();
    render(<CorpusScoutingPanel title="val" onOpenLocalSeries={onOpenSeries} />);

    await waitFor(() => {
      expect(screen.getByText(/Primary Map Edge: Fracture/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/ZERO DATA IN GIT/i)).toBeInTheDocument();
    expect(screen.getByText(/FULL BUY/i)).toBeInTheDocument();
    expect(screen.getByText(/Center Control/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /#2748746 vs NRG/i }));
    expect(onOpenSeries).toHaveBeenCalledWith('val', '2748746');
  });

  it('renders LoL Cloud9 Kia objective control & gold-bucket corpus tables', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          generated_from: 'live_grid_zst_corpus',
          data_dir_mode: 'external_stl_data_dir_read_only',
          zero_data_committed: true,
          requested_title: 'lol',
          lol: {
            title: 'lol',
            series_count: 4,
            games_count: 10,
            snapshots_count: 256,
            objectives_count: 188,
            evidence_series: [
              {
                series_id: '2754509',
                event: 'LTA North',
                stage: 'Split 1',
                date: '2025-02-01',
                opponent: 'FlyQuest',
                score: '2-1',
                c9_won: true,
                games_parsed: 3,
                avg_gold_diff_15: 940,
                baron_control_pct: 75.0,
                dragon_control_pct: 61.5,
              },
            ],
            side_matrix: [],
            objective_control: [
              {
                metric: 'Baron Majority',
                metric_key: 'baron_majority',
                secured_games: 7,
                total_games: 10,
                control_rate: 70.0,
                winrate_when_secured: 85.7,
                wilson_ci_low: 48.7,
                wilson_ci_high: 97.4,
              },
            ],
            gold_bucket_matrix: [
              {
                bucket: 'Ahead >= +2000g',
                minute_samples: 94,
                winrate: 91.5,
                wilson_ci_low: 84.1,
                wilson_ci_high: 95.6,
              },
            ],
            opponent_tendencies: [],
            coaching_directives: ['Baron Conversion Edge: Cloud9 Kia controls Baron majority in 70.0% of games.'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<CorpusScoutingPanel title="lol" />);

    await waitFor(() => {
      expect(screen.getByText(/Baron Conversion Edge/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('rowheader', { name: 'Baron Majority' })).toBeInTheDocument();
    expect(screen.getByText(/Ahead >= \+2000g/i)).toBeInTheDocument();
  });
});
