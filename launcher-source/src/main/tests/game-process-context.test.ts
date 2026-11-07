import { describe, expect, it } from "vitest";

import { processMatchesGameContext } from "../utils/game-process-context";

describe("processMatchesGameContext", () => {
  it("trusts ProcessWatcher inferred context for Kakao shared clients", () => {
    expect(
      processMatchesGameContext(
        {
          name: "PathOfExile_KG.exe",
          path: "",
          gameId: "POE2",
          serviceId: "Kakao Games",
        },
        { gameId: "POE2", serviceId: "Kakao Games" },
      ),
    ).toBe(true);
  });

  it("does not match a Kakao shared client with no path or inferred context", () => {
    expect(
      processMatchesGameContext(
        { name: "PathOfExile_KG.exe", path: "" },
        { gameId: "POE2", serviceId: "Kakao Games" },
      ),
    ).toBe(false);
  });

  it("matches GGG clients by install path when available", () => {
    expect(
      processMatchesGameContext(
        { name: "PathOfExile.exe", path: "C:\\Games\\Path of Exile 2" },
        { gameId: "POE2", serviceId: "GGG" },
      ),
    ).toBe(true);
  });

  it("does not match a GGG client with no path or inferred context", () => {
    expect(
      processMatchesGameContext(
        { name: "PathOfExile.exe", path: "" },
        { gameId: "POE2", serviceId: "GGG" },
      ),
    ).toBe(false);
  });
});
