// Song notation and compiler (pure data, no WebAudio). A step is a 16th note, 16 steps per bar.
//
// Drum lines: one char per step; `X` hit, `x` softer hit, `o` ghost, `.` rest (whitespace and `|` ignored).
// Tone lines: whitespace-separated tokens, one per step; `.` rest, `-` sustain the previous onset,
// `C4` / `A3+C#4+E4` note or chord, `tok*N` repeats a token N times, `|` bar separators are ignored.

export type DrumId = "kick" | "snare" | "hat" | "openHat" | "crash";
export type ToneId = "bass" | "sub" | "lead" | "stab" | "pad" | "arp" | "keys" | "bell" | "brass";
export type InstrumentId = DrumId | ToneId;
export const DRUM_IDS: readonly DrumId[] = ["kick", "snare", "hat", "openHat", "crash"];

export interface PatternDef {
  bars: number;
  lines: Partial<Record<InstrumentId, string>>;
}

export interface SongDef {
  bpm: number;
  patterns: Record<string, PatternDef>;
  /** Played in order; `t` = semitone transpose (tone instruments only). */
  order: readonly { p: string; t?: number }[];
  /** Index into `order` where the loop restarts; null = play once (jingle). */
  loopFrom: number | null;
}

export interface NoteEvent {
  inst: InstrumentId;
  midi: number;
  steps: number;
  vel: number;
}

export interface CompiledSong {
  /** 60 / bpm / 4 (16th notes). */
  stepSec: number;
  /** Events starting at each absolute step. */
  steps: readonly (readonly NoteEvent[])[];
  /** First step of order[loopFrom]; null = play once. */
  loopStep: number | null;
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DRUM_VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.45 };
const TONE_VEL = 0.8;
const STEPS_PER_BAR = 16;

export function noteToMidi(name: string): number {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1]] + (m[2] ? 1 : 0);
}

type LineEvent = { step: number; midi: number; steps: number; vel: number };

export function parseLine(inst: InstrumentId, line: string): { events: LineEvent[]; length: number } {
  const events: LineEvent[] = [];
  if ((DRUM_IDS as readonly string[]).includes(inst)) {
    const chars = line.replace(/[\s|]/g, "");
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === ".") continue;
      const vel = DRUM_VEL[c];
      if (vel === undefined) throw new Error(`${inst}: bad drum char "${c}" at step ${i}`);
      events.push({ step: i, midi: 0, steps: 1, vel });
    }
    return { events, length: chars.length };
  }

  const tokens: string[] = [];
  for (const raw of line.split(/\s+/)) {
    if (raw === "" || raw === "|") continue;
    const rep = /^(.+)\*(\d+)$/.exec(raw);
    if (!rep) {
      tokens.push(raw);
      continue;
    }
    const n = Number(rep[2]);
    if (n < 1) throw new Error(`${inst}: bad repeat "${raw}"`);
    for (let k = 0; k < n; k++) tokens.push(rep[1]);
  }

  let onset: LineEvent[] | null = null; // notes started at the most recent onset; null after a rest
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === ".") {
      onset = null;
    } else if (tok === "-") {
      if (!onset) throw new Error(`${inst}: "-" without a note at step ${i}`);
      for (const e of onset) e.steps++;
    } else {
      onset = tok.split("+").map((n) => ({ step: i, midi: noteToMidi(n), steps: 1, vel: TONE_VEL }));
      events.push(...onset);
    }
  }
  return { events, length: tokens.length };
}

export function compileSong(id: string, def: SongDef): CompiledSong {
  const steps: NoteEvent[][] = [];
  let loopStep: number | null = null;
  def.order.forEach(({ p, t = 0 }, idx) => {
    const pat = def.patterns[p];
    if (!pat) throw new Error(`${id}: missing pattern "${p}"`);
    const start = steps.length;
    if (idx === def.loopFrom) loopStep = start;
    const n = pat.bars * STEPS_PER_BAR;
    for (let i = 0; i < n; i++) steps.push([]);
    for (const [inst, line] of Object.entries(pat.lines) as [InstrumentId, string][]) {
      const { events, length } = parseLine(inst, line);
      if (length === 0 || n % length !== 0) throw new Error(`${id}/${p}/${inst}: ${length} steps does not divide ${n}`);
      const shift = (DRUM_IDS as readonly string[]).includes(inst) ? 0 : t;
      for (let tile = 0; tile < n; tile += length) {
        for (const e of events) {
          steps[start + tile + e.step].push({ inst, midi: e.midi + shift, steps: e.steps, vel: e.vel });
        }
      }
    }
  });
  return { stepSec: 60 / def.bpm / 4, steps, loopStep };
}
