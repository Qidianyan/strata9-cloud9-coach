import '@testing-library/jest-dom/vitest';

// jsdom omits PointerEvent; alias to MouseEvent so fireEvent.pointer* preserves clientX/clientY
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
}

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
    drawImage: noop,
    fillText: noop,
    measureText: (txt: string) => ({ width: txt.length * 6 }),
    fillStyle: '#0B0C0D',
    strokeStyle: '#E8FF3B',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    font: '10px monospace',
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => stubCtx,
  });
}
