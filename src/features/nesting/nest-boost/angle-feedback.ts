// Tactile / audible cue for the rotation "detents" (every 45°): a short click, plus a vibration on phones.

let enabled = true;
let ctx: AudioContext | null = null;

export function setAngleFeedback(on: boolean) {
  enabled = on;
}

/** Multiples of 90° (0/90/180/270) give a lower, stronger click than the 45° diagonals. */
export function angleClick(deg: number) {
  if (!enabled || typeof window === "undefined") return;
  const major = Math.abs(Math.round(deg / 90) * 90 - deg) < 1e-6 || Math.abs(Math.round(deg / 90) * 90 - deg - 360) < 1e-6;
  try {
    navigator.vibrate?.(major ? 25 : 12);
  } catch {
    /* not supported */
  }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = major ? 520 : 880;
    gain.gain.setValueAtTime(major ? 0.5 : 0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (major ? 0.11 : 0.08));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* audio blocked / unsupported */
  }
}