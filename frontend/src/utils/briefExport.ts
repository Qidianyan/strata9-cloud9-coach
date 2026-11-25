import type { CoachAskResponse, CoachBriefResponse, TitleId } from '../types';

export interface CoachingExportEvent {
  clock_label: string;
  kind: string;
  actor: string;
  target?: string;
  detail: string;
  coords?: string;
}

export interface CoachingExportContext {
  seriesLabel: string;
  mapOrGame: string;
  roundNumber?: number;
  wpSwing?: string;
  impactScore?: number;
  swingTag?: string;
  econDiff?: string;
  buyMatchup?: string;
  openingDuel?: string;
  spikeStatus?: string;
  headline?: string;
  telemetryPrescription?: string;
  keyEvents: CoachingExportEvent[];
}

export interface CoachingBriefExportPayload {
  schema: 'strata9.coaching_brief.v1';
  exported_at: string;
  context: {
    title: TitleId;
    series_id: string;
    map_index: number;
    round_number: number | null;
    label: string;
    series_label: string;
    map_or_game: string;
  };
  telemetry: {
    wp_swing: string | null;
    impact_score: number | null;
    swing_tag: string | null;
    econ_diff: string | null;
    buy_matchup: string | null;
    opening_duel: string | null;
    spike_status: string | null;
    headline: string | null;
    prescription: string | null;
    key_events: CoachingExportEvent[];
  };
  brief: CoachBriefResponse;
  qa: CoachAskResponse | null;
}

export function buildBriefFilename(
  title: TitleId,
  seriesId: string,
  mapIndex: number,
  roundNumber: number | undefined,
  ext: 'md' | 'json',
): string {
  const safeSeries = seriesId.replace(/[^a-zA-Z0-9_-]/g, '');
  const roundPart = typeof roundNumber === 'number' ? `_r${roundNumber}` : `_g${mapIndex + 1}`;
  return `strata9_${title}_${safeSeries}${roundPart}_brief.${ext}`;
}

export function buildBriefPayload(params: {
  title: TitleId;
  seriesId: string;
  mapIndex: number;
  roundNumber?: number;
  contextLabel: string;
  telemetry?: CoachingExportContext;
  brief: CoachBriefResponse;
  qa: CoachAskResponse | null;
}): CoachingBriefExportPayload {
  const { title, seriesId, mapIndex, roundNumber, contextLabel, telemetry, brief, qa } = params;
  return {
    schema: 'strata9.coaching_brief.v1',
    exported_at: new Date().toISOString(),
    context: {
      title,
      series_id: seriesId,
      map_index: mapIndex,
      round_number: roundNumber ?? telemetry?.roundNumber ?? null,
      label: contextLabel,
      series_label: telemetry?.seriesLabel ?? brief.context_tag,
      map_or_game: telemetry?.mapOrGame ?? contextLabel,
    },
    telemetry: {
      wp_swing: telemetry?.wpSwing ?? null,
      impact_score: telemetry?.impactScore ?? null,
      swing_tag: telemetry?.swingTag ?? null,
      econ_diff: telemetry?.econDiff ?? null,
      buy_matchup: telemetry?.buyMatchup ?? null,
      opening_duel: telemetry?.openingDuel ?? null,
      spike_status: telemetry?.spikeStatus ?? null,
      headline: telemetry?.headline ?? null,
      prescription: telemetry?.telemetryPrescription ?? null,
      key_events: telemetry?.keyEvents ?? [],
    },
    brief,
    qa,
  };
}

export function buildBriefMarkdown(payload: CoachingBriefExportPayload): string {
  const { context, telemetry, brief, qa } = payload;
  const lines: string[] = [
    '# Strata9 Tactical Coaching Brief',
    '',
    `- **Title**: ${context.title.toUpperCase()}`,
    `- **Series**: ${context.series_label} (#${context.series_id})`,
    `- **Map / Game**: ${context.map_or_game}`,
  ];
  if (context.round_number !== null) {
    lines.push(`- **Focus Round**: R${context.round_number}`);
  }
  lines.push(
    `- **Coach Engine**: ${brief.source === 'live_llm' ? 'LIVE LLM' : 'TELEMETRY'} (${brief.model}, ${Math.round(brief.latency_ms)}ms)`,
    `- **Exported (UTC)**: ${payload.exported_at}`,
    '',
    '## Round / Macro Telemetry Snapshot',
  );

  if (telemetry.wp_swing) {
    lines.push(
      `- **Win-Probability / Gold Swing**: ${telemetry.wp_swing}${
        telemetry.impact_score !== null ? ` (Impact ${telemetry.impact_score})` : ''
      }`,
    );
  }
  if (telemetry.swing_tag) {
    lines.push(`- **Turning-Point Tag**: ${telemetry.swing_tag.replace(/_/g, ' ')}`);
  }
  if (telemetry.econ_diff) {
    lines.push(`- **Economy Diff**: ${telemetry.econ_diff}${telemetry.buy_matchup ? ` (${telemetry.buy_matchup})` : ''}`);
  }
  if (telemetry.opening_duel) {
    lines.push(`- **Opening Duel**: ${telemetry.opening_duel}`);
  }
  if (telemetry.spike_status) {
    lines.push(`- **Spike / Outcome**: ${telemetry.spike_status}`);
  }
  if (telemetry.headline) {
    lines.push(`- **Headline**: ${telemetry.headline}`);
  }
  if (telemetry.prescription) {
    lines.push(`- **Telemetry Prescription**: ${telemetry.prescription}`);
  }

  if (telemetry.key_events.length > 0) {
    lines.push('', '## Key Kills & Objective Events');
    for (const ev of telemetry.key_events) {
      const targetPart = ev.target ? ` -> ${ev.target}` : '';
      const coordPart = ev.coords ? ` @ ${ev.coords}` : '';
      lines.push(`- **[${ev.clock_label}] ${ev.kind.toUpperCase()}**: ${ev.actor}${targetPart} (${ev.detail})${coordPart}`);
    }
  }

  lines.push('', '## Executive Summary', '', brief.summary, '', '## Verified Tactical Findings');
  for (const finding of brief.key_findings) {
    lines.push(`- ${finding}`);
  }

  lines.push('', '## Prescribed Scrim Drills');
  for (const drill of brief.drills) {
    lines.push(`- ${drill}`);
  }

  if (qa) {
    lines.push(
      '',
      '## Follow-Up Tactical Q&A',
      '',
      `**Q**: ${qa.question}`,
      '',
      `**A (${qa.model}, ${Math.round(qa.latency_ms)}ms)**: ${qa.answer}`,
    );
    if (qa.drills.length > 0) {
      lines.push('', '### Follow-Up Drills');
      for (const d of qa.drills) {
        lines.push(`- ${d}`);
      }
    }
    if (qa.citations.length > 0) {
      lines.push('', `**Citations**: ${qa.citations.join('; ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function triggerBlobDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
