import AppKit

//
// Rasterises an SVG to a PNG at an exact pixel size, keeping transparency.
//
//   swift scripts/svg2png.swift <in.svg> <out.png> <width> [height]
//
// Height defaults to width, because icons are square. A Stream Deck + dial's touchscreen is 200 x 100,
// so it is not, and a square bitmap silently stretched it to twice its
// height — which looked plausible enough in isolation to be worth guarding against.
//
// Used by scripts/render-icons.mjs. NSImage has read SVG since macOS 11, so this needs nothing
// installed: not librsvg, not ImageMagick, whose internal SVG renderer drops both strokes and
// colour. `qlmanage -t` renders SVG correctly but flattens alpha onto white, which is no use for
// a key icon that has to sit on a black key.
//
let args = CommandLine.arguments
guard args.count >= 4, let width = Int(args[3]), width > 0 else {
    FileHandle.standardError.write("usage: svg2png <in.svg> <out.png> <width> [height]\n".data(using: .utf8)!)
    exit(2)
}
let height = args.count >= 5 ? (Int(args[4]) ?? width) : width
guard height > 0 else {
    FileHandle.standardError.write("height must be positive\n".data(using: .utf8)!)
    exit(2)
}

guard let image = NSImage(contentsOfFile: args[1]) else {
    FileHandle.standardError.write("could not read \(args[1])\n".data(using: .utf8)!)
    exit(1)
}

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else {
    FileHandle.standardError.write("could not allocate a \(width)x\(height) bitmap\n".data(using: .utf8)!)
    exit(1)
}
rep.size = NSSize(width: width, height: height)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(x: 0, y: 0, width: width, height: height), from: .zero,
           operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode PNG\n".data(using: .utf8)!)
    exit(1)
}
do {
    try png.write(to: URL(fileURLWithPath: args[2]))
} catch {
    FileHandle.standardError.write("could not write \(args[2]): \(error)\n".data(using: .utf8)!)
    exit(1)
}
