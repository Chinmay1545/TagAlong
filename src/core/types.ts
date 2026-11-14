export type Box = { x: number; y: number; w: number; h: number }  // normalized 0..1, top left origin, unmirrored video frame
export type Term = { id: number; latex: string; phrase: string; box: Box }
export type TipSample = { t: number; x: number; y: number }       // t = performance.now() ms, x/y normalized 0..1
export type WordEvent = { word: string; t: number; isPointer: boolean } // t on the same performance.now() clock
export type Resolution = { word: WordEvent; terms: Term[] }         // empty terms = stay silent
