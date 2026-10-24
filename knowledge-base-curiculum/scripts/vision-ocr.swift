import Foundation
import Vision
import AppKit

struct Line: Codable {
    let text: String
    let bbox: [Double]
    let confidence: Float
}

struct Output: Codable {
    let lines: [Line]
    let barcodes: [[Double]]
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: vision-ocr <image> [ar-SA,en-US]\n", stderr)
    exit(1)
}
let url = URL(fileURLWithPath: args[1])
guard let image = NSImage(contentsOf: url) else {
    fputs("cannot load image\n", stderr)
    exit(1)
}
var rect = NSRect(origin: .zero, size: image.size)
guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    fputs("cannot make cgimage\n", stderr)
    exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = args.count > 2 ? args[2].split(separator: ",").map(String.init) : ["ar-SA", "en-US"]
request.usesLanguageCorrection = true
let barcodeRequest = VNDetectBarcodesRequest()
barcodeRequest.symbologies = [.qr]
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request, barcodeRequest])
} catch {
    fputs("ocr error: \(error)\n", stderr)
    exit(2)
}

var lines: [Line] = []
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox
    let x0 = Double(box.minX)
    let y0 = Double(1.0 - box.maxY)
    let x1 = Double(box.maxX)
    let y1 = Double(1.0 - box.minY)
    let rounded = [x0, y0, x1, y1].map { ($0 * 100000).rounded() / 100000 }
    lines.append(Line(text: candidate.string, bbox: rounded, confidence: candidate.confidence))
}

lines.sort { a, b in
    if abs(a.bbox[1] - b.bbox[1]) > 0.01 { return a.bbox[1] < b.bbox[1] }
    return a.bbox[0] > b.bbox[0]
}

var barcodes: [[Double]] = []
for observation in barcodeRequest.results ?? [] {
    let box = observation.boundingBox
    let x0 = Double(box.minX)
    let y0 = Double(1.0 - box.maxY)
    let x1 = Double(box.maxX)
    let y1 = Double(1.0 - box.minY)
    barcodes.append([x0, y0, x1, y1].map { ($0 * 100000).rounded() / 100000 })
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
let data = try encoder.encode(Output(lines: lines, barcodes: barcodes))
FileHandle.standardOutput.write(data)
