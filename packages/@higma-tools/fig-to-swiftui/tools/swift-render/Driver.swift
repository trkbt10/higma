// Driver appended to the user's view source by the TS-side runner.
//
// The user's source carries `import SwiftUI` + `struct <Name>: View { ... }`
// and (optionally) a `#Preview { ... }` block. The TS runner strips the
// `#Preview` macro because `swift` CLI script-mode does not expand
// preview macros, then concatenates this driver onto the end. The
// concatenation is processed as one Swift source file by `swift run` /
// `swiftc`.
//
// The driver:
//
//   1. Reads four positional arguments — STRUCT_NAME, OUT_PATH, WIDTH,
//      HEIGHT — from CommandLine.arguments.
//   2. Resolves the user's struct via a small `viewBuilders` lookup
//      table that the TS runner appends below this file (one entry per
//      target view) so we don't need runtime reflection.
//   3. Wraps the SwiftUI body in an NSHostingView, sizes it to the
//      requested frame, and renders to NSBitmapImageRep via
//      `cacheDisplay(in:to:)`. AppKit's HostingView is the documented
//      AppKit→SwiftUI bridge; rendering through `cacheDisplay` forces
//      a synchronous offscreen pass so we don't depend on the run loop
//      ticking.
//   4. Writes the PNG bytes to OUT_PATH.
//
// AppKit (not UIKit) because `swift` CLI on macOS links AppKit by
// default — UIHostingController would pull UIKit which is not
// available outside a `xcrun simctl` simulator boot.

import AppKit
import Foundation
import SwiftUI

@MainActor
func renderViewToPng<V: View>(_ view: V, width: CGFloat, height: CGFloat) -> Data {
  // Composite over a white backdrop so per-paint alpha (e.g. a
  // `Color(red:..., opacity: 0.7)` on a `.background(...)`) blends
  // against the same background colour Figma's WebGL renderer uses
  // when it rasterises a frame — that renderer paints the scene over
  // the canvas's white default, so a translucent paint resolves to a
  // specific opaque pixel value. Without this backdrop the SwiftUI
  // render lands the same fill on a transparent canvas and the
  // resulting pre-multiplied alpha pixel disagrees with Figma's
  // straight-alpha pixel by exactly the missing white contribution.
  let backed = ZStack(alignment: .topLeading) {
    Color.white
    view
  }
  .frame(width: width, height: height)

  // `ImageRenderer` (macOS 13+) renders SwiftUI views *with* effect
  // modifiers (`.blur`, `.shadow`, `.compositingGroup`, …) honoured by
  // the same CoreGraphics + CoreImage stack the on-screen renderer
  // uses. Falling back to `NSHostingView.cacheDisplay(in:to:)`
  // produces a faster render but skips effect filters, which is wrong
  // for fixtures that exercise blurs and stacked shadows. We pin
  // `proposedSize` so the rendered bitmap is exactly `width × height`
  // and `scale = 1` so the PNG matches the WebGL reference's 1× DPR.
  let renderer = ImageRenderer(content: backed)
  renderer.proposedSize = ProposedViewSize(width: width, height: height)
  renderer.scale = 1.0
  if let cgImage = renderer.cgImage {
    let bitmap = NSBitmapImageRep(cgImage: cgImage)
    bitmap.size = NSSize(width: width, height: height)
    if let png = bitmap.representation(using: .png, properties: [:]) {
      return png
    }
  }

  // Fallback path — should rarely run on macOS 13+. Uses
  // `cacheDisplay(in:to:)` which does NOT honour effect filters but
  // is the only path available on older OS targets.
  let host = NSHostingView(rootView: backed)
  host.frame = NSRect(x: 0, y: 0, width: width, height: height)
  host.layoutSubtreeIfNeeded()
  let pixelsWide = Int(width.rounded())
  let pixelsHigh = Int(height.rounded())
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: pixelsWide,
      pixelsHigh: pixelsHigh,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )
  else {
    FileHandle.standardError.write(Data("fig-to-swiftui swift-render: failed to allocate bitmap\n".utf8))
    exit(2)
  }
  bitmap.size = NSSize(width: width, height: height)
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("fig-to-swiftui swift-render: failed to encode PNG\n".utf8))
    exit(2)
  }
  return png
}

@MainActor
func runRender() {
  let args = CommandLine.arguments
  if args.count < 5 {
    FileHandle.standardError.write(Data("usage: swift-render <STRUCT_NAME> <OUT_PATH> <WIDTH> <HEIGHT>\n".utf8))
    exit(2)
  }
  let structName = args[1]
  let outPath = args[2]
  guard let width = Double(args[3]), let height = Double(args[4]) else {
    FileHandle.standardError.write(Data("fig-to-swiftui swift-render: WIDTH/HEIGHT must be numbers\n".utf8))
    exit(2)
  }
  guard let builder = viewBuilders[structName] else {
    FileHandle.standardError.write(Data("fig-to-swiftui swift-render: no builder registered for \"\(structName)\"\n".utf8))
    exit(2)
  }
  let png = builder(CGFloat(width), CGFloat(height))
  do {
    try png.write(to: URL(fileURLWithPath: outPath))
  } catch {
    FileHandle.standardError.write(Data("fig-to-swiftui swift-render: write failed: \(error.localizedDescription)\n".utf8))
    exit(2)
  }
}

// `viewBuilders` is a string→builder map. The TS runner appends a
// single entry per render call by emitting the literal Swift source
//
//   let viewBuilders: [String: (CGFloat, CGFloat) -> Data] = [
//     "Button": { w, h in renderViewToPng(Button(), width: w, height: h) },
//   ]
//
// after this file. Doing the dispatch via an explicit table keeps us
// out of `NSClassFromString`-style runtime lookup, which doesn't work
// for SwiftUI Views (they're value types, not subclasses of NSObject).
//
// The trailing `runRender()` call is also emitted by the TS runner
// (after the table) so the script-mode entry point exists.
