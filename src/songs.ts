// Composed music as notation data (see music.ts for the format).
import { compileSong, type CompiledSong, type SongDef } from "./music";

export type SongId = "menu" | "meadowRace" | "jingleWin" | "jingleLose";

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

// ---- "Pit Lane": menu song, 112 BPM, C major / F lydian, DX7 e-piano + FM bell ----

const MENU_DRUMS = { kick: "X......x..X.....", snare: "....x.......x...", hat: "x.x.x.xox.x.x.xo" };
// prettier-ignore
const MENU_A = {
  ...MENU_DRUMS,
  keys: "F3+A3+C4+E4 - - . . . F3+A3+C4+E4 - . . F3+A3+C4+E4 - - - . . | E3+G3+B3+D4 - - . . . E3+G3+B3+D4 - . . E3+G3+B3+D4 - - - . . | D3+F3+A3+C4 - - . . . D3+F3+A3+C4 - . . D3+F3+A3+C4 - - - . . | G3+C4+D4+F4 - - . . . G3+C4+D4+F4 - G3+B3+D4+F4 - - - - - . .",
  sub: "F2 - - . . . F2 - C3 - . . A2 - G2 - | E2 - - . . . E2 - B2 - . . D3 - B2 - | D2 - - . . . D2 - A2 - . . C3 - A2 - | G2 - - . . . G2 - D3 - . . F2 - G2 -",
};

// prettier-ignore
const MENU: SongDef = {
  bpm: 112,
  patterns: {
    A1: { bars: 4, lines: {
      ...MENU_A,
      bell: ". . E5 - G5 - A5 -*3 G5 - E5 -*3 | . . D5 - E5 - G5 -*3 E5 - D5 - B4 - | . . C5 - D5 - F5 -*3 E5 - D5 - C5 - | D5 -*7 .*8",
    } },
    A2: { bars: 4, lines: {
      ...MENU_A,
      bell: ". . E5 - G5 - A5 -*3 G5 - E5 -*3 | . . D5 - E5 - G5 -*3 B5 - A5 - G5 - | . . A5 - G5 - F5 -*3 E5 - F5 - A5 - | G5 -*7 F5 - E5 - D5 -*3",
    } },
    B: { bars: 4, lines: {
      ...MENU_DRUMS,
      keys: "A3+C4+E4+G4 - - . . . A3+C4+E4+G4 - . . A3+C4+E4+G4 - - - . . | D3+F3+A3+C4 - - . . . D3+F3+A3+C4 - . . D3+F3+A3+C4 - - - . . | A#3+D4+F4+A4 - - . . . A#3+D4+F4+A4 - . . A#3+D4+F4+A4 - - - . . | C4+F4+G4 - - . . . C4+F4+G4 - C4+E4+G4 - - - - - . .",
      sub: "A2 - - . . . A2 - E3 - . . G2 - A2 - | D2 - - . . . D2 - A2 - . . C3 - A2 - | A#2 - - . . . A#2 - F2 - . . A2 - A#2 - | C3 - - . . . C3 - G2 - . . E2 - C3 -",
      bell: "E5 -*3 G5 -*3 A5 -*3 C6 -*3 | A5 -*7 F5 -*3 A5 -*3 | A5 -*7 F5 -*3 D5 -*3 | F5 -*7 E5 -*3 G5 -*3",
    } },
  },
  order: [{ p: "A1" }, { p: "A2" }, { p: "B" }, { p: "A2" }],
  loopFrom: 0,
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

export const MENU_SONG: SongId = "menu";

export const SONGS: Record<SongId, CompiledSong> = {
  menu: compileSong("menu", MENU),
  meadowRace: compileSong("meadowRace", MEADOW_RACE),
  jingleWin: compileSong("jingleWin", JINGLE_WIN),
  jingleLose: compileSong("jingleLose", JINGLE_LOSE),
};
