import { describe, expect, it } from "vitest";
import { RaceSession } from "./race";

describe("RaceSession lives", () => {
  it("crashes on the wrong answer that loses the 3rd and last heart", () => {
    const s = new RaceSession([{ text: "1 + 1", answer: 2 }], 10, []);
    s.start(0);
    expect(s.submit("5", 100)).toBe("wrong");
    expect(s.submit("5", 200)).toBe("wrong");
    expect(s.status).toBe("running");
    expect(s.submit("5", 300)).toBe("crashed");
    expect(s.status).toBe("crashed");
    expect(s.submit("2", 400)).toBe("ignored");
  });
});
