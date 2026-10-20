/**
 * PDF page helpers for the page picker and selected-page extraction. The
 * composer defers a PDF's extraction until the learner picks pages; these
 * helpers count, render and slice those pages on the server, so every
 * extractor (including remote ones) only ever sees the selection.
 */
import path from 'node:path';

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

/** The most pages a selection may name (bounds the command body and the work). */
export const MAX_PDF_SELECTED_PAGES = 5000;

export class InvalidPdfPageSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPdfPageSelectionError';
  }
}

const globals = globalThis as unknown as {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};
globals.DOMMatrix ??= DOMMatrix;
globals.ImageData ??= ImageData;
globals.Path2D ??= Path2D;

/**
 * pdf.js loads fonts and character maps from its package directory at runtime.
 * `require.resolve` is unusable here: Turbopack rewrites it to a numeric module
 * id, and evaluating it at module scope broke `next build` page-data
 * collection. The package is external, so its install path is stable relative
 * to the working directory (the standalone server's root in production).
 */
function pdfjsAssetPaths(): { standardFontDataUrl: string; cMapUrl: string } {
  const root = path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist');
  return {
    standardFontDataUrl: `${path.join(root, 'standard_fonts')}${path.sep}`,
    cMapUrl: `${path.join(root, 'cmaps')}${path.sep}`,
  };
}

/** The number of pages in a PDF. */
export async function readPdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPageCount();
}

/**
 * Validate a page selection against the document and return it in ascending
 * order. A selection is one or more unique 1-based integer page numbers.
 */
export function normalizePdfPages(pages: unknown, pageCount: number): number[] {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > MAX_PDF_SELECTED_PAGES ||
    pages.some(
      (page) => typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > pageCount,
    )
  ) {
    throw new InvalidPdfPageSelectionError(
      `pages must be 1 to ${MAX_PDF_SELECTED_PAGES} unique page numbers between 1 and ${pageCount}`,
    );
  }
  const unique = [...new Set(pages as number[])];
  if (unique.length !== pages.length) {
    throw new InvalidPdfPageSelectionError('pages must not repeat a page number');
  }
  return unique.sort((left, right) => left - right);
}

/** Whether the selection is the document in its original order. */
export function isEveryPdfPage(pages: readonly number[], pageCount: number): boolean {
  return pages.length === pageCount && pages.every((page, index) => page === index + 1);
}

/** Render one page as a PNG thumbnail. */
export async function renderPdfPagePng(
  bytes: Uint8Array,
  pageNumber: number,
  width = 240,
): Promise<Buffer> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { standardFontDataUrl, cMapUrl } = pdfjsAssetPaths();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new InvalidPdfPageSelectionError(`page must be between 1 and ${pdf.numPages}`);
    }
    const page = await pdf.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext('2d');
      await page.render({
        canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      return canvas.toBuffer('image/png');
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

/** A new PDF carrying only `pages`, in ascending order. */
export async function slicePdfPages(
  bytes: Uint8Array,
  pages: readonly number[],
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const copied = await target.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  for (const page of copied) target.addPage(page);
  return new Uint8Array(await target.save());
}
