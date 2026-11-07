import { describe, expect, it } from "vitest";

import { CONFIG_KEYS, CONFIG_METADATA, DEFAULT_CONFIG } from "./config";

describe("news open mode config", () => {
  it("registers the persistent news open mode config", () => {
    expect(CONFIG_KEYS.NEWS_OPEN_MODE).toBe("newsOpenMode");
    expect(CONFIG_METADATA.NEWS_OPEN_MODE.key).toBe(CONFIG_KEYS.NEWS_OPEN_MODE);
    expect(DEFAULT_CONFIG.newsOpenMode).toBe("inline");
  });
});
