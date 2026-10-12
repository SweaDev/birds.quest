import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config";

const validEnv = {
  DATABASE_URL: "mysql://app:pw@127.0.0.1:3306/birdsquest",
  TRACCAR_DATABASE_URL: "mysql://ro:pw@127.0.0.1:3306/traccar",
  ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
  SESSION_SECRET: "x".repeat(32),
};

describe("parseConfig", () => {
  it("applies defaults for a minimal valid env", () => {
    const config = parseConfig(validEnv);
    expect(config.idleThresholdMinutes).toBe(10);
    expect(config.minTripMinutes).toBe(10);
    expect(config.predictionThreshold).toBe(0.15);
    expect(config.predictionTopK).toBe(20);
    expect(config.wikipediaUserAgent).toMatch(/^birds\.quest\//);
    expect(config.traccarAdminDatabaseUrl).toBeUndefined();
    expect(config.llm).toEqual({
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: undefined,
      model: "gemma4:e2b",
      reasoningEffort: "none",
    });
  });

  it("treats empty values as unset", () => {
    const config = parseConfig({
      ...validEnv,
      LLM_BASE_URL: "",
      LLM_MODEL: "",
      IDLE_THRESHOLD_MINUTES: "",
      TRACCAR_ADMIN_DATABASE_URL: "",
    });
    expect(config.llm.model).toBe("gemma4:e2b");
    expect(config.idleThresholdMinutes).toBe(10);
    expect(config.traccarAdminDatabaseUrl).toBeUndefined();
  });

  it("coerces numeric tuning values from strings", () => {
    const config = parseConfig({
      ...validEnv,
      IDLE_THRESHOLD_MINUTES: "15",
      MIN_TRIP_MINUTES: "12",
      PREDICTION_THRESHOLD: "0.3",
      PREDICTION_TOP_K: "8",
      WIKIPEDIA_USER_AGENT: "me/1 (me@example.com)",
    });
    expect(config).toMatchObject({
      idleThresholdMinutes: 15,
      minTripMinutes: 12,
      predictionThreshold: 0.3,
      predictionTopK: 8,
      wikipediaUserAgent: "me/1 (me@example.com)",
    });
  });

  it("keeps posts as drafts unless AUTO_PUBLISH is switched on", () => {
    expect(parseConfig(validEnv).autoPublish).toBe(false);
    expect(parseConfig({ ...validEnv, AUTO_PUBLISH: "" }).autoPublish).toBe(false);
    expect(parseConfig({ ...validEnv, AUTO_PUBLISH: "true" }).autoPublish).toBe(true);
    expect(parseConfig({ ...validEnv, AUTO_PUBLISH: "1" }).autoPublish).toBe(true);
    expect(parseConfig({ ...validEnv, AUTO_PUBLISH: "false" }).autoPublish).toBe(false);
    expect(() => parseConfig({ ...validEnv, AUTO_PUBLISH: "yes" })).toThrow(/AUTO_PUBLISH/);
  });

  it("accepts \\$-escaped argon2 hashes from .env files", () => {
    const config = parseConfig({
      ...validEnv,
      ADMIN_PASSWORD_HASH: "\\$argon2id\\$v=19\\$m=65536,t=3,p=4\\$salt\\$hash",
    });
    expect(config.adminPasswordHash).toBe(validEnv.ADMIN_PASSWORD_HASH);
  });

  it("requires an API key for DigitalOcean and defaults to Gemma 4", () => {
    const env = { ...validEnv, LLM_PROVIDER: "digitalocean" };
    expect(() => parseConfig(env)).toThrow(/LLM_API_KEY/);

    const config = parseConfig({ ...env, LLM_API_KEY: "key" });
    expect(config.llm).toEqual({
      provider: "digitalocean",
      baseUrl: "https://inference.do-ai.run/v1",
      apiKey: "key",
      model: "gemma-4-31B-it",
      reasoningEffort: undefined,
    });
    expect(parseConfig({ ...env, LLM_API_KEY: "k", LLM_MODEL: "other", LLM_REASONING_EFFORT: "low" }).llm).toMatchObject({
      model: "other",
      reasoningEffort: "low",
    });
  });

  it("strips trailing slashes from a custom LLM base URL", () => {
    const config = parseConfig({ ...validEnv, LLM_BASE_URL: "http://example.test/v1/" });
    expect(config.llm.baseUrl).toBe("http://example.test/v1");
  });

  it.each([
    ["DATABASE_URL", undefined],
    ["DATABASE_URL", "postgres://x"],
    ["TRACCAR_DATABASE_URL", ""],
    ["ADMIN_PASSWORD_HASH", "plaintext"],
    ["SESSION_SECRET", "too-short"],
    ["PREDICTION_THRESHOLD", "1.5"],
    ["PREDICTION_TOP_K", "0"],
    ["IDLE_THRESHOLD_MINUTES", "abc"],
    ["LLM_PROVIDER", "openai"],
    ["LLM_REASONING_EFFORT", "maximum"],
  ])("rejects invalid %s=%s", (key, value) => {
    const env: Record<string, string | undefined> = { ...validEnv, [key]: value };
    expect(() => parseConfig(env)).toThrow(ConfigError);
    expect(() => parseConfig(env)).toThrow(key);
  });

  it("never leaks secret values in error messages", () => {
    try {
      parseConfig({ ...validEnv, SESSION_SECRET: "super-secret-short" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-short");
    }
  });
});
