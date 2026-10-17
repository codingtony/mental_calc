import { describe, expect, it } from "vitest";
import { parseLook } from "./look";

const valid = { body: "girl", bike: [0.9, 0.05, 0.1], suit: [0.2, 0.5, 1], helmet: "mirror", helmetColor: [1, 1, 1] };

describe("parseLook", () => {
  it("accepts a valid look and ignores extra keys", () => {
    expect(parseLook({ ...valid, extra: 1 })).toEqual(valid);
  });

  it("rejects non-objects", () => {
    expect(parseLook(null)).toBeNull();
    expect(parseLook([valid])).toBeNull();
    expect(parseLook("girl")).toBeNull();
  });

  it("rejects unknown body or helmet", () => {
    expect(parseLook({ ...valid, body: "robot" })).toBeNull();
    expect(parseLook({ ...valid, helmet: "crown" })).toBeNull();
  });

  it("rejects colours that are not exactly 3 finite numbers", () => {
    expect(parseLook({ ...valid, bike: [1, 1] })).toBeNull();
    expect(parseLook({ ...valid, suit: [1, 1, 1, 1] })).toBeNull();
    expect(parseLook({ ...valid, helmetColor: [1, "1", 1] })).toBeNull();
    expect(parseLook({ ...valid, bike: [1, Number.NaN, 1] })).toBeNull();
  });

  it("clamps channels to [0, 1]", () => {
    expect(parseLook({ ...valid, bike: [1.5, -0.2, 0.5] })?.bike).toEqual([1, 0, 0.5]);
  });
});
