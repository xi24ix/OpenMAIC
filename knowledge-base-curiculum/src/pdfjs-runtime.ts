import { DOMMatrix, Path2D, createCanvas } from '@napi-rs/canvas';

const scope = globalThis as Record<string, unknown>;
if (!scope.DOMMatrix) scope.DOMMatrix = DOMMatrix;
if (!scope.Path2D) scope.Path2D = Path2D;

type CanvasEntry = { canvas: any; context: any };

/**
 * pdfjs-dist's Node build resolves its default canvas factory through the
 * optional `canvas` package. This project uses @napi-rs/canvas, so a compatible
 * factory must be supplied or rendering fails with "reading 'createCanvas'".
 */
export class NapiCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(entry: CanvasEntry, width: number, height: number): void {
    if (!entry.canvas || width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry: Partial<CanvasEntry>): void {
    if (!entry.canvas) return;
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = undefined;
    entry.context = undefined;
  }
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfjsModule> | undefined;

/** Load pdfjs only after the canvas globals are in place. */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}
