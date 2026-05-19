import "@testing-library/jest-dom/vitest";

function createCanvasContextStub() {
  const gradient = { addColorStop: () => undefined };
  return {
    canvas: { width: 1200, height: 680 },
    globalAlpha: 1,
    save: () => undefined,
    restore: () => undefined,
    resetTransform: () => undefined,
    setTransform: () => undefined,
    fillRect: () => undefined,
    beginPath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    clip: () => undefined,
    drawImage: () => undefined,
    strokeText: () => undefined,
    fillText: () => undefined,
    createRadialGradient: () => gradient,
    arc: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => createCanvasContextStub(),
  });
}
