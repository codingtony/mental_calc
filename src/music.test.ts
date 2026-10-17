import { describe, expect, it } from "vitest";
import { DRUM_IDS, compileSong, noteToMidi, parseLine, type SongDef } from "./music";
import { SONGS } from "./songs";

describe("noteToMidi", () => {
  it("maps scientific pitch names to MIDI numbers", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("F#5")).toBe(78);
    expect(noteToMidi("A#1")).toBe(34);
  });

  it("rejects unknown letters and flats", () => {
    expect(() => noteToMidi("H2")).toThrow();
    expect(() => noteToMidi("Bb3")).toThrow();
  });
});

describe("parseLine", () => {
  it("sustains every note of the latest onset, chords included", () => {
    const { events, length } = parseLine("lead", "C4 - - . E4+G4 -");
    expect(length).toBe(6);
    expect(events.map(({ step, midi, steps }) => ({ step, midi, steps }))).toEqual([
      { step: 0, midi: 60, steps: 3 },
      { step: 4, midi: 64, steps: 2 },
      { step: 4, midi: 67, steps: 2 },
    ]);
  });

  it("expands tok*N repeats", () => {
    const { events, length } = parseLine("pad", "C4 -*3 .*4");
    expect(length).toBe(8);
    expect(events).toHaveLength(1);
    expect(events[0].steps).toBe(4);
  });

  it("rejects a sustain without a preceding note", () => {
    expect(() => parseLine("pad", "- C4")).toThrow();
    expect(() => parseLine("pad", ". -")).toThrow();
  });

  it("reads drum lines one char per step, ignoring bar lines", () => {
    const { events, length } = parseLine("kick", "X.x.|o");
    expect(length).toBe(5);
    expect(events.map((e) => e.step)).toEqual([0, 2, 4]);
    expect(events.map((e) => e.vel)).toEqual([1, 0.8, 0.45]);
  });
});

describe("compileSong", () => {
  const def: SongDef = {
    bpm: 120,
    patterns: { a: { bars: 1, lines: { kick: "X...", bass: "C3*16" } } },
    order: [{ p: "a" }, { p: "a", t: 2 }],
    loopFrom: 1,
  };

  it("tiles short lines and transposes tone instruments only", () => {
    const song = compileSong("t", def);
    expect(song.steps).toHaveLength(32);
    expect(song.loopStep).toBe(16);
    const kicks = song.steps.flatMap((evs, i) => evs.filter((e) => e.inst === "kick").map((e) => ({ i, midi: e.midi })));
    expect(kicks).toEqual([0, 4, 8, 12, 16, 20, 24, 28].map((i) => ({ i, midi: 0 })));
    song.steps.forEach((evs, i) => {
      const bass = evs.filter((e) => e.inst === "bass");
      expect(bass).toHaveLength(1);
      expect(bass[0].midi).toBe(i < 16 ? 48 : 50);
    });
  });

  it("rejects lines that do not divide the pattern and missing patterns", () => {
    expect(() => compileSong("t", { ...def, patterns: { a: { bars: 1, lines: { bass: "C3 . ." } } } })).toThrow();
    expect(() => compileSong("t", { ...def, order: [{ p: "nope" }] })).toThrow();
  });
});

describe("SONGS", () => {
  it("are whole bars with tone notes in a playable range", () => {
    for (const song of Object.values(SONGS)) {
      expect(song.steps.length % 16).toBe(0);
      for (const evs of song.steps) {
        for (const e of evs) {
          if ((DRUM_IDS as readonly string[]).includes(e.inst)) continue;
          expect(e.midi).toBeGreaterThanOrEqual(30);
          expect(e.midi).toBeLessThanOrEqual(96);
        }
      }
    }
  });
});
