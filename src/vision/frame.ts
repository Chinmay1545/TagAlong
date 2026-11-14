// A camera frame as plain RGBA bytes (the shape of ImageData), so detectors can be tested without a DOM.
export type Frame = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
