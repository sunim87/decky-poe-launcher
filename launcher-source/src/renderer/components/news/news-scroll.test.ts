import { describe, expect, it } from "vitest";

import { getExpandedNewsScrollTop } from "./news-scroll";

describe("expanded news scroll positioning", () => {
  it("does not scroll when the expanded content is already visible", () => {
    expect(
      getExpandedNewsScrollTop({
        containerScrollTop: 120,
        containerTop: 100,
        containerBottom: 500,
        itemTop: 160,
        itemBottom: 360,
        contentBottom: 440,
      }),
    ).toBeNull();
  });

  it("aligns the opened item near the list top when expanded content is clipped", () => {
    expect(
      getExpandedNewsScrollTop({
        containerScrollTop: 120,
        containerTop: 100,
        containerBottom: 500,
        itemTop: 260,
        itemBottom: 620,
        contentBottom: 620,
      }),
    ).toBe(276);
  });

  it("clamps the target scroll position to the top of the list", () => {
    expect(
      getExpandedNewsScrollTop({
        containerScrollTop: 0,
        containerTop: 100,
        containerBottom: 500,
        itemTop: 80,
        itemBottom: 300,
        contentBottom: 300,
      }),
    ).toBe(0);
  });
});
