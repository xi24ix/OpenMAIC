import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function createPdfFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  page.drawText('Native lesson text', { x: 30, y: 250, size: 18, font, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 100, y: 75, width: 180, height: 100, borderColor: rgb(0, 0, 1), borderWidth: 3, color: rgb(0.85, 0.9, 1) });
  page.drawLine({ start: { x: 110, y: 90 }, end: { x: 270, y: 160 }, thickness: 4, color: rgb(1, 0, 0) });
  page.drawText('Vector label', { x: 120, y: 120, size: 14, font, color: rgb(0, 0, 0) });
  pdf.addPage([400, 300]);
  return pdf.save();
}
