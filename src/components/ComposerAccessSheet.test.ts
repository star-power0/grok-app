import { describe, expect, it } from "vitest";
import { computeAccessSheetRect } from "./ComposerModelMenu";

function trigger(left: number, top: number, width = 156, height = 28) {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
  };
}

describe("computeAccessSheetRect", () => {
  it("uses one fixed sheet above the composer when there is room", () => {
    expect(computeAccessSheetRect(trigger(800, 700), 1440, 900)).toEqual({
      left: 536,
      top: 52,
      width: 420,
      height: 640,
    });
  });

  it("pins the sheet to the viewport margin when it cannot fit above", () => {
    expect(computeAccessSheetRect(trigger(500, 120), 1280, 720)).toEqual({
      left: 236,
      top: 8,
      width: 420,
      height: 640,
    });
  });

  it("uses the available viewport height without measuring panel content", () => {
    expect(computeAccessSheetRect(trigger(500, 300), 1280, 420)).toEqual({
      left: 236,
      top: 8,
      width: 420,
      height: 404,
    });
  });

  it("clamps the fixed sheet width into a narrow viewport", () => {
    expect(computeAccessSheetRect(trigger(300, 500), 380, 800)).toEqual({
      left: 8,
      top: 8,
      width: 364,
      height: 640,
    });
  });
});
