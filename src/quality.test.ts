import { describe, expect, it } from "vitest";
import { qualityDrop } from "./quality";

describe("qualityDrop", () => {
  it("keeps the level when smooth, drops one when slow and two when unplayable", () => {
    expect(qualityDrop(60)).toBe(0);
    expect(qualityDrop(48)).toBe(0);
    expect(qualityDrop(47.9)).toBe(1);
    expect(qualityDrop(32)).toBe(1);
    expect(qualityDrop(31.9)).toBe(2);
    expect(qualityDrop(8)).toBe(2);
  });
});
