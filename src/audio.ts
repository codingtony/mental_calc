// WebAudio-synthesized music and sound effects (no audio files).
// Every method is a no-op until unlock() has created the AudioContext.
import type { CompiledSong } from "./music";
import { mulberry32 } from "./rng";
import { SONGS, type SongId } from "./songs";
import {
  createSongOutput,
  envelope,
  makeImpulse,
  makeNoise,
  playNoise,
  playNote,
  type SongOutput,
} from "./synth";

const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_MS = 25;
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 0.6;
const ENGINE_LEVEL = 0.22;

const IDLE_RPM = 1600;
const REDLINE_RPM = 11000;
/** speedNorm at which each gear reaches the redline. */
const GEAR_TOP = [0.45, 0.8, 1.15, 1.5, 2.0];

const FLOOR = 0.0001;

interface Playback {
  id: SongId;
  song: CompiledSong;
  out: SongOutput;
  step: number;
  next: number;
  /** Song started seamlessly when this one (a jingle) ends. */
  then: SongId | null;
}

interface EngineNodes {
  pulse: OscillatorNode;
  mech: OscillatorNode;
  mechBp: BiquadFilterNode;
  hiss: AudioBufferSourceNode;
  hissBp: BiquadFilterNode;
  lfo: OscillatorNode;
  tone: BiquadFilterNode;
  gain: GainNode;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Saturation curve for the engine: tanh(2.5x) normalised to ±1. */
function shaperCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(2.5 * ((i / (n - 1)) * 2 - 1)) / Math.tanh(2.5);
  return curve;
}

/** Firing-pulse waveform: 24 harmonics, odd ones boosted, fixed pseudo-random phases. */
function pulseWave(ctx: BaseAudioContext): PeriodicWave {
  const rnd = mulberry32(7);
  const real = new Float32Array(25);
  const imag = new Float32Array(25);
  for (let n = 1; n <= 24; n++) {
    const a = (1 / n ** 0.7) * (n % 2 === 1 ? 1.3 : 1);
    const phi = rnd() * 2 * Math.PI;
    real[n] = a * Math.cos(phi);
    imag[n] = a * Math.sin(phi);
  }
  return ctx.createPeriodicWave(real, imag);
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private impulse: AudioBuffer | null = null;
  private musicOn = false;
  private soundOn = false;

  private wanted: SongId | null = null;
  private playback: Playback | null = null;
  private seqTimer: number | null = null;

  private eng: EngineNodes | null = null;
  private gear = 0;
  private throttle = 0.3;
  private lastS = 0;
  private lastT = 0;
  private shiftUntil = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === "undefined") return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    this.ctx = ctx;
    if (ctx.state === "suspended") void ctx.resume();

    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -12;
    master.knee.value = 12;
    master.ratio.value = 4;
    master.attack.value = 0.005;
    master.release.value = 0.2;
    master.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
    this.musicGain.connect(master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.soundOn ? SFX_LEVEL : 0;
    this.sfxGain.connect(master);

    this.noise = makeNoise(ctx);
    this.impulse = makeImpulse(ctx);

    if (this.musicOn && this.wanted !== null) this.start(this.wanted, null);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.01);
    if (!on) this.stopPlayback();
    // A pending jingle is skipped: `wanted` already holds its follow-up song.
    else if (this.playback === null && this.wanted !== null) this.start(this.wanted, null);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (!this.ctx || !this.sfxGain) return;
    this.sfxGain.gain.setTargetAtTime(on ? SFX_LEVEL : 0, this.ctx.currentTime, 0.01);
  }

  /** Loops `id` (null = silence). A song already playing keeps playing (menus span several screens). */
  setSong(id: SongId | null): void {
    this.wanted = id;
    if (!this.ctx || !this.musicOn) return;
    if (this.playback?.id === id && this.playback.then === null) return;
    this.stopPlayback();
    if (id !== null) this.start(id, null);
  }

  /** Plays jingle `id` once, then continues seamlessly with song `then`. */
  playJingle(id: SongId, then: SongId): void {
    this.wanted = then;
    if (!this.ctx || !this.musicOn) return;
    this.stopPlayback();
    this.start(id, then);
  }

  /** Start-light beep; also blips the idling engine. */
  beep(final: boolean): void {
    const t = this.sfxTime();
    if (t === null) return;
    const ctx = this.ctx!;
    const freq = final ? 1320 : 660;
    const total = final ? 0.6 : 0.18;
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.setValueAtTime(0.5, t + total - 0.04);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + total);
    g.connect(this.sfxGain!);
    const fund = ctx.createOscillator();
    fund.frequency.value = freq;
    fund.connect(g);
    const harm = ctx.createOscillator();
    harm.frequency.value = 2 * freq;
    const hg = ctx.createGain();
    hg.gain.value = 0.15;
    harm.connect(hg).connect(g);
    for (const o of [fund, harm]) {
      o.start(t);
      o.stop(t + total + 0.02);
    }
    if (this.eng) {
      this.applyRpm(final ? 8000 : 6000, this.throttle, t, 0.04);
      this.applyRpm(IDLE_RPM, this.throttle, t + 0.2, 0.12);
    }
  }

  /** Correct answer: chime, boost whoosh and two backfire pops. */
  correct(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const out = this.sfxGain!;
    for (const [f, dt] of [
      [1318.5, 0],
      [1975.5, 0.07],
    ]) {
      this.tone("sine", f, null, t + dt, 0.253, 0.25, out, 0.003);
      this.tone("triangle", f, null, t + dt, 0.253, 0.25, out, 0.003);
    }
    const bp = this.filter("bandpass", 500, 0.9);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.35);
    this.noiseBurst(t, 0.5, 0.35, bp, out, 0.05);
    for (const dt of [0.32, 0.4]) this.noiseBurst(t + dt, 0.04, 0.4, this.filter("lowpass", 900), out);
  }

  /** Wrong answer: tyre skid over the 0.6 s spin, plus a soft thud. */
  wrong(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const ctx = this.ctx!;
    const out = this.sfxGain!;
    const skid = this.filter("bandpass", 1800, 8);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 300;
    lfo.connect(depth).connect(skid.frequency);
    lfo.start(t);
    lfo.stop(t + 0.62);
    this.noiseBurst(t, 0.57, 0.45, skid, out, 0.02);
    this.noiseBurst(t, 0.57, 0.25, this.filter("bandpass", 2600, 10), out, 0.02);
    this.tone("sine", 160, 70, t, 0.25, 0.4, out);
  }

  /** The player passes a rival (right → left). */
  overtake(): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.passBy(t, 230, 160, 0.4, -0.6, 0.3, 0.25);
    this.tone("sine", 880, 1320, t + 0.1, 0.08, 0.15, this.sfxGain!);
  }

  /** A rival passes the player (left → right, louder). */
  overtaken(): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.passBy(t, 260, 170, -0.6, 0.4, 0.35, 0.3);
    this.tone("sine", 660, 440, t + 0.1, 0.1, 0.15, this.sfxGain!);
  }

  /** Impact, debris and a metal scrape. The engine dies via endRace → engine(false). */
  crash(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const out = this.sfxGain!;
    this.tone("sine", 110, 35, t, 0.25, 0.9, out);
    const lp = this.filter("lowpass", 1500);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    this.noiseBurst(t, 0.3, 0.8, lp, out);
    [0.02, 0.09, 0.17, 0.24, 0.36, 0.47, 0.62].forEach((dt, k) => {
      const bp = this.filter("bandpass", 2500 + Math.random() * 4000, 12);
      this.noiseBurst(t + dt, 0.06 + Math.random() * 0.06, 0.5 * 0.8 ** k, bp, out, 0.002);
    });
    const scrape = this.filter("bandpass", 1500, 3);
    scrape.frequency.setValueAtTime(1500, t);
    scrape.frequency.exponentialRampToValueAtTime(700, t + 1.0);
    this.noiseBurst(t, 1.15, 0.3, scrape, out, 0.05);
  }

  /** Finish line: fluttering crowd cheer and two air-horn blasts. */
  finish(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const ctx = this.ctx!;
    const out = this.sfxGain!;
    const end = t + 2.8;
    for (const [f, q, rate] of [
      [900, 1.2, 9],
      [1700, 1.5, 13],
      [2800, 2, 17],
    ]) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.4);
      g.gain.setValueAtTime(0.25, t + 1.4);
      g.gain.exponentialRampToValueAtTime(FLOOR, end);
      // Flutter: ±30 % of the layer's level (±0.075 at the 0.25 peak), applied inside the envelope.
      const flutter = ctx.createGain();
      flutter.gain.value = 1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.075 / 0.25;
      lfo.connect(depth).connect(flutter.gain);
      lfo.start(t);
      lfo.stop(end + 0.05);
      const bp = this.filter("bandpass", f, q);
      bp.connect(flutter).connect(g).connect(out);
      playNoise(ctx, this.noise!, t, end - t, bp);
    }
    const horn = ctx.createGain();
    horn.gain.setValueAtTime(FLOOR, t);
    for (const [a, b] of [
      [0, 0.3],
      [0.4, 1.0],
    ]) {
      horn.gain.setValueAtTime(FLOOR, t + a);
      horn.gain.exponentialRampToValueAtTime(0.25, t + a + 0.02);
      horn.gain.setValueAtTime(0.25, t + b - 0.03);
      horn.gain.exponentialRampToValueAtTime(FLOOR, t + b);
    }
    const lp = this.filter("lowpass", 2200);
    lp.connect(horn).connect(out);
    for (const f of [440, 554]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.05);
    }
  }

  /** Motorbike engine; `speedNorm` = speed / cruising speed (0..2). Gears shift automatically. */
  engine(on: boolean, speedNorm = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    if (!on) {
      const e = this.eng;
      if (!e) return;
      e.gain.gain.cancelScheduledValues(now);
      e.gain.gain.setTargetAtTime(0, now, 0.05);
      for (const s of [e.pulse, e.mech, e.hiss, e.lfo]) s.stop(now + 0.4);
      this.eng = null;
      return;
    }
    if (!this.eng) {
      this.eng = this.buildEngine(ctx, this.sfxGain);
      this.gear = 0;
      this.throttle = 0.3;
      this.lastS = 0;
      this.lastT = now;
      this.shiftUntil = 0;
    }
    const e = this.eng;

    const s = clamp(Number.isNaN(speedNorm) ? 0 : speedNorm, 0, 2);
    const dt = clamp(now - this.lastT, 1 / 240, 0.1);
    let upshift = false;
    while (this.gear < 4 && s / GEAR_TOP[this.gear] >= 0.92) {
      this.gear++;
      upshift = true;
    }
    while (this.gear > 0 && s / GEAR_TOP[this.gear - 1] < 0.6) this.gear--;
    const rpm = clamp(IDLE_RPM + ((REDLINE_RPM - IDLE_RPM) * s) / GEAR_TOP[this.gear], IDLE_RPM, REDLINE_RPM);
    const target = clamp(0.45 + (4 * (s - this.lastS)) / dt, 0.15, 1);
    this.throttle += (target - this.throttle) * (1 - Math.exp(-8 * dt));
    this.applyRpm(rpm, this.throttle, now, upshift ? 0.03 : 0.08);

    const level = this.soundOn ? ENGINE_LEVEL * (0.55 + 0.45 * this.throttle) : 0;
    if (upshift) {
      // Throttle cut while the clutch is in.
      e.gain.gain.cancelScheduledValues(now);
      e.gain.gain.setTargetAtTime(level * 0.3, now, 0.01);
      e.gain.gain.setTargetAtTime(level, now + 0.07, 0.03);
      this.shiftUntil = now + 0.1;
    } else if (now >= this.shiftUntil) {
      e.gain.gain.setTargetAtTime(level, now, 0.05);
    }
    this.lastS = s;
    this.lastT = now;
  }

  // ---- internals ----

  private buildEngine(ctx: AudioContext, dest: AudioNode): EngineNodes {
    const fire = IDLE_RPM / 60;
    const mix = ctx.createGain();

    const pulse = ctx.createOscillator();
    pulse.setPeriodicWave(pulseWave(ctx));
    pulse.frequency.value = fire;
    const pulseAmp = ctx.createGain();
    pulseAmp.gain.value = 0.6;
    pulse.connect(pulseAmp).connect(mix);

    const mech = ctx.createOscillator();
    mech.type = "sawtooth";
    mech.frequency.value = 2 * fire;
    const mechBp = this.filter("bandpass", 6 * fire, 2);
    const mechAmp = ctx.createGain();
    mechAmp.gain.value = 0.18;
    mech.connect(mechBp).connect(mechAmp).connect(mix);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const hissBp = this.filter("bandpass", Math.min(8 * fire, 5000), 1.2);
    const hissAmp = ctx.createGain();
    hissAmp.gain.value = 0.15;
    hiss.connect(hissBp).connect(hissAmp).connect(mix);
    const chop = ctx.createGain(); // the hiss chops with each firing
    chop.gain.value = 0.15;
    pulse.connect(chop).connect(hissAmp.gain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.3;
    const wobble = ctx.createGain();
    wobble.gain.value = 8;
    lfo.connect(wobble);
    wobble.connect(pulse.detune);
    wobble.connect(mech.detune);

    const tone = this.filter("lowpass", 300 + 2200 * 0.3 + (1200 * IDLE_RPM) / REDLINE_RPM, 0.8);
    const shaper = ctx.createWaveShaper();
    shaper.curve = shaperCurve();
    shaper.oversample = "2x";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    mix.connect(tone).connect(shaper).connect(gain).connect(dest);

    const now = ctx.currentTime;
    for (const s of [pulse, mech, hiss, lfo]) s.start(now);
    return { pulse, mech, mechBp, hiss, hissBp, lfo, tone, gain };
  }

  private applyRpm(rpm: number, throttle: number, t: number, tau: number): void {
    const e = this.eng!;
    const fire = rpm / 60;
    e.pulse.frequency.setTargetAtTime(fire, t, tau);
    e.mech.frequency.setTargetAtTime(2 * fire, t, tau);
    e.mechBp.frequency.setTargetAtTime(6 * fire, t, tau);
    e.hissBp.frequency.setTargetAtTime(Math.min(8 * fire, 5000), t, tau);
    e.tone.frequency.setTargetAtTime(300 + 2200 * throttle + (1200 * rpm) / REDLINE_RPM, t, tau);
  }

  private start(id: SongId, then: SongId | null, at?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.noise || !this.impulse) return;
    const song = SONGS[id];
    const out = createSongOutput(ctx, this.musicGain, song.stepSec, this.noise, this.impulse);
    this.playback = { id, song, out, step: 0, next: at ?? ctx.currentTime + 0.06, then };
    if (this.seqTimer === null) this.seqTimer = window.setInterval(() => this.schedule(), SCHEDULER_MS);
    this.schedule();
  }

  private stopPlayback(): void {
    if (this.playback) this.fadeOut(this.playback);
    this.playback = null;
    this.stopTimer();
  }

  private fadeOut(pb: Playback): void {
    pb.out.out.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.08);
    window.setTimeout(() => pb.out.out.disconnect(), 1500);
  }

  private stopTimer(): void {
    if (this.seqTimer === null) return;
    window.clearInterval(this.seqTimer);
    this.seqTimer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const pb = this.playback;
    if (!ctx || !pb) {
      this.stopTimer();
      return;
    }
    // After a long stall (e.g. background tab) skip ahead instead of bursting notes.
    if (pb.next < ctx.currentTime) pb.next = ctx.currentTime + 0.02;
    const { steps, stepSec, loopStep } = pb.song;
    while (this.playback === pb && pb.next < ctx.currentTime + LOOKAHEAD_SEC) {
      for (const e of steps[pb.step]) playNote(pb.out, e, pb.next, stepSec);
      pb.step++;
      pb.next += stepSec;
      if (pb.step < steps.length) continue;
      if (loopStep !== null) {
        pb.step = loopStep;
      } else if (pb.then !== null) {
        const tail = pb.out.out; // let the jingle's last notes and reverb ring out
        window.setTimeout(() => tail.disconnect(), 3000);
        this.start(pb.then, null, pb.next);
      } else {
        this.playback = null;
      }
    }
    if (this.playback === null) this.stopTimer();
  }

  /** Engine-ish sawtooth and road noise sweeping across the stereo field (doppler-like pitch drop). */
  private passBy(t: number, f0: number, f1: number, panFrom: number, panTo: number, sawPeak: number, noisePeak: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(panFrom, t);
    pan.pan.linearRampToValueAtTime(panTo, t + 0.45);
    pan.connect(this.sfxGain!);

    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(f0, t);
    saw.frequency.exponentialRampToValueAtTime(f1, t + 0.45);
    const sg = ctx.createGain();
    envelope(sg.gain, t, 0.2, sawPeak, 0.3);
    saw.connect(this.filter("lowpass", 1200)).connect(sg).connect(pan);
    saw.start(t);
    saw.stop(t + 0.52);

    const bp = this.filter("bandpass", 1200);
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.45);
    this.noiseBurst(t, 0.5, noisePeak, bp, pan, 0.2);
  }

  /** Start time for an sfx, or null when audio is locked or sound is off. */
  private sfxTime(): number | null {
    if (!this.ctx || !this.sfxGain || !this.soundOn) return null;
    return this.ctx.currentTime;
  }

  private filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  /** Oscillator from f0 (exp glide to f1 over `dur` if given) with an attack/decay envelope ending at t+dur. */
  private tone(
    type: OscillatorType,
    f0: number,
    f1: number | null,
    t: number,
    dur: number,
    peak: number,
    out: AudioNode,
    attack = 0.005,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    envelope(g.gain, t, attack, peak, dur - attack);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Noise → `filter` with an attack/decay envelope ending at t+dur. */
  private noiseBurst(t: number, dur: number, peak: number, filter: BiquadFilterNode, out: AudioNode, attack = 0.005): void {
    const g = this.ctx!.createGain();
    envelope(g.gain, t, attack, peak, dur - attack);
    filter.connect(g).connect(out);
    playNoise(this.ctx!, this.noise!, t, dur, filter);
  }
}
