/**
 * PDF page helpers — count, validate, render a thumbnail and slice a selection
 * before extraction. The renderer is pdf.js on the native canvas, so this also
 * checks that repeated pages in one process keep rendering.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  InvalidPdfPageSelectionError,
  isEveryPdfPage,
  normalizePdfPages,
  readPdfPageCount,
  renderPdfPagePng,
  slicePdfPages,
} from '@/lib/server/materials/pdf-pages';

async function samplePdf(pages = 3): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([300, 400]);
    page.drawText(`Page ${index}`, { x: 50, y: 300, size: 32, font });
  }
  return document.save();
}

describe('PDF page helpers', () => {
  it('counts pages and validates a 1-based selection', async () => {
    const bytes = await samplePdf();
    expect(await readPdfPageCount(bytes)).toBe(3);
    expect(normalizePdfPages([3, 1], 3)).toEqual([1, 3]);
    expect(isEveryPdfPage([1, 2, 3], 3)).toBe(true);
    expect(isEveryPdfPage([1, 3], 3)).toBe(false);
    expect(() => normalizePdfPages([], 3)).toThrow(InvalidPdfPageSelectionError);
    expect(() => normalizePdfPages([0], 3)).toThrow(InvalidPdfPageSelectionError);
    expect(() => normalizePdfPages([4], 3)).toThrow(InvalidPdfPageSelectionError);
    expect(() => normalizePdfPages([1, 1], 3)).toThrow(InvalidPdfPageSelectionError);
  });

  it('renders PNG thumbnails repeatedly in one process', async () => {
    const bytes = await samplePdf();
    for (const page of [1, 2, 1]) {
      const png = await renderPdfPagePng(bytes, page);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.length).toBeGreaterThan(1000);
    }
    await expect(renderPdfPagePng(bytes, 4)).rejects.toBeInstanceOf(InvalidPdfPageSelectionError);
  });

  it('slices a selection into a new PDF', async () => {
    const sliced = await slicePdfPages(await samplePdf(4), [1, 4]);
    expect(await readPdfPageCount(sliced)).toBe(2);
  });
});
