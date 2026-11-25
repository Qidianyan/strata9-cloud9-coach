import { FormEvent, useEffect, useState } from 'react';
import { requestCoachAsk, requestCoachBrief } from '../api';
import type { CoachAskResponse, CoachBriefResponse, TitleId } from '../types';
import {
  buildBriefFilename,
  buildBriefMarkdown,
  buildBriefPayload,
  triggerBlobDownload,
  type CoachingExportContext,
} from '../utils/briefExport';

interface AiCoachPanelProps {
  title: TitleId;
  seriesId: string;
  mapIndex: number;
  roundNumber?: number;
  contextLabel: string;
  quickQuestions: Array<{ label: string; prompt: string }>;
  telemetryExport?: CoachingExportContext;
}

export function AiCoachPanel({
  title,
  seriesId,
  mapIndex,
  roundNumber,
  contextLabel,
  quickQuestions,
  telemetryExport,
}: AiCoachPanelProps) {
  const [brief, setBrief] = useState<CoachBriefResponse | null>(null);
  const [briefLoading, setBriefLoading] = useState<boolean>(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const [question, setQuestion] = useState<string>('');
  const [qa, setQa] = useState<CoachAskResponse | null>(null);
  const [askLoading, setAskLoading] = useState<boolean>(false);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBriefLoading(true);
    setBriefError(null);
    requestCoachBrief(
      { title, series_id: seriesId, map_index: mapIndex, round_number: roundNumber },
      controller.signal,
    )
      .then((res) => {
        setBrief(res);
        setBriefLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setBriefError(err instanceof Error ? err.message : 'Unable to generate coaching brief');
        setBriefLoading(false);
      });
    return () => controller.abort();
  }, [title, seriesId, mapIndex]);

  const handleRegenerateBrief = () => {
    setBriefLoading(true);
    setBriefError(null);
    requestCoachBrief({ title, series_id: seriesId, map_index: mapIndex, round_number: roundNumber })
      .then((res) => {
        setBrief(res);
        setBriefLoading(false);
      })
      .catch((err: unknown) => {
        setBriefError(err instanceof Error ? err.message : 'Unable to regenerate coaching brief');
        setBriefLoading(false);
      });
  };

  const runQuestion = (qText: string) => {
    const cleaned = qText.trim();
    if (!cleaned) return;
    setQuestion(cleaned);
    setAskLoading(true);
    setAskError(null);
    requestCoachAsk({
      title,
      series_id: seriesId,
      map_index: mapIndex,
      round_number: roundNumber,
      question: cleaned,
    })
      .then((res) => {
        setQa(res);
        setAskLoading(false);
      })
      .catch((err: unknown) => {
        setAskError(err instanceof Error ? err.message : 'Coach Q&A request failed');
        setAskLoading(false);
      });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    runQuestion(question);
  };

  const handleExportBrief = (format: 'md' | 'json') => {
    if (!brief) return;
    const payload = buildBriefPayload({
      title,
      seriesId,
      mapIndex,
      roundNumber,
      contextLabel,
      telemetry: telemetryExport,
      brief,
      qa,
    });
    const filename = buildBriefFilename(title, seriesId, mapIndex, roundNumber, format);
    if (format === 'md') {
      triggerBlobDownload(filename, buildBriefMarkdown(payload), 'text/markdown;charset=utf-8');
      setExportNotice(`Saved ${filename}`);
    } else {
      triggerBlobDownload(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      setExportNotice(`Saved ${filename}`);
    }
  };

  const activeSource = qa ?? brief;

  return (
    <section className="panel" aria-label="Strata9 AI Tactical Coach">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">02 // Strata9 AI Tactical Coach</h2>
          <p className="panel-subtitle">
            Grounded strictly in real streamed GRID telemetry ({contextLabel})
          </p>
        </div>
        <div className="controls-cluster">
          {activeSource && (
            <span className={`badge ${activeSource.source === 'live_llm' ? 'badge-pick' : 'badge-volt'}`}>
              {activeSource.source === 'live_llm' ? 'LIVE LLM' : 'TELEMETRY'}: {activeSource.model} (
              {Math.round(activeSource.latency_ms)}ms)
            </span>
          )}
          <button
            type="button"
            className="chip-btn"
            disabled={!brief}
            aria-label="Export tactical brief as Markdown"
            onClick={() => handleExportBrief('md')}
          >
            Export .MD
          </button>
          <button
            type="button"
            className="chip-btn"
            disabled={!brief}
            aria-label="Export tactical brief as JSON"
            onClick={() => handleExportBrief('json')}
          >
            Export .JSON
          </button>
          <button
            type="button"
            className="chip-btn"
            disabled={briefLoading}
            onClick={handleRegenerateBrief}
          >
            {briefLoading ? 'Analyzing…' : 'Refresh Brief'}
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="audit-strip" style={{ marginTop: 0, marginBottom: 10 }} role="status" aria-live="polite">
          <span className="audit-chip mono">{exportNotice}</span>
        </div>
      )}

      {briefError && <div className="status-banner is-error">{briefError}</div>}

      {briefLoading && !brief && (
        <div className="coach-brief-box">
          <p className="coach-summary mono">Streaming match telemetry into Strata9 AI Coach…</p>
        </div>
      )}

      {brief && (
        <div className="coach-brief-box">
          <p className="coach-summary">{brief.summary}</p>
          <div>
            <h3 className="coach-subhead">Verified Tactical Findings</h3>
            <ul className="coach-bullets">
              {brief.key_findings.map((f, idx) => (
                <li key={idx}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="coach-subhead">Prescribed Scrim Drills</h3>
            <ul className="coach-bullets">
              {brief.drills.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="heatmap-controls" style={{ marginTop: 12, marginBottom: 0 }}>
        {quickQuestions.map((qq) => (
          <button
            key={qq.label}
            type="button"
            className="chip-btn"
            disabled={askLoading}
            onClick={() => runQuestion(qq.prompt)}
          >
            {qq.label}
          </button>
        ))}
      </div>

      <form className="coach-ask-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="coach-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Ask Strata9 AI Coach a tactical question"
          placeholder="Ask about round economy, utility spacing, man-advantage throws, or draft counters…"
        />
        <button type="submit" className="action-btn" disabled={askLoading || !question.trim()}>
          {askLoading ? 'Thinking…' : 'Ask Coach'}
        </button>
      </form>

      {askError && (
        <div className="status-banner is-error" style={{ marginTop: 12 }}>
          {askError}
        </div>
      )}

      {qa && (
        <div className="coach-answer-card" aria-live="polite">
          <div className="tp-top">
            <span className="coach-subhead" style={{ margin: 0 }}>
              Q: {qa.question}
            </span>
            <span className="mono text-muted">
              {qa.model} ({Math.round(qa.latency_ms)}ms)
            </span>
          </div>
          <p className="coach-summary">{qa.answer}</p>
          {qa.drills.length > 0 && (
            <ul className="coach-bullets">
              {qa.drills.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}
          {qa.citations.length > 0 && (
            <div className="audit-strip">
              {qa.citations.map((c, idx) => (
                <span key={idx} className="audit-chip">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
