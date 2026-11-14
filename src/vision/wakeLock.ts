// Keeps a phone on a tripod from auto-locking, which would stop the camera.
// iOS drops the lock whenever the page is hidden, so it is taken again when the page comes back.
type Lock = { released: boolean; release(): Promise<void> }
type WakeLockApi = { request(type: 'screen'): Promise<Lock> }

export function keepScreenAwake(): () => void {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
  if (!api) return () => {}
  let lock: Lock | null = null
  let stopped = false
  const take = async () => {
    if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return
    try {
      const l = await api.request('screen')
      if (stopped) void l.release()
      else lock = l
    } catch { /* low battery or not allowed: the screen may lock, nothing else breaks */ }
  }
  const onVisible = () => { void take() }
  document.addEventListener('visibilitychange', onVisible)
  void take()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release()
  }
}
