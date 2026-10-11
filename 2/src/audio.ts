// WebAudio-synthesized music and sound effects (no audio files).
// Every method is a no-op until unlock() has created the AudioContext.

const STEP_SEC = 0.2; // 150 BPM eighth notes
const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_MS = 25;
const MUSIC_LEVEL = 0.18;
const SFX_LEVEL = 0.5;
const ENGINE_LEVEL = 0.05;

type Note = number | null;

// prettier-ignore
const LEAD: readonly Note[] = [
  72, null, 76, 79, 84, 79, 76, 79, 81, null, 76, 72, 69, 72, 76, null,
  77, null, 81, 84, 89, 84, 81, 77, 79, 83, 86, 83, 79, 77, 74, 71,
];
// prettier-ignore
const BASS: readonly Note[] = [
  48, null, 55, null, 48, null, 55, null, 45, null, 52, null, 45, null, 52, null,
  41, null, 48, null, 41, null, 48, null, 43, null, 50, null, 43, null, 50, null,
];

const midiFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export class GameAudio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicOn = true;
  private soundOn = true;
  private seqTimer: number | null = null;
  private seqStep = 0;
  private seqNext = 0;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

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

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
    this.musicGain.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.soundOn ? SFX_LEVEL : 0;
    this.sfxGain.connect(ctx.destination);

    const len = ctx.sampleRate; // 1 s of white noise
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    if (this.musicOn) this.startMusic();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.01);
    if (on) this.startMusic();
    else this.stopMusic();
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (!this.ctx || !this.sfxGain) return;
    this.sfxGain.gain.setTargetAtTime(on ? SFX_LEVEL : 0, this.ctx.currentTime, 0.01);
  }

  beep(final: boolean): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone("square", final ? 880 : 440, null, t, final ? 0.4 : 0.15, 0.5, this.sfxGain!);
  }

  correct(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const out = this.sfxGain!;
    this.tone("square", 660, null, t, 0.08, 0.4, out);
    this.tone("square", 990, null, t + 0.08, 0.08, 0.4, out);
    const f = this.ctx!.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
    this.noiseBurst(t, 0.3, 0.5, f, out);
  }

  wrong(): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone("sawtooth", 180, 90, t, 0.35, 0.4, this.sfxGain!);
  }

  overtake(): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone("triangle", 880, 1320, t, 0.1, 0.5, this.sfxGain!);
  }

  overtaken(): void {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone("triangle", 440, 330, t, 0.12, 0.5, this.sfxGain!);
  }

  crash(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const out = this.sfxGain!;
    const f = this.ctx!.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(2000, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.8);
    this.noiseBurst(t, 0.8, 0.9, f, out);
    this.tone("sawtooth", 120, 40, t, 0.8, 0.4, out);
  }

  finish(): void {
    const t = this.sfxTime();
    if (t === null) return;
    const out = this.sfxGain!;
    [72, 76, 79].forEach((m, i) => this.tone("square", midiFreq(m), null, t + i * 0.12, 0.12, 0.35, out));
    this.tone("square", midiFreq(84), null, t + 0.36, 0.5, 0.35, out);
  }

  engine(on: boolean, speedNorm = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    if (!this.engineOsc || !this.engineGain) {
      if (!on) return;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(lp).connect(g).connect(this.sfxGain);
      osc.start(now);
      this.engineOsc = osc;
      this.engineGain = g;
    }
    const s = Math.min(2, Math.max(0, Number.isFinite(speedNorm) ? speedNorm : 0));
    this.engineOsc.frequency.setTargetAtTime(60 + 80 * s, now, 0.05);
    this.engineGain.gain.setTargetAtTime(on && this.soundOn ? ENGINE_LEVEL : 0, now, 0.05);
  }

  // ---- internals ----

  /** Start time for an sfx, or null when audio is locked or sound is off. */
  private sfxTime(): number | null {
    if (!this.ctx || !this.sfxGain || !this.soundOn) return null;
    return this.ctx.currentTime;
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number | null,
    t: number,
    dur: number,
    peak: number,
    out: AudioNode,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, peak: number, filter: BiquadFilterNode, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn || this.seqTimer !== null) return;
    this.seqStep = 0;
    this.seqNext = ctx.currentTime + 0.05;
    this.seqTimer = window.setInterval(() => this.schedule(), SCHEDULER_MS);
    this.schedule();
  }

  private stopMusic(): void {
    if (this.seqTimer === null) return;
    window.clearInterval(this.seqTimer);
    this.seqTimer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const out = this.musicGain;
    if (!ctx || !out) return;
    // After a long stall (e.g. background tab) skip ahead instead of bursting notes.
    if (this.seqNext < ctx.currentTime) this.seqNext = ctx.currentTime + 0.02;
    while (this.seqNext < ctx.currentTime + LOOKAHEAD_SEC) {
      const t = this.seqNext;
      const step = this.seqStep;
      const lead = LEAD[step];
      if (lead != null) this.tone("square", midiFreq(lead), null, t, 0.18, 0.5, out);
      const bass = BASS[step];
      if (bass != null) this.tone("triangle", midiFreq(bass), null, t, 0.38, 0.8, out);
      if (step % 2 === 1) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7000;
        this.noiseBurst(t, 0.03, 0.15, hp, out);
      }
      this.seqStep = (step + 1) % LEAD.length;
      this.seqNext += STEP_SEC;
    }
  }
}
