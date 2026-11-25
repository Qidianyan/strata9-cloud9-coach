import '@testing-library/jest-dom/vitest';

// Provide a lightweight CanvasRenderingContext2D implementation in jsdom for RoundReplayCanvas unit tests
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {};
  const stubCtx = {
    save: noop,
    restore: noop,
    scale: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (txt: string) => ({ width: txt.length * 6 }),
    fillStyle: '#0B0C0D',
    strokeStyle: '#E8FF3B',
    lineWidth: 1,
    font: '10px monospace',
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => stubCtx,
  });
}
