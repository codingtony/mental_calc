// Composed music as notation data (see music.ts for the format).
import { compileSong, type CompiledSong, type SongDef } from "./music";

export type SongId =
  | "menu"
  | "meadowRace"
  | "showcaseRace"
  | "coastRace"
  | "nightRace"
  | "iceRace"
  | "desertRace"
  | "cityRace"
  | "forestRace"
  | "jingleWin"
  | "jingleLose"
  | "victoryFanfare";

// ---- "Meadow Rush": race song, 150 BPM, D major, last chorus up to E ----

const VERSE_KICK = "X.......X.x.....";
const VERSE_SNARE = "....X.......X...";
const VERSE_HAT = "X.x.X.x.X.x.X.x.";
// prettier-ignore
const VERSE_BASS = "B2 . B2 . B3 . B2 . B2 . B2 . B3 . B2 . | G2 . G2 . G3 . G2 . G2 . G2 . G3 . G2 . | D3 . D3 . D4 . D3 . D3 . D3 . D4 . D3 . | A2 . A2 . A3 . A2 . A2 . B2 . C#3 . A2 .";
const VERSE_PAD = "B3+D4+F#4 -*15 | G3+B3+D4 -*15 | A3+D4+F#4 -*15 | A3+C#4+E4 -*15";
const VERSE = { kick: VERSE_KICK, snare: VERSE_SNARE, hat: VERSE_HAT, bass: VERSE_BASS, pad: VERSE_PAD };

const CH_D = "A3+D4+F#4";
const CH_A = "A3+C#4+E4";
const CH_BM = "B3+D4+F#4";
const CH_G = "B3+D4+G4";
const stabBar = (c: string): string => `. . ${c} - . . ${c} - . . ${c} - . . ${c} -`;

// prettier-ignore
const MEADOW_RACE: SongDef = {
  bpm: 150,
  patterns: {
    intro: { bars: 2, lines: {
      kick: "X.....X.....X...|X.....X.....X...",
      snare: "................|..x...x...x.xxXX",
      hat: "x.x.x.x.x.x.x.x.",
      crash: "X...............|................",
      stab: "B3+D4+G4 - - . . . B3+D4+G4 - - . . . B3+D4+G4 - - - | A3+C#4+E4 - - . . . A3+C#4+E4 - - . . . A3+C#4+E4 - - -",
      bass: "G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . | A2 . A2 . A2 . A2 . A3 . G3 . E3 . C#3 .",
    } },
    verseA: { bars: 4, lines: {
      ...VERSE,
      crash: "X...............|................|................|................",
      lead: "F#5 - . F#5 - . E5 - D5 - . B4 - - . . | G5 - . G5 - . F#5 - E5 - . D5 - - E5 - | F#5 - . A5 - . F#5 - E5 - . D5 - - . . | E5 -*3 C#5 -*3 A4 -*3 .*4",
    } },
    verseB: { bars: 4, lines: {
      ...VERSE,
      lead: "F#5 - . F#5 - . E5 - D5 - . B4 - - . . | G5 - . G5 - . F#5 - E5 - . D5 - - E5 - | A5 - . A5 - . B5 - A5 - . F#5 - - D5 - | E5 -*7 E5 F#5 E5 D5 C#5 - A4 -",
    } },
    pre: { bars: 4, lines: {
      kick: "X...X...X...X...",
      snare: "....X.......X...|....X.......X...|....X.......X...|x.x.x.x.xxxxXXXX",
      hat: "xoxoxoxoxoxoxoxo",
      bass: "E2 . E2 . E3 . E2 . E2 . E2 . E3 . E2 . | G2 . G2 . G3 . G2 . G2 . G2 . G3 . G2 . | A2 . A2 . A3 . A2 . A2 . A2 . A3 . A2 . | A2*8 A3*8",
      pad: "G3+B3+E4 -*15 | G3+B3+D4 -*15 | A3+C#4+E4 -*15 | A3+D4+E4 -*7 A3+C#4+E4 -*7",
      lead: "B4 -*3 E5 -*3 G5 -*3 F#5 - E5 - | D5 -*3 G5 -*3 B5 -*3 A5 - G5 - | A5 -*7 E5 -*3 C#5 -*3 | D5 -*7 C#5 -*7",
    } },
    chorus: { bars: 8, lines: {
      kick: "X...X...X...X...",
      snare: "....X.......X...",
      hat: "xo.oxo.oxo.oxo.o",
      openHat: "..x...x...x...x.",
      crash: "X...............|................|................|................",
      bass: "D2 . D3 . D2 . D3 . D2 . D3 . D2 . D3 . | A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 . | B2 . B3 . B2 . B3 . B2 . B3 . B2 . B3 . | G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 . | D2 . D3 . D2 . D3 . D2 . D3 . D2 . D3 . | A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 . | G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 . | A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 .",
      stab: [CH_D, CH_A, CH_BM, CH_G, CH_D, CH_A, CH_G, CH_A].map(stabBar).join(" | "),
      lead: "A5 - - F#5 - - D5 - E5 - F#5 - A5 - - - | C#6 - - A5 - - E5 - F#5 - E5 - C#5 - - - | D6 - - B5 - - F#5 - A5 - B5 - D6 - - - | B5 -*3 A5 -*3 G5 - F#5 - E5 -*3 | A5 - - F#5 - - D5 - E5 - F#5 - A5 - - - | C#6 - - A5 - - E5 - F#5 - E5 - C#5 - - - | D6 - - B5 - - G5 - B5 - D6 - E6 - - - | C#6 -*7 E6 -*3 C#6 - A5 -",
    } },
    break: { bars: 4, lines: {
      kick: "X.......X.......",
      snare: "................|................|................|........x.x.xxXX",
      hat: "..x...x...x...x.",
      arp: "B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5 | G4 B4 D5 B4 G4 B4 D5 B4 G4 B4 D5 B4 G4 B4 D5 B4 | E4 G4 B4 G4 E4 G4 B4 G4 E4 G4 B4 G4 E4 G4 B4 G4 | A4 C#5 E5 C#5 A4 C#5 E5 C#5 A4 C#5 E5 A5 C#6 A5 E5 C#5",
      pad: "B3+D4+F#4 -*15 | G3+B3+D4 -*15 | G3+B3+E4 -*15 | A3+C#4+E4 -*15",
      bass: "B2 -*15 | G2 -*15 | E2 -*15 | A2 -*7 A2 . A2 . A3 . A3 .",
    } },
  },
  order: [{ p: "intro" }, { p: "verseA" }, { p: "verseB" }, { p: "pre" }, { p: "chorus" }, { p: "break" }, { p: "chorus", t: 2 }],
  loopFrom: 1,
};

// ---- "Pit Lane": menu song, 128 BPM, A major, driving arpeggios and off-beat stabs ----

/** Chord voicings for stabs and pads (same register as the race song). */
const M_A = "A3+C#4+E4";
const M_E = "G#3+B3+E4";
const M_FSM = "A3+C#4+F#4";
const M_D = "A3+D4+F#4";
/** Running 16th arpeggio over four chord tones; the 6-step cycle rolls across the beat. */
const arpBar = (a: string, b: string, c: string, d: string): string => `${a} ${b} ${c} ${d} ${c} ${b} ${a} ${b} ${c} ${d} ${c} ${b} ${a} ${b} ${c} ${d}`;
/** Syncopated chord stab. */
const syncBar = (c: string): string => `${c} - . ${c} - . ${c} - . . ${c} - . ${c} - .`;
/** Pick-bass 8ths with octave pops. */
const pumpBar = (lo: string, hi: string): string => `${lo} . ${lo} ${hi} . ${lo} ${lo} . ${lo} . ${lo} ${hi} . ${lo} ${lo} .`;

const MENU_A = {
  kick: "X...X...X...X...",
  snare: "....X.......X...",
  hat: "x.xox.xox.xox.xo",
  openHat: "......x.......x.",
  arp: [
    arpBar("A4", "C#5", "E5", "A5"),
    arpBar("G#4", "B4", "E5", "G#5"),
    arpBar("F#4", "A4", "C#5", "F#5"),
    arpBar("F#4", "A4", "D5", "F#5"),
  ].join(" | "),
  stab: [M_A, M_E, M_FSM, M_D].map(syncBar).join(" | "),
  bass: [pumpBar("A2", "A3"), pumpBar("E2", "E3"), pumpBar("F#2", "F#3"), pumpBar("D2", "D3")].join(" | "),
};
const MENU_BELL_HEAD = "C#6 - . A5 - . E5 - F#5 - E5 - C#5 - . . | B5 - . G#5 - . E5 - B5 - . G#5 - B5 - .";

// prettier-ignore
const MENU: SongDef = {
  bpm: 128,
  patterns: {
    intro: { bars: 2, lines: {
      kick: "X...X...X...X...",
      snare: "................|....x...x.x.xxXX",
      hat: "x.x.x.x.x.x.x.x.",
      crash: "X...............|................",
      arp: `${arpBar("A4", "C#5", "E5", "A5")} | ${arpBar("G#4", "B4", "E5", "G#5")}`,
      bass: "A2 . A2 . A2 . A2 . A2 . A2 . A2 . A2 . | E2 . E2 . E2 . E2 . E3 . D3 . C#3 . B2 .",
    } },
    A1: { bars: 4, lines: {
      ...MENU_A,
      crash: "X...............|................|................|................",
      bell: `${MENU_BELL_HEAD} | A5 - . F#5 - . C#5 - E5 - F#5 - A5 - C#6 - | B5 -*7 A5 - F#5 - E5 - D5 -`,
    } },
    A2: { bars: 4, lines: {
      ...MENU_A,
      bell: `${MENU_BELL_HEAD} | A5 - . F#5 - . C#5 - F#5 - A5 - C#6 - E6 - | D6 -*5 C#6 - B5 - A5 - F#5 - A5 -`,
    } },
    B: { bars: 4, lines: {
      kick: "X...X...X...X...",
      snare: "....X.......X...|....X.......X...|....X.......X...|x.x.x.x.xxxxXXXX",
      hat: "xoxoxoxoxoxoxoxo",
      bass: [pumpBar("B2", "B3"), pumpBar("D2", "D3"), pumpBar("E2", "E3"), "E2*8 E3*8"].join(" | "),
      pad: "B3+D4+F#4 -*15 | A3+D4+F#4 -*15 | G#3+B3+E4 -*15 | A3+B3+E4 -*7 G#3+B3+E4 -*7",
      lead: "F#5 -*3 D5 -*3 B4 - D5 - F#5 -*3 | A5 -*5 F#5 - D5 - F#5 - A5 - B5 - | G#5 -*7 E5 -*3 B4 -*3 | B5 -*7 G#5 - B5 - C#6 - D6 -",
    } },
    C: { bars: 4, lines: {
      ...MENU_A,
      crash: "X...............|................|................|................",
      stab: [syncBar(M_A), syncBar(M_E), syncBar(M_FSM), `${M_D} - . ${M_D} - . ${M_D} - ${M_E} - . ${M_E} - . ${M_E} -`].join(" | "),
      bass: [pumpBar("A2", "A3"), pumpBar("E2", "E3"), pumpBar("F#2", "F#3"), "D2 . D2 D3 . D2 D2 . E2 . E2 E3 . E2 E2 ."].join(" | "),
      lead: "E5 - A5 - C#6 - . A5 - . E5 - C#6 - B5 - | B5 -*3 G#5 -*3 E5 - B5 -*5 | A5 - C#6 - . A5 - . F#5 - A5 - C#6 - E6 - | D6 -*3 C#6 - B5 - E6 -*7",
    } },
  },
  order: [{ p: "intro" }, { p: "A1" }, { p: "A2" }, { p: "B" }, { p: "C" }],
  loopFrom: 1,
};

// ---- Circuit race songs: shared helpers ----

/** One sustained chord (or note) per bar. */
const holdBars = (chords: readonly string[]): string => chords.map((c) => `${c} -*15`).join(" | ");
/** Crash on the first step of a `bars`-bar drum line. */
const crashOn1 = (bars: number): string => "X".padEnd(bars * 16, ".");
/** The same tone line one octave lower. */
const octaveDown = (line: string): string => line.replace(/([A-G]#?)(\d)/g, (_, note: string, oct: string) => `${note}${Number(oct) - 1}`);
/** Four-note figure repeated in 16ths. */
const loopBar = (a: string, b: string, c: string, d: string): string => `${a} ${b} ${c} ${d} ${a} ${b} ${c} ${d} ${a} ${b} ${c} ${d} ${a} ${b} ${c} ${d}`;

// ---- "Sunset Surf": coast race song, 156 BPM, E major, last chorus up to F#; 60s surf pop ----

const SU_E = "G#3+B3+E4";
const SU_CSM = "G#3+C#4+E4";
const SU_A = "A3+C#4+E4";
const SU_B = "F#3+B3+D#4";
const SU_GSM = "G#3+B3+D#4";
const SU_FSM = "F#3+A3+C#4";
const SU_CS = "G#3+C#4+F4";
/** Bouncy pop bass: root, pushed root, fifth, octave. */
const surfBass = (r: string, f: string, o: string): string => `${r} - . ${r} ${f} - ${o} - ${r} - . ${r} ${f} - ${o} -`;
/** Backing-vocal "bop" on beats 2 and 4. */
const bopBar = (c: string): string => `. . . . ${c} - . . . . . . ${c} - . .`;
/** Backing vocals answer the lead's call in the last beat. */
const answerBar = (c: string): string => `.*12 ${c} - ${c} -`;

const SURF_DRUMS = { kick: "X.......X.x.....", snare: "....X......oX...", hat: "x.x.x.x.x.x.x.x." };
const SURF_VERSE_HARMONY = {
  bass: [surfBass("E2", "B2", "E3"), surfBass("C#2", "G#2", "C#3"), surfBass("A2", "E3", "A3"), surfBass("B1", "F#2", "B2")].join(" | "),
  pad: holdBars([SU_E, SU_CSM, SU_A, SU_B]),
};

// prettier-ignore
const SUNSET_SURF: SongDef = {
  bpm: 156,
  patterns: {
    intro: { bars: 2, lines: {
      // Tremolo-picked surf guitar sliding down to the dominant.
      arp: "E5*4 D#5*4 C#5*4 B4*4 | A4*4 G#4*4 F#4*4 B4*4",
      stab: `${SU_E} -*15 | ${SU_B} -*15`,
      bass: "E2 -*15 | B1 -*7 B2 . A2 . G#2 . F#2 .",
      snare: "................|x.x.x.x.xxxxXXXX",
      crash: crashOn1(2),
    } },
    verse: { bars: 8, lines: {
      ...SURF_DRUMS,
      ...SURF_VERSE_HARMONY,
      crash: crashOn1(8),
      lead: "B4 - G#4 - B4 - E5 - . . E5 - D#5 - C#5 - | E5 - - - C#5 - - - . . G#4 - C#5 - E5 - | E5 - - - C#5 - E5 - A5 - - - G#5 - F#5 - | F#5 -*7 . . D#5 - B4 - . . | B4 - G#4 - B4 - E5 - . . E5 - D#5 - C#5 - | E5 - - - C#5 - - - . . G#4 - C#5 - G#5 - | A5 - - - G#5 - F#5 - E5 - C#5 - E5 - F#5 - | F#5 -*5 E5 - D#5 - B4 - C#5 - D#5 -",
    } },
    verse2: { bars: 8, lines: {
      ...SURF_DRUMS,
      ...SURF_VERSE_HARMONY,
      stab: [SU_E, SU_CSM, SU_A, SU_B].map(bopBar).join(" | "),
      lead: "E5 - E5 - D#5 - E5 - G#5 - - - E5 - . . | G#5 - - - E5 - C#5 - . . C#5 - D#5 - E5 - | C#5 - E5 - A5 - - - A5 - G#5 - F#5 - E5 - | D#5 -*5 B4 - F#5 -*7 | E5 - E5 - D#5 - E5 - B5 - - - G#5 - . . | E5 - - - C#5 - E5 - G#5 - - - C#6 - - - | C#6 - B5 - A5 - G#5 - F#5 - E5 - C#5 - E5 - | D#5 -*7 F#5 - G#5 - A5 - B5 -",
    } },
    // Falsetto call, harmonised backing-vocal answer.
    chorus: { bars: 8, lines: {
      kick: "X.....X.X.......",
      snare: "....X.......X...",
      hat: "xoxoxoxoxoxoxoxo",
      openHat: "..............x.",
      crash: crashOn1(4),
      bass: [
        surfBass("A2", "E3", "A3"), surfBass("B1", "F#2", "B2"), surfBass("G#2", "D#3", "G#3"), surfBass("C#2", "G#2", "C#3"),
        surfBass("A2", "E3", "A3"), surfBass("B1", "F#2", "B2"), surfBass("E2", "B2", "E3"), surfBass("E2", "B2", "E3"),
      ].join(" | "),
      pad: holdBars([SU_A, SU_B, SU_GSM, SU_CSM, SU_A, SU_B, SU_E, SU_E]),
      stab: [answerBar(SU_A), `${SU_B} -*15`, answerBar(SU_GSM), `${SU_CSM} -*15`, answerBar(SU_A), `${SU_B} -*15`, `${SU_E} -*15`, answerBar(SU_E)].join(" | "),
      lead: "C#6 - - - C#6 - B5 - A5 - - - . . . . | B5 - - - A5 - B5 - D#6 -*7 | B5 - - - B5 - G#5 - D#5 - - - . . . . | E5 - - - G#5 - C#6 - E6 -*7 | C#6 - - - C#6 - E6 - C#6 - - - . . . . | D#6 - - - C#6 - B5 - A5 - - - F#5 - - - | G#5 -*7 E6 - - - B5 - - - | E6 -*11 . . . .",
    } },
    break: { bars: 4, lines: {
      ...SURF_VERSE_HARMONY,
      kick: "X.....X.X.......",
      snare: "....X.......X...|....X.......X...|....X.......X...|xxxxxxxxXXXXXXXX",
      hat: "x.x.x.x.x.x.x.x.",
      crash: crashOn1(4),
      stab: [SU_E, SU_CSM, SU_A, SU_B].map(bopBar).join(" | "),
      arp: "B4*4 E5*4 G#5*4 B5*4 | C#6*4 B5*4 G#5*4 E5*4 | A5*4 C#6*4 E6*4 C#6*4 | D#6*4 C#6*4 B5*4 F#5*4",
    } },
    // Lifts to C#, the dominant of the last chorus in F#.
    bridge: { bars: 4, lines: {
      kick: "X.......X.......",
      snare: "....X.......X...|....X.......X...|....X.......X...|x.x.x.x.xxxxXXXX",
      hat: "x.x.x.x.x.x.x.x.",
      pad: holdBars([SU_A, SU_GSM, SU_FSM, SU_CS]),
      stab: [SU_A, SU_GSM, SU_FSM, SU_CS].map(bopBar).join(" | "),
      bass: "A2 -*7 E2 -*7 | G#2 -*7 D#2 -*7 | F#2 -*7 C#3 -*7 | C#2 -*7 C#3 . B2 . G#2 . F2 .",
      lead: "C#6 -*5 B5 - A5 -*7 | B5 -*5 A5 - G#5 -*7 | A5 -*5 G#5 - F#5 -*7 | F5 -*7 G#5 -*3 C#6 -*3",
    } },
  },
  order: [{ p: "intro" }, { p: "verse" }, { p: "chorus" }, { p: "verse2" }, { p: "chorus" }, { p: "break" }, { p: "bridge" }, { p: "chorus", t: 2 }],
  loopFrom: 1,
};

// ---- "Neon Pulse": night race song, 130 BPM, G minor; Eurotechno: calm verse, build-up, club drop ----

const NI_GM = "A#3+D4+G4";
const NI_DS = "A#3+D#4+G4";
const NI_AS = "A#3+D4+F4";
const NI_F = "A3+C4+F4";
const NI_D = "A3+D4+F#4";
/** Rolling 16th bass that leaves the kick's step free. */
const rollBar = (r: string, o: string): string => `. ${r} ${o} ${r} . ${r} ${o} ${r} . ${r} ${o} ${r} . ${r} ${o} ${r}`;

const NIGHT_CHORDS = [NI_GM, NI_DS, NI_AS, NI_F];
const NIGHT_HOOK =
  "G5 - . G5 - . A#5 - . D6 - . C6 - A#5 - | A#5 - . G5 - . D#5 -*5 . . . . | F5 - . F5 - . A#5 - . D6 - . C6 - D6 - | C6 - . A5 - . F5 -*5 G5 - A5 - | G5 - . G5 - . A#5 - . D6 - . F6 - D6 - | D#6 - . D6 - . A#5 -*5 G5 - A#5 - | D6 - . C6 - . A#5 - . F5 - . A#5 - C6 - | C6 -*5 A5 - . F5 - - G5 - A5 -";
const NIGHT_DROP = {
  kick: "X...X...X...X...",
  snare: "....X.......X...",
  hat: "x..ox..ox..ox..o",
  openHat: "..X...X...X...X.",
  crash: crashOn1(4),
  bass: [rollBar("G2", "G3"), rollBar("D#2", "D#3"), rollBar("A#1", "A#2"), rollBar("F2", "F3")].join(" | "),
  stab: NIGHT_CHORDS.map(stabBar).join(" | "),
  lead: NIGHT_HOOK,
};
const NIGHT_PULSE = ["G2", "D#2", "A#1", "F2"].map(stabBar).join(" | ");

// prettier-ignore
const NEON_PULSE: SongDef = {
  bpm: 130,
  patterns: {
    intro: { bars: 4, lines: {
      pad: holdBars(NIGHT_CHORDS),
      sub: NIGHT_PULSE,
      bell: "G5 -*3 A#5 -*3 D6 -*3 C6 -*3 | A#5 -*7 G5 -*7 | F5 -*3 A#5 -*3 D6 -*3 F6 -*3 | C6 -*15",
      kick: "................|................|X...X...X...X...|X...X...X...X...",
      openHat: "................|................|..x...x...x...x.|..x...x...x...x.",
    } },
    verse: { bars: 8, lines: {
      kick: "x...x...x...x...",
      snare: "....o.......o...",
      hat: "..x...x...x...x.",
      sub: NIGHT_PULSE,
      keys: NIGHT_CHORDS.map(stabBar).join(" | "),
      pad: holdBars(NIGHT_CHORDS),
      lead: "D5 -*3 D5 - A#4 - . . A#4 - C5 - D5 - | D#5 -*5 D5 - C5 -*7 | D5 -*3 D5 - F5 - . . F5 - D5 - C5 - | C5 -*7 A4 -*3 . . . . | D5 -*3 D5 - A#4 - . . G5 - F5 - D5 - | D#5 -*5 G5 - D#5 -*7 | F5 -*3 D5 - F5 - . . A#5 - A5 - F5 - | A5 -*7 G5 -*3 F5 -*3",
    } },
    build: { bars: 4, lines: {
      kick: "X...X...X...X...|X...X...X...X...|X...X...X...X...|X.X.X.X.X.X.....",
      snare: "x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxXXXX....",
      hat: "x.x.x.x.x.x.x.x.",
      arp: [loopBar("D#4", "G4", "A#4", "D#5"), loopBar("F4", "A4", "C5", "F5"), loopBar("G4", "A#4", "D5", "G5"), "A4 D5 F#5 A5 A4 D5 F#5 A5 A4 D5 F#5 A5 . . . ."].join(" | "),
      pad: holdBars([NI_DS, NI_F, NI_GM, NI_D]),
      sub: "D#2 -*15 | F2 -*15 | G2 -*15 | D2 -*11 . . . .",
      lead: "G4 -*15 | A4 -*15 | A#4 -*15 | D5 -*11 . . . .",
    } },
    drop: { bars: 8, lines: NIGHT_DROP },
    break: { bars: 4, lines: {
      hat: "..x...x...x...x.",
      snare: "................|................|................|x.x.x.x.xxxxXXXX",
      pad: holdBars(NIGHT_CHORDS),
      sub: "G2 -*15 | D#2 -*15 | A#1 -*15 | F2 -*15",
      keys: NIGHT_CHORDS.map(stabBar).join(" | "),
      bell: "D6 -*7 A#5 -*7 | G5 -*7 D#5 -*7 | F5 -*7 A#5 -*7 | A5 -*15",
    } },
    // The drop again, the hook doubled an octave down and a 16th arpeggio on top.
    drop2: { bars: 8, lines: {
      ...NIGHT_DROP,
      brass: octaveDown(NIGHT_HOOK),
      arp: [loopBar("G5", "D5", "A#4", "D5"), loopBar("G5", "D#5", "A#4", "D#5"), loopBar("F5", "D5", "A#4", "D5"), loopBar("F5", "C5", "A4", "C5")].join(" | "),
    } },
  },
  order: [{ p: "intro" }, { p: "verse" }, { p: "build" }, { p: "drop" }, { p: "break" }, { p: "build" }, { p: "drop2" }],
  loopFrom: 1,
};

// ---- "Frost Sparkle": ice race song, 136 BPM, C lydian (F#), chiming bells over running arpeggios, last chorus up to D ----

const IC_C = "G3+C4+E4";
/** D over a C bass: the lydian colour. */
const IC_D = "F#3+A3+D4";
const IC_EM = "G3+B3+E4";
const IC_BM = "F#3+B3+D4";
const IC_AM = "A3+C4+E4";
/** Skipping bass with octave jumps. */
const iceBass = (r: string, o: string): string => `${r} - ${r} . ${o} . ${r} - . ${r} ${o} . ${r} - ${o} .`;
/** Short chord on every beat. */
const beatBar = (c: string): string => `${c} - . . ${c} - . . ${c} - . . ${c} - . .`;

const ICE_A_HARMONY = {
  bass: [iceBass("C2", "C3"), iceBass("C2", "C3"), iceBass("E2", "E3"), iceBass("D2", "D3")].join(" | "),
  arp: [arpBar("C5", "E5", "G5", "B5"), arpBar("C5", "D5", "F#5", "A5"), arpBar("B4", "E5", "G5", "B5"), arpBar("A4", "D5", "F#5", "A5")].join(" | "),
  pad: holdBars([IC_C, IC_D, IC_EM, IC_D]),
};
const ICE_CHORUS_TUNE =
  "E6 - - - D6 - B5 - . . G5 - B5 - D6 - | C6 - - - A5 - F#5 - . . D5 - F#5 - A5 - | B5 - - - G5 - B5 - E6 - - - F#6 - G6 - | F#6 -*7 D6 -*7 | E6 - - - C6 - A5 - . . E5 - A5 - C6 - | D6 - - - A5 - F#5 - . . D6 - E6 - F#6 - | G6 -*5 F#6 - E6 - B5 - G5 - B5 - | A5 -*11 . . . .";

// prettier-ignore
const FROST_SPARKLE: SongDef = {
  bpm: 136,
  patterns: {
    intro: { bars: 2, lines: {
      arp: `${arpBar("C5", "E5", "G5", "B5")} | ${arpBar("C5", "D5", "F#5", "A5")}`,
      pad: holdBars([IC_C, IC_D]),
      bell: "G5 -*3 B5 -*3 E6 -*3 G6 -*3 | F#6 -*15",
      kick: "................|X...X...X...X...",
      snare: "................|........x.x.xxXX",
      crash: crashOn1(2),
    } },
    verse: { bars: 8, lines: {
      ...ICE_A_HARMONY,
      kick: "X.....X...X.....",
      snare: "....X.......X...",
      hat: "x.x.x.x.x.x.x.x.",
      crash: crashOn1(8),
      bell: "G5 - - . B5 - - . E6 - . D6 - . B5 - | A5 -*5 F#5 - . A5 - . D6 -*3 | G5 - - . B5 - - . E6 - . F#6 - . G6 - | F#6 -*7 D6 -*3 A5 -*3 | G5 - - . B5 - - . E6 - . D6 - . B5 - | A5 -*5 F#5 - . A5 - . D6 - E6 - | G6 -*5 F#6 - E6 - . B5 - . G5 - | A5 -*15",
    } },
    pre: { bars: 8, lines: {
      kick: "X.....X.X...X...",
      snare: "....X.......X...",
      hat: "xoxoxoxoxoxoxoxo",
      bass: [iceBass("A1", "A2"), iceBass("B1", "B2"), iceBass("C2", "C3"), iceBass("D2", "D3")].join(" | "),
      stab: [IC_AM, IC_BM, IC_C, IC_D].map(beatBar).join(" | "),
      lead: "E5 - - - A5 - - - C6 - B5 - A5 - E5 - | F#5 -*7 D5 - F#5 - B5 - A5 - | G5 - - - E5 - G5 - C6 - - - B5 - G5 - | A5 -*11 . . . . | E5 - - - A5 - - - C6 - B5 - A5 - C6 - | D6 -*7 B5 - D6 - F#6 - D6 - | E6 -*5 D6 - B5 - G5 - E5 - G5 - | F#5 -*7 A5 -*7",
    } },
    // Lead and bells in unison over the arpeggio.
    chorus: { bars: 8, lines: {
      kick: "X.....X.X.....X.",
      snare: "....X.......X...",
      hat: "x.x.x.x.x.x.x.x.",
      openHat: "......x.......x.",
      crash: crashOn1(4),
      lead: ICE_CHORUS_TUNE,
      bell: ICE_CHORUS_TUNE,
      arp: [
        arpBar("C5", "E5", "G5", "B5"), arpBar("C5", "D5", "F#5", "A5"), arpBar("B4", "E5", "G5", "B5"), arpBar("B4", "D5", "F#5", "B5"),
        arpBar("A4", "C5", "E5", "A5"), arpBar("A4", "D5", "F#5", "A5"), arpBar("B4", "E5", "G5", "B5"), arpBar("A4", "D5", "F#5", "A5"),
      ].join(" | "),
      bass: [
        iceBass("C2", "C3"), iceBass("C2", "C3"), iceBass("E2", "E3"), iceBass("B1", "B2"),
        iceBass("A1", "A2"), iceBass("D2", "D3"), iceBass("E2", "E3"), iceBass("D2", "D3"),
      ].join(" | "),
      pad: holdBars([IC_C, IC_D, IC_EM, IC_BM, IC_AM, IC_D, IC_EM, IC_D]),
    } },
    // Frozen: arpeggio, pad and bells only, drums come back for the key change.
    break: { bars: 4, lines: {
      arp: ICE_A_HARMONY.arp,
      pad: ICE_A_HARMONY.pad,
      sub: "C2 -*15 | C2 -*15 | E2 -*15 | D2 -*15",
      bell: "E6 -*15 | F#6 -*15 | G6 -*15 | A6 -*7 .*8",
      kick: "................|................|X.......X.......|X...X...X...X...",
      snare: "................|................|................|x.x.x.x.xxxxXXXX",
    } },
  },
  order: [{ p: "intro" }, { p: "verse" }, { p: "pre" }, { p: "chorus" }, { p: "break" }, { p: "chorus", t: 2 }],
  loopFrom: 1,
};

// ---- "Mirage Gallop": desert race song, 120 BPM, B phrygian dominant (B C D# E F# G A); hand drums, western gallop ----

const DE_B = "B3+D#4+F#4";
const DE_C = "C4+E4+G4";
const DE_AM = "A3+C4+E4";
const DE_EM = "G3+B3+E4";
const DE_DRONE = "B3+F#4";
/** Western gallop: an 8th and two 16ths on every beat. */
const gallopBar = (r: string): string => `${r} - ${r} ${r} ${r} - ${r} ${r} ${r} - ${r} ${r} ${r} - ${r} ${r}`;
/** 3 + 3 + 2 chord hits, twice. */
const tresilloBar = (c: string): string => `${c} - . ${c} - . ${c} - ${c} - . ${c} - . ${c} -`;
/** Doumbek-style groove: low "doum" on the kick, "tek" on the snare, shaker-like hats. */
const HAND_DRUMS = { kick: "X.....x.X.......", snare: "..x...x.....x.o.", hat: "x.ox.oo.x.ox.oo." };

// prettier-ignore
const MIRAGE_GALLOP: SongDef = {
  bpm: 120,
  patterns: {
    intro: { bars: 2, lines: {
      ...HAND_DRUMS,
      pad: holdBars([DE_DRONE, DE_DRONE]),
      sub: "B1 -*15",
      arp: ".*16 | B4 C5 D#5 E5 F#5 G5 A5 B5 A5 G5 F#5 E5 D#5 C5 B4 .",
    } },
    // The snake-charmer tune over the drone.
    verse: { bars: 8, lines: {
      ...HAND_DRUMS,
      crash: crashOn1(8),
      bass: ["B1", "B1", "C2", "B1", "B1", "B1", "A1", "B1"].map(gallopBar).join(" | "),
      pad: holdBars([DE_B, DE_B, DE_C, DE_B, DE_B, DE_B, DE_AM, DE_B]),
      lead: "B4 - C5 - D#5 - E5 - F#5 -*3 E5 - D#5 - | C5 - - - B4 -*11 | E5 - D#5 - C5 - D#5 - E5 - F#5 - G5 - - - | F#5 -*7 D#5 - E5 - D#5 - C5 - | B4 - C5 - D#5 - F#5 - A5 -*3 G5 - F#5 - | G5 - F#5 - E5 - D#5 - C5 - D#5 - B4 - - - | A4 - C5 - E5 - G5 - F#5 - E5 - D#5 - C5 - | D#5 -*3 C5 - B4 -*9",
    } },
    // Spaghetti-western trumpet call.
    call: { bars: 8, lines: {
      ...HAND_DRUMS,
      hat: "xoxoxoxoxoxoxoxo",
      bass: ["E2", "E2", "B1", "B1", "A1", "C2", "B1", "B1"].map(gallopBar).join(" | "),
      stab: [DE_EM, DE_EM, DE_B, DE_B, DE_AM, DE_C, DE_B, DE_B].map(tresilloBar).join(" | "),
      brass: "E4 - - G4 - - B4 - E5 -*7 | D#5 - - E5 - - F#5 - G5 -*5 F#5 - | F#5 -*7 D#5 - - E5 - - C5 - | B4 -*15 | A4 - - C5 - - E5 - A5 -*7 | G5 - - F#5 - - E5 - C5 -*5 D#5 - | E5 - - D#5 - - C5 - B4 -*7 | B4 - . B4 - . B4 - . F#4 - . B4 - . .",
    } },
    chorus: { bars: 8, lines: {
      kick: "X.....x.X.....x.",
      snare: "..o.X..o..o.X.o.",
      hat: "xoxoxoxoxoxoxoxo",
      crash: crashOn1(4),
      bass: [
        gallopBar("B1"), gallopBar("C2"), gallopBar("B1"), gallopBar("A1"),
        gallopBar("B1"), gallopBar("C2"), "A1 - A1 A1 A1 - A1 A1 B1 - B1 B1 B1 - B1 B1", gallopBar("B1"),
      ].join(" | "),
      stab: [
        tresilloBar(DE_B), tresilloBar(DE_C), tresilloBar(DE_B), tresilloBar(DE_AM), tresilloBar(DE_B), tresilloBar(DE_C),
        `${DE_AM} - . ${DE_AM} - . ${DE_AM} - ${DE_B} - . ${DE_B} - . ${DE_B} -`, tresilloBar(DE_B),
      ].join(" | "),
      lead: "F#5 - - D#5 - - B4 - F#5 - G5 - F#5 - E5 - | E5 - - C5 - - G4 - E5 - F#5 - E5 - D#5 - | D#5 - - B4 - - F#4 - B4 - C5 - D#5 - E5 - | E5 -*7 C5 - D#5 - C5 - A4 - | F#5 - - D#5 - - B4 - F#5 - A5 - G5 - F#5 - | G5 - - E5 - - C5 - G5 - A5 - G5 - F#5 - | E5 - - C5 - - A4 - D#5 - - F#5 - - B5 - | B5 -*11 . . . .",
      brass: "D#4 -*15 | E4 -*15 | F#4 -*15 | E4 -*15 | D#4 -*15 | G4 -*15 | E4 -*7 F#4 -*7 | D#4 -*15",
    } },
    // Hand-drum solo with ornamented runs.
    break: { bars: 4, lines: {
      kick: "X.....x.X..x....",
      snare: "..x.x.x...x.xxx.|..x.x.x...x.xxx.|..x.x.x...x.xxx.|x.x.x.x.xxxxXXXX",
      hat: "oxoooxoooxoooxoo",
      sub: "B1 -*15",
      pad: `${DE_DRONE} -*15`,
      arp: ".*16 | B4 C5 D#5 E5 F#5 E5 D#5 C5 B4 C5 D#5 C5 B4 . . . | .*16 | F#5 G5 A5 B5 A5 G5 F#5 E5 D#5 E5 F#5 E5 D#5 C5 B4 .",
    } },
  },
  order: [{ p: "intro" }, { p: "verse" }, { p: "call" }, { p: "chorus" }, { p: "break" }, { p: "chorus" }],
  loopFrom: 1,
};

// ---- "Skyline Drop": city race song, 128 BPM, F minor; big-room house: long build-ups, sparse staccato riff drops ----

const CI_FM = "G#3+C4+F4";
const CI_CS = "G#3+C#4+F4";
const CI_GS = "G#3+C4+D#4";
const CI_DS = "G3+A#3+D#4";
const CI_C = "G3+C4+E4";
const CI_CHORDS = [CI_FM, CI_CS, CI_GS, CI_DS];
/** Drop riff an octave above where the lead plays it: short stabs with octave jumps, answering the kick. */
const CI_RIFF_HEAD = "F4 - . F4 . . F5 - . . D#5 . C5 . . . | C#4 - . C#4 . . C#5 - . . C5 . G#4 . . . | G#4 - . G#4 . . G#5 - . . G5 . D#5 . . .";
const CI_RIFF_A = `${CI_RIFF_HEAD} | D#4 - . D#4 . . D#5 - . . A#4 . G4 . A#4 .`;
const CI_RIFF_HIGH = `${CI_RIFF_A} | ${CI_RIFF_HEAD} | D#4 - . D#4 . . D#5 - . . F5 - G5 - C6 -`;
const CI_RIFF = octaveDown(CI_RIFF_HIGH);
/** Off-beat sub notes: the kick owns the beat, like a sidechain pump. */
const CI_PUMP = ["F2", "C#2", "G#1", "D#2"].map(stabBar).join(" | ");
const CITY_DROP = {
  kick: "X...X...X...X...",
  snare: "....X.......X...",
  openHat: "..X...X...X...X.",
  crash: crashOn1(4),
  sub: CI_PUMP,
  lead: CI_RIFF,
  bass: octaveDown(CI_RIFF),
};

// prettier-ignore
const SKYLINE_DROP: SongDef = {
  bpm: 128,
  patterns: {
    // Muffled chords, then the beat and the riff teased on the e-piano.
    intro: { bars: 8, lines: {
      pad: holdBars([...CI_CHORDS, ...CI_CHORDS]),
      openHat: "..x...x...x...x.",
      kick: `${".".repeat(64)}|X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X...X...`,
      snare: `${".".repeat(64)}|....X.......X...|....X.......X...|....X.......X...|....X...x.x.xxXX`,
      sub: `${".*16 | ".repeat(4)}${CI_PUMP}`,
      keys: `${".*16 | ".repeat(4)}${CI_RIFF_A}`,
    } },
    // Snare roll speeding up from half notes to 16ths, arpeggio and lead climbing, a beat of silence before the drop.
    build: { bars: 8, lines: {
      kick: "X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X...X...|X.X.X.X.X.X.X.X.|................",
      snare: "x.......x.......|x...x...x...x...|x...x...x...x...|x.x.x.x.x.x.x.x.|x.x.x.x.X.X.X.X.|xxxxxxxxxxxxxxxx|XXXXXXXXXXXXXXXX|XXXXXXXXXXXX....",
      hat: "................|................|................|................|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|xxxxxxxxxxxx....",
      crash: crashOn1(8),
      pad: holdBars([CI_FM, CI_CS, CI_GS, CI_DS, CI_FM, CI_CS, CI_DS, CI_C]),
      sub: "F2 -*15 | C#2 -*15 | G#1 -*15 | D#2 -*15 | F2 -*15 | C#2 -*15 | D#2 -*15 | C2 -*11 . . . .",
      arp: [
        loopBar("F4", "G#4", "C5", "F5"), loopBar("F4", "G#4", "C#5", "F5"), loopBar("G#4", "C5", "D#5", "G#5"), loopBar("G4", "A#4", "D#5", "G5"),
        loopBar("G#4", "C5", "F5", "G#5"), loopBar("G#4", "C#5", "F5", "G#5"), loopBar("A#4", "D#5", "G5", "A#5"),
        "C5 E5 G5 C6 C5 E5 G5 C6 C5 E5 G5 C6 . . . .",
      ].join(" | "),
      lead: ".*16 | .*16 | .*16 | .*16 | C5 -*15 | C#5 -*15 | D#5 -*15 | E5 -*11 . . . .",
    } },
    drop: { bars: 8, lines: CITY_DROP },
    // No kick: chords, a bell melody and the riff's chords on the e-piano.
    breakdown: { bars: 8, lines: {
      crash: crashOn1(8),
      hat: `${".".repeat(64)}|${"..x...x...x...x.".repeat(4)}`,
      pad: holdBars([CI_FM, CI_CS, CI_GS, CI_DS, CI_FM, CI_CS, CI_DS, CI_C]),
      sub: "F2 -*15 | C#2 -*15 | G#1 -*15 | D#2 -*15 | F2 -*15 | C#2 -*15 | D#2 -*15 | C2 -*15",
      keys: `${".*16 | ".repeat(4)}${[CI_FM, CI_CS, CI_DS, CI_C].map(stabBar).join(" | ")}`,
      bell: "C5 -*3 F5 -*3 G#5 -*3 G5 - F5 - | F5 -*7 C#5 -*7 | D#5 -*3 G#5 -*3 C6 -*3 A#5 - G#5 - | G5 -*11 . . . . | C5 -*3 F5 -*3 G#5 -*3 A#5 - C6 - | C#6 -*7 C6 - G#5 - F5 - . . | A#5 -*7 G5 -*3 D#5 -*3 | E5 -*15",
    } },
    // The drop again, the riff doubled an octave up, a chord hit on each downbeat and 16th hats.
    drop2: { bars: 8, lines: {
      ...CITY_DROP,
      hat: "o.o.o.o.o.o.o.o.",
      brass: CI_RIFF_HIGH,
      stab: CI_CHORDS.map((c) => `${c} - - . .*12`).join(" | "),
    } },
  },
  order: [{ p: "intro" }, { p: "build" }, { p: "drop" }, { p: "breakdown" }, { p: "build" }, { p: "drop2" }],
  loopFrom: 1,
};

// ---- "Greenwood Reel": forest race song, 172 BPM, A dorian (F#); folk reel over boom-chuck, last chorus up to B ----

const FO_AM = "A3+C4+E4";
const FO_G = "G3+B3+D4";
const FO_D = "F#3+A3+D4";
const FO_EM = "G3+B3+E4";
const FO_C = "G3+C4+E4";
const FO_FS = "F#3+A#3+C#4";
/** The "boom" of boom-chuck: root and fifth on the beats (the keys play the "chuck" off the beat). */
const boomBar = (r: string, f: string): string => `${r} - . . ${f} - . . ${r} - . . ${f} - . .`;
/** Fiddle-style 16th string crossing over three notes. */
const reelBar = (a: string, b: string, c: string): string => `${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b}`;
/** Bodhrán-like drive. */
const REEL_DRUMS = { kick: "X.......X.....x.", snare: "....x.......X...", hat: "x.oxx.oxx.oxx.ox" };

const REEL_A =
  "A4 - E5 - E5 F#5 E5 D5 E5 - A5 - G5 - E5 - | D5 - G4 - B4 - D5 - G5 - D5 - B4 - G4 - | A4 - C5 - E5 - A5 - G5 - E5 - D5 - C5 - | B4 - E5 - G5 - E5 - B5 - G5 - E5 - D5 - | A4 - E5 - E5 F#5 E5 D5 E5 - A5 - B5 - A5 - | G5 - D5 - B4 - D5 - G5 - A5 - B5 - G5 - | F#5 - A5 - D6 - A5 - F#5 - E5 - D5 - F#5 - | E5 - C5 - B4 - G4 - A4 -*7";
const REEL_A_BACKING = {
  keys: [FO_AM, FO_G, FO_AM, FO_EM, FO_AM, FO_G, FO_D, FO_AM].map(stabBar).join(" | "),
  bass: [
    boomBar("A2", "E2"), boomBar("G2", "D2"), boomBar("A2", "E2"), boomBar("E2", "B1"),
    boomBar("A2", "E2"), boomBar("G2", "D2"), boomBar("D2", "A1"), boomBar("A2", "E2"),
  ].join(" | "),
};

// prettier-ignore
const GREENWOOD_REEL: SongDef = {
  bpm: 172,
  patterns: {
    intro: { bars: 4, lines: {
      pad: holdBars([FO_AM, FO_AM, FO_G, FO_AM]),
      sub: "A2 -*15 | A2 -*15 | G2 -*15 | A2 -*15",
      keys: [FO_AM, FO_AM, FO_G, FO_AM].map(stabBar).join(" | "),
      bell: "E5 -*3 A5 -*3 B5 -*3 C6 -*3 | B5 -*7 G5 -*7 | D5 -*3 G5 -*3 B5 -*3 D6 -*3 | E6 -*15",
      kick: "................|................|X.......X.......|X...X...X.x.xxXX",
      hat: "................|................|x.oxx.oxx.oxx.ox|x.oxx.oxx.oxx.ox",
    } },
    tuneA: { bars: 8, lines: { ...REEL_DRUMS, ...REEL_A_BACKING, crash: crashOn1(8), lead: REEL_A } },
    // Same tune, doubled an octave down like a second fiddle.
    tuneA2: { bars: 8, lines: {
      ...REEL_DRUMS,
      ...REEL_A_BACKING,
      snare: "....X.......X...",
      crash: crashOn1(8),
      lead: REEL_A,
      brass: octaveDown(REEL_A),
    } },
    tuneB: { bars: 8, lines: {
      ...REEL_DRUMS,
      snare: "....X.......X...",
      openHat: "..............x.",
      crash: crashOn1(8),
      keys: [FO_C, FO_G, FO_AM, FO_EM, FO_C, FO_D, FO_EM, FO_EM].map(stabBar).join(" | "),
      bass: [
        boomBar("C2", "G2"), boomBar("G2", "D2"), boomBar("A2", "E2"), boomBar("E2", "B1"),
        boomBar("C2", "G2"), boomBar("D2", "A1"), boomBar("E2", "B1"), boomBar("E2", "B1"),
      ].join(" | "),
      lead: "E5 - G5 - C6 - G5 - E5 - G5 - C6 - E6 - | D6 - B5 - G5 - B5 - D6 - B5 - A5 - G5 - | A5 - E5 - C5 - E5 - A5 - B5 - C6 - A5 - | B5 - G5 - E5 - G5 - B5 -*7 | E6 - D6 - C6 - G5 - E5 - G5 - C6 - D6 - | F#6 - D6 - A5 - D6 - F#5 - A5 - D6 - E6 - | G6 - E6 - B5 - G5 - E5 - G5 - B5 - D6 - | E6 -*7 D6 - B5 - A5 - G5 -",
    } },
    // Anthem: long lead notes, pipe-like counter line, running fiddle figure.
    chorus: { bars: 8, lines: {
      kick: "X...X...X...X...",
      snare: "....X.......X...",
      hat: "x.x.x.x.x.x.x.x.",
      crash: crashOn1(4),
      pad: holdBars([FO_AM, FO_G, FO_C, FO_D, FO_AM, FO_G, FO_EM, FO_AM]),
      bass: [
        boomBar("A2", "E2"), boomBar("G2", "D2"), boomBar("C2", "G2"), boomBar("D2", "A1"),
        boomBar("A2", "E2"), boomBar("G2", "D2"), boomBar("E2", "B1"), boomBar("A2", "E2"),
      ].join(" | "),
      arp: [
        reelBar("A4", "C5", "E5"), reelBar("G4", "B4", "D5"), reelBar("G4", "C5", "E5"), reelBar("F#4", "A4", "D5"),
        reelBar("A4", "C5", "E5"), reelBar("G4", "B4", "D5"), reelBar("G4", "B4", "E5"), reelBar("A4", "C5", "E5"),
      ].join(" | "),
      lead: "E5 -*5 A5 -*5 B5 - C6 - | D6 -*5 B5 -*5 G5 -*3 | E6 -*5 D6 -*5 C6 - B5 - | A5 -*11 F#5 - A5 - | E5 -*5 A5 -*5 B5 - C6 - | D6 -*5 G6 -*5 E6 -*3 | D6 -*5 B5 -*5 G5 - B5 - | A5 -*15",
      brass: "A4 -*15 | B4 -*15 | C5 -*15 | D5 -*15 | C5 -*15 | B4 -*15 | B4 -*15 | A4 -*15",
    } },
    // Bodhrán break; ends on F#, the dominant of the last chorus in B.
    break: { bars: 4, lines: {
      ...REEL_DRUMS,
      snare: "....x.......X...|....x.......X...|....x.......X...|x.x.x.x.xxxxXXXX",
      keys: [FO_AM, FO_G, FO_AM, FO_FS].map(stabBar).join(" | "),
      bass: [boomBar("A2", "E2"), boomBar("G2", "D2"), boomBar("A2", "E2"), boomBar("F#2", "C#2")].join(" | "),
      bell: "A5 - . A5 - . E5 - G5 - . E5 - D5 - . | D5 -*7 . . B4 - D5 - . . | A5 - . A5 - . E5 - G5 - . E5 - D5 - . | C#5 -*7 F#5 -*7",
    } },
  },
  order: [{ p: "intro" }, { p: "tuneA" }, { p: "tuneA2" }, { p: "tuneB" }, { p: "chorus" }, { p: "break" }, { p: "chorus", t: 2 }],
  loopFrom: 1,
};

// ---- "Summit Thunder": Bergsbanan (showcase) race song, 144 BPM, F# minor; epic mountain rock ----

const BE_FS5 = "F#3+C#4+F#4";
const BE_D5 = "D3+A3+D4";
const BE_E5 = "E3+B3+E4";
const BE_A5 = "A3+E4+A4";
const BE_CS5 = "C#4+G#4+C#5";
const BE_FSM = "F#3+A3+C#4";
const BE_D = "F#3+A3+D4";
const BE_E = "G#3+B3+E4";
const BE_BM = "F#3+B3+D4";
const BE_CS = "G#3+C#4+F4";
/** Power-chord riff: three pushes on `a`, two hits on `b`. */
const riffBar = (a: string, b: string): string => `${a} - - ${a} - - ${a} - . . ${b} - ${b} - - -`;
/** Palm-muted 8ths. */
const chugBar = (c: string): string => `${c} . ${c} . ${c} . ${c} . ${c} . ${c} . ${c} . ${c} .`;
/** Ringing power chord, then pushes. */
const driveBar = (c: string): string => `${c} -*7 ${c} - . ${c} - . ${c} -`;
/** Driving 16th bass with octave kicks. */
const driveBass = (r: string, o: string): string => `${r} ${r} ${r} ${r} ${o} ${r} ${r} ${r} ${r} ${r} ${r} ${r} ${o} ${r} ${r} ${r}`;

// prettier-ignore
const SUMMIT_THUNDER: SongDef = {
  bpm: 144,
  patterns: {
    riff: { bars: 4, lines: {
      kick: "X..X..X...X.X...",
      snare: "....X.......X...|....X.......X...|....X.......X...|x.x.x.x.xxxxXXXX",
      hat: "x.x.x.x.x.x.x.x.",
      crash: crashOn1(4),
      stab: [riffBar(BE_FS5, BE_E5), riffBar(BE_FS5, BE_A5), riffBar(BE_D5, BE_E5), `${BE_FS5} -*7 ${BE_CS5} -*7`].join(" | "),
      bass: [riffBar("F#2", "E2"), riffBar("F#2", "A2"), riffBar("D2", "E2"), "F#2 -*7 C#2 -*7"].join(" | "),
      brass: "F#4 -*7 C#5 -*7 | A4 -*7 E5 -*7 | F#5 -*7 E5 -*7 | F#5 -*7 F5 -*7",
    } },
    verse: { bars: 8, lines: {
      kick: "X......XX.X.....",
      snare: "....X.......X...",
      hat: "x.x.x.x.x.x.x.x.",
      crash: crashOn1(8),
      stab: [BE_FS5, BE_D5, BE_A5, BE_E5].map(chugBar).join(" | "),
      bass: ["F#2", "D2", "A2", "E2"].map(chugBar).join(" | "),
      lead: "C#5 - - - C#5 - A4 - B4 - C#5 - . . F#4 - | A4 -*7 . . F#4 - A4 - D5 - | C#5 - - - C#5 - E5 - E5 - C#5 - A4 - B4 - | B4 -*11 . . . . | C#5 - - - C#5 - A4 - B4 - C#5 - . . E5 - | F#5 -*7 E5 - D5 - C#5 - A4 - | C#5 - - - E5 - - - A5 - G#5 - E5 - C#5 - | B4 -*7 G#4 - B4 - E5 - G#5 -",
    } },
    pre: { bars: 4, lines: {
      kick: "X...X...X...X...",
      snare: "x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxXXXXXXXX",
      pad: holdBars([BE_BM, BE_D, BE_E, BE_CS]),
      bass: ["B1", "D2", "E2", "C#2"].map(chugBar).join(" | "),
      brass: "B4 -*7 D5 -*7 | F#5 -*7 A5 -*7 | G#5 -*7 B5 -*7 | G#5 -*11 . . . .",
    } },
    // Galloping double kick, horns under a soaring lead.
    chorus: { bars: 8, lines: {
      kick: "X.XXX.XXX.XXX.XX",
      snare: "....X.......X...",
      openHat: "X...X...X...X...",
      crash: crashOn1(4),
      stab: [BE_D5, BE_E5, BE_FS5, BE_FS5, BE_D5, BE_E5, BE_CS5, BE_CS5].map(driveBar).join(" | "),
      bass: [
        driveBass("D2", "D3"), driveBass("E2", "E3"), driveBass("F#2", "F#3"), driveBass("F#2", "F#3"),
        driveBass("D2", "D3"), driveBass("E2", "E3"), driveBass("C#2", "C#3"), driveBass("C#2", "C#3"),
      ].join(" | "),
      pad: holdBars([BE_D, BE_E, BE_FSM, BE_FSM, BE_D, BE_E, BE_CS, BE_CS]),
      lead: "F#5 - - - A5 - - - D6 -*5 C#6 - | B5 -*7 G#5 - - - E5 - - - | A5 - - - C#6 - - - F#6 -*7 | E6 - - - C#6 - - - A5 - B5 - C#6 - - - | D6 - - - C#6 - - - A5 - - - F#5 - A5 - | B5 -*7 E6 -*7 | F6 -*7 G#5 - - - C#6 - - - | C#6 -*15",
      brass: "D5 -*15 | E5 -*15 | F#5 -*15 | E5 -*15 | D5 -*15 | E5 -*7 G#5 -*7 | F5 -*15 | G#5 -*15",
    } },
    solo: { bars: 4, lines: {
      kick: "X...X...X...X...",
      snare: "....X.......X...|....X.......X...|....X.......X...|x.x.x.x.xxxxXXXX",
      openHat: "X...X...X...X...",
      crash: crashOn1(4),
      stab: [BE_FS5, BE_D5, BE_E5, BE_CS5].map(driveBar).join(" | "),
      bass: [driveBass("F#2", "F#3"), driveBass("D2", "D3"), driveBass("E2", "E3"), driveBass("C#2", "C#3")].join(" | "),
      lead: "F#5 G#5 A5 C#6 A5 G#5 F#5 C#5 F#5 G#5 A5 C#6 E6 C#6 A5 G#5 | A5 B5 C#6 D6 C#6 B5 A5 F#5 D5 F#5 A5 D6 F#6 D6 A5 F#5 | G#5 A5 B5 E6 B5 A5 G#5 E5 G#5 B5 E6 G#6 E6 B5 G#5 E5 | F5 G#5 C#6 F6 G#6 -*3 F6 -*3 C#6 -*3",
    } },
  },
  order: [{ p: "riff" }, { p: "verse" }, { p: "pre" }, { p: "chorus" }, { p: "riff" }, { p: "solo" }, { p: "pre" }, { p: "chorus" }],
  loopFrom: 1,
};

// ---- Results jingles ----

// prettier-ignore
const JINGLE_WIN: SongDef = {
  bpm: 140,
  patterns: {
    main: { bars: 2, lines: {
      brass: "D5 . D5 . D5 . A5 -*5 F#5 - A5 - | F#5+A5+D6 -*11 .*4",
      stab: ".*16 | D4+F#4+A4 -*11 .*4",
      bass: "D2 . D2 . D2 . A2 -*5 A2 - C#3 - | D3 -*11 .*4",
      kick: "X.....X.........|X...............",
      snare: "x.x.x.xxxxxxXXXX|................",
      crash: "................|X...............",
    } },
  },
  order: [{ p: "main" }],
  loopFrom: null,
};

// Gentle and encouraging, not mocking.
// prettier-ignore
const JINGLE_LOSE: SongDef = {
  bpm: 100,
  patterns: {
    main: { bars: 2, lines: {
      bell: "A5 -*3 G5 -*3 F5 -*3 E5 -*3 | D5 -*3 E5 -*3 F5 -*7",
      keys: "F3+A3+C4+E4 -*7 D3+F3+A3+C4 -*7 | A#2+D3+F3+A3 -*7 F3+A3+C4 -*7",
      sub: "F2 -*7 D2 -*7 | A#1 -*7 F2 -*7",
    } },
  },
  order: [{ p: "main" }],
  loopFrom: null,
};

// Championship won: a 12 s brass fanfare (D major, 120 BPM) for the trophy, then the menu song.
// prettier-ignore
const VICTORY_FANFARE: SongDef = {
  bpm: 120,
  patterns: {
    main: { bars: 6, lines: {
      brass: "A4 . A4 . A4 . D5 -*5 F#5 - A5 - | B5 -*3 A5 -*3 G5 - F#5 - E5 -*3 | F#5 . F#5 . F#5 . A5 -*5 D6 - C#6 - | B5 -*3 A5 -*3 G5 -*3 E5 -*3 | G5 . A5 . B5 . C#6 . D6 -*3 E6 -*3 | F#6 -*11 .*4",
      stab: "D4+F#4+A4 -*7 D4+F#4+A4 -*7 | G4+B4+D5 -*7 A4+C#5+E5 -*7 | D4+F#4+A4 -*7 F#4+A4+D5 -*7 | B3+D4+F#4 -*3 A3+C#4+E4 -*3 G3+B3+D4 -*3 A3+C#4+E4 -*3 | G3+B3+D4 -*7 A3+C#4+E4 -*7 | D4+F#4+A4+D5 -*11 .*4",
      bass: "D2 . D2 . D2 . D3 -*5 D2 - A2 - | G2 -*7 A2 -*7 | D2 . D2 . D2 . D3 -*5 F#2 - A2 - | B2 -*3 A2 -*3 G2 -*3 A2 -*3 | G2 -*3 G2 -*3 A2 -*3 A2 -*3 | D2 -*11 .*4",
      bell: ".*16 | .*16 | .*16 | .*16 | D6 . F#6 . A6 . F#6 . D6 . F#6 . A6 . B6 . | A6 -*11 .*4",
      kick: "X.....X.........|X.......X.......|X.....X.........|X...X...X...X...|X...X...X...X...|X...............",
      snare: "....x.......x...|....x.......x.xx|....x.......x...|x.x.x.x.xxxxxxxx|xxxxxxxxXXXXXXXX|................",
      crash: "X...............|................|X...............|................|X...............|X...............",
    } },
  },
  order: [{ p: "main" }],
  loopFrom: null,
};

export const MENU_SONG: SongId = "menu";

export const SONGS: Record<SongId, CompiledSong> = {
  menu: compileSong("menu", MENU),
  meadowRace: compileSong("meadowRace", MEADOW_RACE),
  showcaseRace: compileSong("showcaseRace", SUMMIT_THUNDER),
  coastRace: compileSong("coastRace", SUNSET_SURF),
  nightRace: compileSong("nightRace", NEON_PULSE),
  iceRace: compileSong("iceRace", FROST_SPARKLE),
  desertRace: compileSong("desertRace", MIRAGE_GALLOP),
  cityRace: compileSong("cityRace", SKYLINE_DROP),
  forestRace: compileSong("forestRace", GREENWOOD_REEL),
  jingleWin: compileSong("jingleWin", JINGLE_WIN),
  jingleLose: compileSong("jingleLose", JINGLE_LOSE),
  victoryFanfare: compileSong("victoryFanfare", VICTORY_FANFARE),
};
