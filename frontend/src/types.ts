export type TitleId = 'val' | 'lol';
export type ViewId = 'match' | 'scouting' | 'index';

export interface CorpusStats {
  total_meta_rows: number;
  teams: number;
  players: number;
  characters: number;
  tournaments: number;
  total_games: number;
  valid_games: number;
  invalid_games_excluded: number;
  val_valid_games: number;
  val_invalid_excluded: number;
  lol_valid_games: number;
  lol_invalid_excluded: number;
  local_val_feeds: number;
  local_val_supplements: number;
  local_lol_feeds: number;
}

export interface SquadSummary {
  title: TitleId;
  team_id: string;
  name: string;
  other_names: string[];
  events: string[];
  series_played: number;
  series_wins: number;
  series_losses: number;
  games_played: number;
  game_wins: number;
  game_losses: number;
  game_winrate: number;
  side_splits: Record<string, { played: number; wins: number; winrate: number }>;
  map_pool: Array<{ map: string; played: number; wins: number; losses: number; winrate: number }>;
  top_characters: Array<{ character: string; played: number; wins: number; winrate: number }>;
  patch_trends: Array<{ patch: string; played: number; wins: number; winrate: number }>;
}

export interface LocalSeriesItem {
  series_id: string;
  title: TitleId;
  event: string;
  stage: string;
  scheduled_start: string;
  teams: string;
  c9_team_id: string;
  c9_team_name: string;
  opponent_id: string;
  opponent_name: string;
  series_score: string;
  c9_won_series: boolean;
  maps: string[];
  game_scores: Array<{
    game_number: number;
    map: string;
    c9_score: number;
    opp_score: number;
    c9_won: boolean;
  }>;
  has_ability_supplement: boolean;
}

export interface MetaLeaderRow {
  character: string;
  played: number;
  wins: number;
  winrate: number;
  pick_rate: number;
}

export interface OverviewResponse {
  corpus_stats: CorpusStats;
  cloud9_squads: SquadSummary[];
  local_series: {
    val: LocalSeriesItem[];
    lol: LocalSeriesItem[];
  };
  meta_leaders: {
    val: MetaLeaderRow[];
    lol: MetaLeaderRow[];
  };
}

export interface ValFirstKill {
  occurred_at: string;
  killer_id: string;
  killer: string;
  killer_team: string;
  victim_id: string;
  victim: string;
  victim_team: string;
  weapon: string;
  c9_got_first_kill: boolean;
  position: { x: number; y: number } | null;
}

export interface ValReplayTrack {
  player_id: string;
  name: string;
  agent: string;
  is_c9: boolean;
  death_t: number | null;
  samples: Array<[number, number, number]>;
}

export interface ValReplayEvent {
  t: number;
  kind: 'ability' | 'kill' | 'plant' | 'begin_defuse' | 'defuse' | 'explode';
  is_c9: boolean;
  player?: string;
  agent?: string;
  ability?: string;
  slot?: string;
  nx?: number;
  ny?: number;
  vx?: number;
  vy?: number;
  killer?: string;
  victim?: string;
  weapon?: string;
  kx?: number;
  ky?: number;
  raw_x?: number;
  raw_y?: number;
  raw_kx?: number;
  raw_ky?: number;
}

export interface ValRoundReplay {
  duration_sec: number;
  freezetime_end_sec: number;
  tracks: ValReplayTrack[];
  events: ValReplayEvent[];
}

export interface ValRound {
  round_number: number;
  occurred_at: string;
  ended_at: string;
  c9_side: string;
  c9_won: boolean;
  winner_team_id: string;
  win_type: string;
  c9_score_before: number;
  opp_score_before: number;
  c9_score_after: number;
  opp_score_after: number;
  c9_loadout: number;
  opp_loadout: number;
  c9_money: number;
  opp_money: number;
  econ_diff: number;
  c9_buy_class: string;
  opp_buy_class: string;
  first_kill: ValFirstKill | null;
  kills_count: number;
  c9_kills: number;
  opp_kills: number;
  bomb_planted: boolean;
  bomb_planter: string | null;
  bomb_planter_team: string | null;
  bomb_defused: boolean;
  bomb_exploded: boolean;
  c9_ability_casts: number;
  opp_ability_casts: number;
  max_c9_alive_adv: number;
  max_opp_alive_adv: number;
  pre_wp: number;
  wp_swing: number;
  intra_swing: number;
  impact_score: number;
  swing_tag: string;
  headline: string;
  coaching_prescription: string;
  is_turning_point: boolean;
  replay?: ValRoundReplay;
}

export interface ValTurningPoint {
  rank: number;
  map: string;
  game_number: number;
  round_number: number;
  occurred_at: string;
  c9_won: boolean;
  c9_side: string;
  score: string;
  wp_swing: number;
  intra_swing: number;
  impact_score: number;
  swing_tag: string;
  headline: string;
  econ_diff: number;
  first_kill: ValFirstKill | null;
  coaching_prescription: string;
}

export interface ValSpatialCast {
  grid_event_id: string;
  round: number;
  occurred_at: string;
  player_id: string;
  player_name: string;
  team_id: string;
  is_c9: boolean;
  side: string;
  agent: string;
  ability: string;
  slot: string;
  quality: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  nx: number;
  ny: number;
}

export interface ValOpeningKillPoint {
  round: number;
  occurred_at: string;
  killer: string;
  victim: string;
  team_id: string;
  is_c9: boolean;
  weapon: string;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface DensityCell {
  gx: number;
  gy: number;
  count: number;
  intensity: number;
}

export interface ValPlayerBox {
  player_id: string;
  name: string;
  team_id: string;
  team_name: string;
  is_c9: boolean;
  agent: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  damage_dealt: number;
  first_kills: number;
  first_deaths: number;
  ability_casts: number;
  kd_ratio: number;
  adr: number;
  hs_pct: number;
}

export interface ValMapData {
  game_number: number;
  game_id: string;
  map: string;
  c9_score: number;
  opp_score: number;
  c9_won: boolean;
  total_rounds: number;
  summary: {
    c9_atk_record: string;
    c9_def_record: string;
    opening_duels_won: number;
    opening_duel_winrate: number;
    fk_conversion_rate: number;
    c9_plants: number;
    post_plant_winrate: number;
    c9_ability_casts_spatial: number;
    opp_ability_casts_spatial: number;
  };
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number };
  rounds: ValRound[];
  top_turning_points: ValTurningPoint[];
  spatial: {
    ability_casts: ValSpatialCast[];
    opening_kills: ValOpeningKillPoint[];
    c9_density_grid: DensityCell[];
    opp_density_grid: DensityCell[];
    all_density_grid: DensityCell[];
    grid_size: number;
  };
  players: ValPlayerBox[];
}

export interface ValSeriesResponse {
  title: 'val';
  series_id: string;
  event: string;
  stage: string;
  scheduled_start: string;
  valid: boolean;
  c9_team_id: string;
  c9_team_name: string;
  opponent_id: string;
  opponent_name: string;
  series_score: string;
  c9_won_series: boolean;
  telemetry_audit: {
    sessions_seen: number;
    envelopes_streamed: number;
    events_streamed: number;
    rolled_back_games_dropped: number;
    rolled_back_games: Array<{ game_id: string; rolled_back_at: string }>;
    ability_supplement: {
      available: boolean;
      total_records: number;
      in_grid_records: number;
      joined_usable: number;
      quality_counts: Record<string, number>;
      sampling_hz: number | null;
    };
  };
  series_top_turning_points: ValTurningPoint[];
  maps: ValMapData[];
}

export interface LolGoldPoint {
  minute: number;
  clock_sec: number;
  clock_label: string;
  c9_gold: number;
  opp_gold: number;
  gold_diff: number;
  c9_kills: number;
  opp_kills: number;
}

export interface LolObjectiveEvent {
  clock_sec: number;
  clock_label: string;
  occurred_at: string;
  category: string;
  label: string;
  actor: string;
  team_id: string;
  is_c9: boolean;
  gold_diff_at_time: number;
}

export interface LolMacroSwing {
  rank: number;
  start_min: number;
  end_min: number;
  window_label: string;
  phase: string;
  direction: string;
  gold_swing: number;
  gold_diff_after: number;
  c9_kills: number;
  opp_kills: number;
  objectives: string[];
  impact_score: number;
  coaching_prescription: string;
}

export interface LolPlayerBox {
  player_id: string;
  name: string;
  team_id: string;
  team_name: string;
  is_c9: boolean;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  cs: number;
  cs_per_min: number;
  gold: number;
  gold_share_pct: number;
}

export interface LolGameData {
  game_number: number;
  game_id: string;
  duration_sec: number;
  duration_label: string;
  c9_side: string;
  opp_side: string;
  c9_won: boolean;
  c9_kills: number;
  opp_kills: number;
  c9_gold: number;
  opp_gold: number;
  final_gold_diff: number;
  gold_diff_10: number;
  gold_diff_15: number;
  gold_diff_20: number;
  c9_towers: number;
  opp_towers: number;
  objective_totals: {
    c9: Record<string, number>;
    opp: Record<string, number>;
  };
  draft: {
    c9_picks: string[];
    opp_picks: string[];
    c9_bans: string[];
    opp_bans: string[];
  };
  gold_timeline: LolGoldPoint[];
  objectives: LolObjectiveEvent[];
  top_macro_swings: LolMacroSwing[];
  players: LolPlayerBox[];
}

export interface LolSeriesResponse {
  title: 'lol';
  series_id: string;
  event: string;
  stage: string;
  scheduled_start: string;
  valid: boolean;
  c9_team_id: string;
  c9_team_name: string;
  opponent_id: string;
  opponent_name: string;
  series_score: string;
  c9_won_series: boolean;
  telemetry_audit: {
    sessions_seen: number;
    envelopes_streamed: number;
    events_streamed: number;
    rolled_back_games_dropped: number;
    rolled_back_games: Array<{ game_id: string; rolled_back_at: string }>;
  };
  games: LolGameData[];
}

export interface OpponentRow {
  opponent_id: string;
  opponent_name: string;
  h2h_series: number;
  h2h_games: number;
  c9_game_wins: number;
  opp_game_wins: number;
  c9_h2h_winrate: number;
  opp_overall_games: number;
  opp_overall_winrate: number;
  has_local_feed: boolean;
}

export interface ScoutingDossierResponse {
  title: TitleId;
  c9_team: {
    team_id: string;
    name: string;
    games_played: number;
    game_wins: number;
    game_losses: number;
    game_winrate: number;
    top_characters: Array<{ character: string; played: number; wins: number; winrate: number }>;
  };
  opponent: {
    team_id: string;
    name: string;
    games_played: number;
    game_wins: number;
    game_losses: number;
    game_winrate: number;
    top_characters: Array<{ character: string; played: number; wins: number; winrate: number }>;
    active_roster: Array<{
      player_id: string;
      player_name: string;
      recent_games: number;
      recent_winrate: number;
      signature_picks: Array<{ character: string; games: number; wins: number; winrate: number }>;
    }>;
  };
  h2h: {
    series_count: number;
    games_count: number;
    c9_game_wins: number;
    opp_game_wins: number;
    c9_winrate: number | null;
    recent_series: Array<{
      series_id: string;
      event: string;
      stage: string;
      date: string;
      score: string;
      c9_won: boolean;
      has_local_feed: boolean;
      maps: Array<{ map: string; c9_score: number; opp_score: number; c9_won: boolean }>;
    }>;
  };
  veto_matrix: Array<{
    map: string;
    c9_played: number;
    c9_winrate: number;
    opp_played: number;
    opp_winrate: number;
    h2h_record: string;
    edge_delta: number;
    recommendation: string;
  }>;
  tactical_brief: string[];
  markdown: string;
}

export interface CoachStatusResponse {
  configured: boolean;
  base_url_host: string;
  model_chain: string[];
  forbidden_prefixes: string[];
}

export interface CoachBriefResponse {
  source: 'live_llm' | 'deterministic_fallback';
  model: string;
  latency_ms: number;
  fallback_reason?: string;
  summary: string;
  key_findings: string[];
  drills: string[];
  context_tag: string;
}

export interface CoachAskResponse {
  source: 'live_llm' | 'deterministic_fallback';
  model: string;
  latency_ms: number;
  fallback_reason?: string;
  question: string;
  answer: string;
  drills: string[];
  citations: string[];
}

export interface ValCorpusMapRow {
  map: string;
  maps_played: number;
  map_wins: number;
  map_winrate: number;
  rounds_played: number;
  round_wins: number;
  round_winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
  atk_winrate: number;
  def_winrate: number;
  fk_winrate: number;
  fk_conversion_rate: number;
  post_plant_winrate: number;
  avg_c9_casts_per_round: number;
  series_ids: string[];
  counter_directive: string;
}

export interface ValCorpusEconomyRow {
  buy_tier: string;
  tier_key: string;
  rounds_played: number;
  rounds_won: number;
  winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
  avg_econ_diff: number;
}

export interface ValCorpusOpponentRow {
  opponent: string;
  series_count: number;
  series_ids: string[];
  maps_played: number;
  c9_map_wins: number;
  rounds_played: number;
  c9_round_winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
  c9_fk_winrate: number;
  c9_post_plant_winrate: number;
  c9_anti_eco_winrate: number;
  counter_strategy: string;
}

export interface ValCorpusZoneCell {
  gx: number;
  gy: number;
  label: string;
  c9_casts: number;
  opp_casts: number;
  total_casts: number;
  c9_share_pct: number;
  intensity: number;
}

export interface ValCorpusEvidenceSeries {
  series_id: string;
  event: string;
  stage: string;
  date: string;
  opponent: string;
  score: string;
  c9_won: boolean;
  maps: string[];
  rounds_parsed: number;
  spatial_casts: number;
  has_supplement: boolean;
}

export interface ValCorpusData {
  title: 'val';
  series_count: number;
  maps_count: number;
  rounds_count: number;
  spatial_casts_count: number;
  rolled_back_games_dropped: number;
  evidence_series: ValCorpusEvidenceSeries[];
  map_matrix: ValCorpusMapRow[];
  economy_matrix: ValCorpusEconomyRow[];
  opponent_tendencies: ValCorpusOpponentRow[];
  spatial_hotzones: ValCorpusZoneCell[];
  coaching_directives: string[];
}

export interface LolCorpusSideRow {
  side: string;
  games_played: number;
  games_won: number;
  winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
  avg_gold_diff_15: number;
  baron_control_pct: number;
  dragon_control_pct: number;
}

export interface LolCorpusObjectiveRow {
  metric: string;
  metric_key: string;
  secured_games: number;
  total_games: number;
  control_rate: number;
  winrate_when_secured: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
}

export interface LolCorpusGoldBucketRow {
  bucket: string;
  minute_samples: number;
  winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
}

export interface LolCorpusOpponentRow {
  opponent: string;
  series_count: number;
  series_ids: string[];
  games_played: number;
  c9_game_wins: number;
  c9_winrate: number;
  wilson_ci_low: number;
  wilson_ci_high: number;
  avg_gold_diff_15: number;
  baron_control_pct: number;
  dragon_control_pct: number;
  counter_strategy: string;
}

export interface LolCorpusEvidenceSeries {
  series_id: string;
  event: string;
  stage: string;
  date: string;
  opponent: string;
  score: string;
  c9_won: boolean;
  games_parsed: number;
  avg_gold_diff_15: number;
  baron_control_pct: number;
  dragon_control_pct: number;
}

export interface LolCorpusData {
  title: 'lol';
  series_count: number;
  games_count: number;
  snapshots_count: number;
  objectives_count: number;
  evidence_series: LolCorpusEvidenceSeries[];
  side_matrix: LolCorpusSideRow[];
  objective_control: LolCorpusObjectiveRow[];
  gold_bucket_matrix: LolCorpusGoldBucketRow[];
  opponent_tendencies: LolCorpusOpponentRow[];
  coaching_directives: string[];
}

export interface CorpusScoutingResponse {
  generated_from: string;
  data_dir_mode: string;
  zero_data_committed: boolean;
  requested_title: string;
  val?: ValCorpusData;
  lol?: LolCorpusData;
}

export interface WhatIfRequestPayload {
  title: TitleId;
  // VALORANT fields
  map?: string;
  baseline_side?: 'attacker' | 'defender';
  side?: 'attacker' | 'defender';
  baseline_econ_diff?: number;
  econ_diff?: number;
  baseline_buy_tier?: 'eco' | 'pistol' | 'half_buy' | 'force_buy' | 'full_buy';
  buy_tier?: 'eco' | 'pistol' | 'half_buy' | 'force_buy' | 'full_buy';
  baseline_c9_alive?: number;
  baseline_opp_alive?: number;
  c9_alive?: number;
  opp_alive?: number;
  baseline_site_state?: 'unplanted' | 'planted_default' | 'planted_crossfire' | 'save_weapons';
  site_state?: 'unplanted' | 'planted_default' | 'planted_crossfire' | 'save_weapons';
  baseline_first_kill?: 'opp' | 'none' | 'c9';
  first_kill?: 'opp' | 'none' | 'c9';
  // LoL fields
  game_minute?: number;
  baseline_gold_diff?: number;
  gold_diff?: number;
  baseline_objective_decision?:
    | 'concede_objective'
    | 'trade_crossmap_tower'
    | 'neutral_lane_reset'
    | 'contest_dragon'
    | 'secure_atakhan'
    | 'secure_dragon_soul'
    | 'secure_baron';
  objective_decision?:
    | 'concede_objective'
    | 'trade_crossmap_tower'
    | 'neutral_lane_reset'
    | 'contest_dragon'
    | 'secure_atakhan'
    | 'secure_dragon_soul'
    | 'secure_baron';
  baseline_dragon_diff?: number;
  dragon_diff?: number;
}

export interface WhatIfResponse {
  title: TitleId;
  baselineWinProb: number;
  simulatedWinProb: number;
  deltaWinPct: number;
  baseline_ci: [number, number];
  simulated_ci: [number, number];
  wilson_ci_low: number;
  wilson_ci_high: number;
  effective_sample_n: number;
  corpus_matches_used: number;
  matched_rounds: number;
  scenario: Record<string, string | number>;
  feature_attributions: Record<string, number>;
  coaching_decision: string;
  counter_actions: string[];
}
