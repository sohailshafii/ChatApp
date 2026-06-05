// A short, subtle incoming-message chime (§5 state B). Synthesized with the Web
// Audio API so we ship no audio asset. Default-on; a mute toggle is deferred.
// Best-effort: silently no-ops where audio is unavailable or still locked
// (browsers require a prior user gesture, which sending a message provides).

let ctx: AudioContext | null = null;

export function playIncomingChime(): void {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    // Quick, quiet pluck envelope so it reads as a soft "blip".
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    // Audio unavailable or blocked — stay silent.
  }
}
