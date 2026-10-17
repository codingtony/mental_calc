// WebAudio instrument voices, the per-song mixer and shared noise/envelope helpers.
// Works on any BaseAudioContext (live AudioContext or OfflineAudioContext).
import type { InstrumentId, NoteEvent } from "./music";

export const midiFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

const FLOOR = 0.0001; // exponential ramps need a value > 0

/** 2 s mono white noise. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** 1.8 s stereo reverb impulse: decaying noise, independent per channel. */
export function makeImpulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(ctx.sampleRate * 1.8);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  return buf;
}

/** exp attack to `peak`, then exp decay to 0.0001 at t+attack+decay. */
export function envelope(g: AudioParam, t: number, attack: number, peak: number, decay: number): void {
  g.setValueAtTime(FLOOR, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
}

/** Sustained note: exp attack to peak, setTargetAtTime(peak*sustain, t+attack, decayTau), release setTargetAtTime(0.0001, t+dur, releaseTau). Returns the time sources must stop: t + dur + 5*releaseTau. */
export function noteEnvelope(
  g: AudioParam,
  t: number,
  dur: number,
  attack: number,
  peak: number,
  sustain: number,
  decayTau: number,
  releaseTau: number,
): number {
  g.setValueAtTime(FLOOR, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(peak * sustain, t + attack, decayTau);
  g.setTargetAtTime(FLOOR, t + dur, releaseTau);
  return t + dur + 5 * releaseTau;
}

/** Looping noise source started at t, stopped at t+dur+0.05, connected to `dest`. */
export function playNoise(
  ctx: BaseAudioContext,
  noise: AudioBuffer,
  t: number,
  dur: number,
  dest: AudioNode,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
  return src;
}

export interface SongOutput {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  out: GainNode;
  channel: Record<InstrumentId, AudioNode>;
}

const MIX: Record<InstrumentId, { level: number; pan: number; rev: number; dly: number }> = {
  kick: { level: 0.9, pan: 0, rev: 0, dly: 0 },
  snare: { level: 0.55, pan: 0, rev: 0.25, dly: 0 },
  hat: { level: 0.18, pan: 0.2, rev: 0, dly: 0 },
  openHat: { level: 0.16, pan: 0.2, rev: 0.1, dly: 0 },
  crash: { level: 0.22, pan: -0.15, rev: 0.2, dly: 0 },
  bass: { level: 0.45, pan: 0, rev: 0, dly: 0 },
  sub: { level: 0.55, pan: 0, rev: 0, dly: 0 },
  lead: { level: 0.28, pan: 0, rev: 0.25, dly: 0.3 },
  stab: { level: 0.2, pan: 0, rev: 0.2, dly: 0 },
  pad: { level: 0.12, pan: 0, rev: 0.35, dly: 0 },
  arp: { level: 0.14, pan: -0.25, rev: 0.2, dly: 0.25 },
  keys: { level: 0.22, pan: 0, rev: 0.3, dly: 0 },
  bell: { level: 0.22, pan: 0.15, rev: 0.35, dly: 0.2 },
  brass: { level: 0.3, pan: 0, rev: 0.25, dly: 0 },
};

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  return f;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

function panner(ctx: BaseAudioContext, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

function run(sources: readonly AudioScheduledSourceNode[], t: number, stop: number): void {
  for (const s of sources) {
    s.start(t);
    s.stop(stop);
  }
}

/** One mixer per song playback (channels, reverb, delay), so the song fades as a whole, tails included. */
export function createSongOutput(
  ctx: BaseAudioContext,
  dest: AudioNode,
  stepSec: number,
  noise: AudioBuffer,
  impulse: AudioBuffer,
): SongOutput {
  const out = gain(ctx, 1);
  out.connect(dest);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  reverb.connect(gain(ctx, 0.5)).connect(out);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = 3 * stepSec; // dotted 8th
  delay.connect(gain(ctx, 0.6)).connect(out);
  delay.connect(gain(ctx, 0.35)).connect(filter(ctx, "lowpass", 3000)).connect(delay);

  const channel = {} as Record<InstrumentId, AudioNode>;
  for (const [inst, m] of Object.entries(MIX) as [InstrumentId, (typeof MIX)[InstrumentId]][]) {
    const input = gain(ctx, m.level);
    const pan = panner(ctx, m.pan);
    input.connect(pan).connect(out);
    if (m.rev > 0) pan.connect(gain(ctx, m.rev)).connect(reverb);
    if (m.dly > 0) pan.connect(gain(ctx, m.dly)).connect(delay);
    channel[inst] = input;
  }
  return { ctx, noise, out, channel };
}

/** Noise → filter → enveloped gain → dest; the source stops after the envelope. */
function noiseHit(o: SongOutput, t: number, f: BiquadFilterNode, attack: number, peak: number, decay: number, dest: AudioNode): void {
  const g = o.ctx.createGain();
  envelope(g.gain, t, attack, peak, decay);
  f.connect(g).connect(dest);
  playNoise(o.ctx, o.noise, t, attack + decay, f);
}

export function playNote(o: SongOutput, e: NoteEvent, t: number, stepSec: number): void {
  const ctx = o.ctx;
  const dest = o.channel[e.inst];
  const dur = e.steps * stepSec;
  const v = e.vel;
  const f = midiFreq(e.midi);

  switch (e.inst) {
    case "kick": {
      const body = osc(ctx, "sine", 150);
      body.frequency.setValueAtTime(150, t);
      body.frequency.exponentialRampToValueAtTime(45, t + 0.07);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.003, v, 0.35);
      body.connect(g).connect(dest);
      run([body], t, t + 0.4);
      noiseHit(o, t, filter(ctx, "highpass", 3000), 0.001, 0.3 * v, 0.01, dest);
      return;
    }
    case "snare": {
      noiseHit(o, t, filter(ctx, "highpass", 900), 0.002, 0.8 * v, 0.18, dest);
      const body = osc(ctx, "triangle", 185);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.002, 0.5 * v, 0.07);
      body.connect(g).connect(dest);
      run([body], t, t + 0.1);
      return;
    }
    case "hat":
      noiseHit(o, t, filter(ctx, "highpass", 7500), 0.001, 0.6 * v, 0.035, dest);
      return;
    case "openHat":
      noiseHit(o, t, filter(ctx, "highpass", 6500), 0.002, 0.6 * v, 0.22, dest);
      return;
    case "crash":
      noiseHit(o, t, filter(ctx, "highpass", 4500), 0.002, 0.8 * v, 1.4, dest);
      return;

    case "bass": {
      const saw = osc(ctx, "sawtooth", f);
      const sq = osc(ctx, "square", f, -5);
      const lp = filter(ctx, "lowpass", 2400, 5);
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(350, t + 0.18);
      saw.connect(lp);
      sq.connect(gain(ctx, 0.5)).connect(lp);
      const g = ctx.createGain();
      const stop = noteEnvelope(g.gain, t, dur, 0.004, v, 0.6, 0.05, 0.03);
      lp.connect(g).connect(dest);
      run([saw, sq], t, stop);
      return;
    }
    case "sub": {
      const tri = osc(ctx, "triangle", f);
      const sine = osc(ctx, "sine", f / 2);
      const lp = filter(ctx, "lowpass", 900);
      tri.connect(lp);
      sine.connect(gain(ctx, 0.5)).connect(lp);
      const g = ctx.createGain();
      const stop = noteEnvelope(g.gain, t, dur, 0.01, v, 0.85, 0.2, 0.05);
      lp.connect(g).connect(dest);
      run([tri, sine], t, stop);
      return;
    }
    case "lead": {
      const a = osc(ctx, "sawtooth", f, -8);
      const b = osc(ctx, "sawtooth", f, 8);
      const low = osc(ctx, "square", f / 2);
      const lp = filter(ctx, "lowpass", 3800, 1);
      a.connect(lp);
      b.connect(lp);
      low.connect(gain(ctx, 0.3)).connect(lp);
      const lfo = osc(ctx, "sine", 5.5);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + 0.15);
      depth.gain.linearRampToValueAtTime(12, t + 0.45);
      lfo.connect(depth);
      for (const o2 of [a, b, low]) depth.connect(o2.detune);
      const g = ctx.createGain();
      const stop = noteEnvelope(g.gain, t, dur, 0.01, v, 0.75, 0.07, 0.03);
      lp.connect(g).connect(dest);
      run([a, b, low, lfo], t, stop);
      return;
    }
    case "stab":
    case "pad": {
      const stab = e.inst === "stab";
      const cents = stab ? 10 : 12;
      const a = osc(ctx, "sawtooth", f, -cents);
      const b = osc(ctx, "sawtooth", f, cents);
      const lp = stab ? filter(ctx, "lowpass", 3000) : filter(ctx, "lowpass", 1400, 0.7);
      if (stab) {
        lp.frequency.setValueAtTime(3000, t);
        lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
      }
      a.connect(panner(ctx, -0.35)).connect(lp);
      b.connect(panner(ctx, 0.35)).connect(lp);
      const g = ctx.createGain();
      const stop = stab
        ? noteEnvelope(g.gain, t, dur, 0.005, v, 0.7, 0.1, 0.03)
        : noteEnvelope(g.gain, t, dur, Math.min(0.25, dur / 3), v, 1, 0.5, 0.15);
      lp.connect(g).connect(dest);
      run([a, b], t, stop);
      return;
    }
    case "arp": {
      const sq = osc(ctx, "square", f);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.003, v, 0.18);
      sq.connect(filter(ctx, "lowpass", 2500)).connect(g).connect(dest);
      run([sq], t, t + 0.2);
      return;
    }
    case "keys": {
      // FM e-piano: bright attack (high mod index) mellowing out, plus a short metallic tine.
      const car = osc(ctx, "sine", f);
      const mod = osc(ctx, "sine", f);
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 2, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.6);
      mod.connect(idx).connect(car.frequency);
      const g = ctx.createGain();
      const stop = noteEnvelope(g.gain, t, dur, 0.005, v, 0.3, 0.4, 0.05);
      car.connect(g).connect(dest);
      run([car, mod], t, stop);
      const tine = osc(ctx, "sine", f * 14);
      const tg = ctx.createGain();
      envelope(tg.gain, t, 0.001, 0.08 * v, 0.05);
      tine.connect(tg).connect(dest);
      run([tine], t, t + 0.06);
      return;
    }
    case "bell": {
      const car = osc(ctx, "sine", f);
      const mod = osc(ctx, "sine", f * 3.5);
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 2.5, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.8);
      mod.connect(idx).connect(car.frequency);
      const decay = Math.max(dur, 1.2);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.002, v, decay);
      car.connect(g).connect(dest);
      run([car, mod], t, t + 0.002 + decay + 0.02);
      return;
    }
    case "brass": {
      const a = osc(ctx, "sawtooth", f, -6);
      const b = osc(ctx, "sawtooth", f, 6);
      const lp = filter(ctx, "lowpass", 600);
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.linearRampToValueAtTime(3500, t + 0.06);
      lp.frequency.setTargetAtTime(2200, t + 0.06, 0.1);
      a.connect(lp);
      b.connect(lp);
      const g = ctx.createGain();
      const stop = noteEnvelope(g.gain, t, dur, 0.03, v, 0.85, 0.1, 0.035);
      lp.connect(g).connect(dest);
      run([a, b], t, stop);
      return;
    }
  }
}
