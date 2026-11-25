import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ValMapData, ValRound } from '../../types';
import { RoundReplayCanvas } from '../RoundReplayCanvas';

const sampleRound: ValRound = {
  round_number: 18,
  occurred_at: '2025-01-18T00:49:49.000Z',
  ended_at: '2025-01-18T00:52:10.000Z',
  c9_side: 'defender',
  c9_won: true,
  winner_team_id: '79',
  win_type: 'bombDefused',
  c9_score_before: 10,
  opp_score_before: 7,
  c9_score_after: 11,
  opp_score_after: 7,
  c9_loadout: 21500,
  opp_loadout: 26300,
  c9_money: 4000,
  opp_money: 6000,
  econ_diff: -4800,
  c9_buy_class: 'FULL BUY',
  opp_buy_class: 'FULL BUY',
  first_kill: null,
  kills_count: 8,
  c9_kills: 5,
  opp_kills: 3,
  bomb_planted: true,
  bomb_planter: 's0m',
  bomb_planter_team: '97',
  bomb_defused: true,
  bomb_exploded: false,
  c9_ability_casts: 20,
  opp_ability_casts: 18,
  max_c9_alive_adv: 2,
  max_opp_alive_adv: 2,
  pre_wp: 38.5,
  wp_swing: 61.5,
  intra_swing: 72.0,
  impact_score: 141.2,
  swing_tag: 'CLUTCH_DEFICIT_RECOVERY',
  headline: 'R18 · Clutch Recovery from -2 Deficit (10-7 -> 11-7)',
  coaching_prescription: 'Drill late-round retake crossfires on Fracture.',
  is_turning_point: true,
  replay: {
    duration_sec: 120,
    freezetime_end_sec: 4,
    tracks: [
      {
        player_id: '2348',
        name: 'neT',
        agent: 'killjoy',
        is_c9: true,
        death_t: null,
        samples: [
          [4, 0.45, 0.35],
          [60, 0.52, 0.65],
          [112, 0.48, 0.72],
        ],
      },
      {
        player_id: '2358',
        name: 'mada',
        agent: 'raze',
        is_c9: false,
        death_t: 115,
        samples: [
          [4, 0.7, 0.25],
          [75, 0.58, 0.62],
          [115, 0.54, 0.69],
        ],
      },
    ],
    events: [
      {
        t: 52,
        kind: 'ability',
        player: 'neT',
        agent: 'killjoy',
        is_c9: true,
        ability: 'nanoswarm',
        slot: 'ABILITY_1',
        nx: 0.5,
        ny: 0.6,
        vx: 0.8,
        vy: -0.6,
      },
      {
        t: 78,
        kind: 'kill',
        killer: 'neT',
        victim: 's0m',
        weapon: 'phantom',
        is_c9: true,
        kx: 0.52,
        ky: 0.64,
        vx: 0.48,
        vy: 0.71,
      },
      {
        t: 95,
        kind: 'plant',
        player: 's0m',
        is_c9: false,
        nx: 0.49,
        ny: 0.73,
      },
      {
        t: 112,
        kind: 'defuse',
        player: 'neT',
        is_c9: true,
        nx: 0.49,
        ny: 0.73,
      },
    ],
  },
};

const sampleMap: ValMapData = {
  game_number: 1,
  game_id: 'g-fracture',
  map: 'fracture',
  c9_score: 14,
  opp_score: 12,
  c9_won: true,
  total_rounds: 26,
  summary: {
    c9_atk_record: '11-2',
    c9_def_record: '3-10',
    opening_duels_won: 12,
    opening_duel_winrate: 46.2,
    fk_conversion_rate: 75,
    c9_plants: 12,
    post_plant_winrate: 91.7,
    c9_ability_casts_spatial: 396,
    opp_ability_casts_spatial: 379,
  },
  bounds: { min_x: 3000, max_x: 14128, min_y: -6982, max_y: 4856 },
  rounds: [sampleRound],
  top_turning_points: [],
  spatial: {
    ability_casts: [],
    opening_kills: [],
    c9_density_grid: [],
    opp_density_grid: [],
    all_density_grid: [],
    grid_size: 18,
  },
  players: [],
};

describe('RoundReplayCanvas', () => {
  it('renders canvas transport controls, playback speed toggle, scrubber, and event jump buttons', () => {
    render(<RoundReplayCanvas mapData={sampleMap} round={sampleRound} c9Name="Cloud9" oppName="NRG" />);

    expect(screen.getByLabelText(/Canvas2D animated round replay for fracture Round 18/i)).toBeInTheDocument();

    const playBtn = screen.getByRole('button', { name: /Play Round/i });
    fireEvent.click(playBtn);
    expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();

    const speed2x = screen.getByRole('button', { name: '2x' });
    fireEvent.click(speed2x);
    expect(screen.getByText(/PLAYING 2x/i)).toBeInTheDocument();

    const scrubber = screen.getByLabelText(/Round replay timeline scrubber/i) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: '78' } });
    expect(Number(scrubber.value)).toBe(78);

    const defuseEvent = screen.getByRole('button', { name: /neT DEFUSED Spike/i });
    fireEvent.click(defuseEvent);
    expect(Number(scrubber.value)).toBeGreaterThanOrEqual(112);
  });
});
