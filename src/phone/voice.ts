// iPhones only let the phone's own voice speak later if something was spoken inside a press. An empty
// utterance does that. This is the only place the phone's voice is touched on purpose: whispers go
// through the whisper player (server voice first), never through here.
export function unlockVoice(synth: Pick<SpeechSynthesis, 'speak'> | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined): void {
  try {
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
    synth.speak(new SpeechSynthesisUtterance(''))
  } catch { /* no voice to unlock */ }
}
