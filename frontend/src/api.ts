import type {
  CoachAskResponse,
  CoachBriefResponse,
  CoachStatusResponse,
  CorpusScoutingResponse,
  LolSeriesResponse,
  OpponentRow,
  OverviewResponse,
  ScoutingDossierResponse,
  TitleId,
  ValSeriesResponse,
  WhatIfRequestPayload,
  WhatIfResponse,
} from './types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Keep HTTP status fallback
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function fetchOverview(signal?: AbortSignal): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>('/api/overview', { signal });
}

export function fetchValSeries(seriesId: string, signal?: AbortSignal): Promise<ValSeriesResponse> {
  return requestJson<ValSeriesResponse>(`/api/val/series/${encodeURIComponent(seriesId)}`, { signal });
}

export function fetchLolSeries(seriesId: string, signal?: AbortSignal): Promise<LolSeriesResponse> {
  return requestJson<LolSeriesResponse>(`/api/lol/series/${encodeURIComponent(seriesId)}`, { signal });
}

export function fetchOpponents(
  title: TitleId,
  teamId: string,
  signal?: AbortSignal,
): Promise<{ title: TitleId; team_id: string; opponents: OpponentRow[] }> {
  const qs = new URLSearchParams({ title, team_id: teamId });
  return requestJson(`/api/scouting/opponents?${qs.toString()}`, { signal });
}

export function fetchDossier(
  title: TitleId,
  teamId: string,
  opponentId: string,
  signal?: AbortSignal,
): Promise<ScoutingDossierResponse> {
  const qs = new URLSearchParams({ title, team_id: teamId, opponent_id: opponentId });
  return requestJson(`/api/scouting/dossier?${qs.toString()}`, { signal });
}

export function getDossierMarkdownUrl(title: TitleId, teamId: string, opponentId: string): string {
  const qs = new URLSearchParams({
    title,
    team_id: teamId,
    opponent_id: opponentId,
    format: 'markdown',
  });
  return `/api/scouting/dossier?${qs.toString()}`;
}

export function fetchCoachStatus(signal?: AbortSignal): Promise<CoachStatusResponse> {
  return requestJson<CoachStatusResponse>('/api/coach/status', { signal });
}

export function requestCoachBrief(
  params: { title: TitleId; series_id: string; map_index?: number; round_number?: number },
  signal?: AbortSignal,
): Promise<CoachBriefResponse> {
  return requestJson<CoachBriefResponse>('/api/coach/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
}

export function requestCoachAsk(
  params: { title: TitleId; series_id: string; question: string; map_index?: number; round_number?: number },
  signal?: AbortSignal,
): Promise<CoachAskResponse> {
  return requestJson<CoachAskResponse>('/api/coach/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
}

export function fetchCorpusScouting(
  title: TitleId | 'all' = 'all',
  signal?: AbortSignal,
): Promise<CorpusScoutingResponse> {
  const qs = new URLSearchParams({ title });
  return requestJson<CorpusScoutingResponse>(`/api/scouting/corpus?${qs.toString()}`, { signal });
}

export function requestWhatIfSimulation(
  payload: WhatIfRequestPayload,
  signal?: AbortSignal,
): Promise<WhatIfResponse> {
  return requestJson<WhatIfResponse>('/api/tactical/what-if', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}
