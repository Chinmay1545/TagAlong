export type VoiceMode = 'screenreader' | 'speak'

export function createVoice(
  mode: VoiceMode,
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel'> | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined,
  rate = 1.1,
): { say(text: string): void; unlock(): void; cancel(): void } {
  const speak = (text: string) => {
    if (mode !== 'speak' || !synth || typeof SpeechSynthesisUtterance === 'undefined') return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = rate
    synth.cancel()
    synth.speak(u)
  }
  return {
    say: speak,
    cancel: () => {
      if (mode === 'speak') synth?.cancel()
    },
    // an empty utterance inside a tap unlocks speech on iOS
    unlock: () => {
      if (mode !== 'speak' || !synth || typeof SpeechSynthesisUtterance === 'undefined') return
      synth.speak(new SpeechSynthesisUtterance(''))
    },
  }
}
