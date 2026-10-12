import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { LlmError, createLlmClient, stripThinking } from "./llm";

const ollama: Config["llm"] = {
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  model: "gemma4:e2b",
  reasoningEffort: "none",
};
const digitalocean: Config["llm"] = {
  provider: "digitalocean",
  baseUrl: "https://inference.do-ai.run/v1",
  apiKey: "secret-key",
  model: "gemma-4-31B-it",
};

const ok = (content: unknown, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });

const messages = [{ role: "user" as const, content: "hi" }];

function setup(config: Config["llm"], responses: (Response | Error)[], extra = {}) {
  const queue = [...responses];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = createLlmClient(config, {
    fetch: fetchMock,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { client, fetchMock, sleeps };
}

const bodyOf = (fetchMock: ReturnType<typeof setup>["fetchMock"], call = 0) =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

describe("stripThinking", () => {
  it("removes think blocks and trims", () => {
    expect(stripThinking("<think>hmm\nmore</think>\n\nAnswer ")).toBe("Answer");
    expect(stripThinking("plain")).toBe("plain");
  });
});

describe("createLlmClient request", () => {
  it("posts an OpenAI-style chat completion to Ollama without an API key", async () => {
    const { client, fetchMock } = setup(ollama, [ok("Hello")]);
    expect(await client.complete(messages, { maxTokens: 300, temperature: 0.7 })).toBe("Hello");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(bodyOf(fetchMock)).toEqual({
      model: "gemma4:e2b",
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 300,
      reasoning_effort: "none",
    });
  });

  it("authenticates against DigitalOcean with a bearer key and sends no reasoning_effort", async () => {
    const { client, fetchMock } = setup(digitalocean, [ok("Hi")]);
    await client.complete(messages);

    expect(fetchMock.mock.calls[0][0]).toBe("https://inference.do-ai.run/v1/chat/completions");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    const body = bodyOf(fetchMock);
    expect(body.model).toBe("gemma-4-31B-it");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("max_tokens");
  });
});

describe("createLlmClient response", () => {
  it("joins content parts and strips inline thinking", async () => {
    const { client } = setup(ollama, [ok([{ text: "<think>x</think>Part one. " }, { text: "Part two." }])]);
    expect(await client.complete(messages)).toBe("Part one. Part two.");
  });

  it("fails clearly when the model only produced reasoning", async () => {
    const { client, fetchMock } = setup(ollama, [ok("", "length")]);
    await expect(client.complete(messages)).rejects.toThrow(/no content.*token limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails on invalid JSON after retrying", async () => {
    const { client, fetchMock } = setup(ollama, [
      new Response("<html>", { status: 200 }),
      new Response("<html>", { status: 200 }),
      new Response("<html>", { status: 200 }),
    ]);
    await expect(client.complete(messages)).rejects.toThrow(/invalid JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("createLlmClient retries", () => {
  it("retries 5xx and network errors with exponential backoff, then succeeds", async () => {
    const { client, fetchMock, sleeps } = setup(ollama, [
      new Response("busy", { status: 503 }),
      new TypeError("fetch failed"),
      ok("done"),
    ]);
    expect(await client.complete(messages)).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("honours Retry-After on 429, capped at 30 seconds", async () => {
    const { client, sleeps } = setup(digitalocean, [
      new Response("slow down", { status: 429, headers: { "retry-after": "5" } }),
      new Response("slow down", { status: 429, headers: { "retry-after": "999" } }),
      ok("done"),
    ]);
    await client.complete(messages);
    expect(sleeps).toEqual([5000, 30_000]);
  });

  it("gives up after maxRetries and reports the last error", async () => {
    const { client, fetchMock } = setup(ollama, [
      new Response("a", { status: 500 }),
      new Response("b", { status: 502 }),
      new Response("c", { status: 503 }),
    ]);
    const error = await client.complete(messages).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toContain("HTTP 503");
    expect(error.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors, and never leaks the API key", async () => {
    const { client, fetchMock } = setup(digitalocean, [new Response("bad key", { status: 401 })]);
    const error = await client.complete(messages).catch((e) => e);
    expect(error).toMatchObject({ retryable: false, status: 401 });
    expect(error.message).not.toContain("secret-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncates long error bodies", async () => {
    const { client } = setup(ollama, [new Response("x".repeat(5000), { status: 400 })]);
    const error = await client.complete(messages).catch((e) => e);
    expect(error.message.length).toBeLessThan(400);
  });

  it("honours maxRetries: 0", async () => {
    const { client, fetchMock } = setup(ollama, [new Response("x", { status: 500 })], { maxRetries: 0 });
    await expect(client.complete(messages)).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out slow requests and treats that as retryable", async () => {
    const slow = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const client = createLlmClient(ollama, {
      fetch: slow as unknown as typeof fetch,
      sleep: async () => {},
      timeoutMs: 20,
      maxRetries: 1,
    });
    const error = await client.complete(messages).catch((e) => e);
    expect(error.message).toMatch(/timed out after 20 ms/);
    expect(error.retryable).toBe(true);
    expect(slow).toHaveBeenCalledTimes(2);
  });
});
