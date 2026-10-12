import type { Config } from "./config";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompleteOptions = {
  maxTokens?: number;
  temperature?: number;
};

export interface LlmClient {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type LlmClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Per attempt. Local models can be slow, hence the generous default. */
  timeoutMs?: number;
  /** Extra attempts after the first one, for network errors, timeouts, 429 and 5xx. */
  maxRetries?: number;
};

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1_000;
const MAX_RETRY_AFTER_MS = 30_000;
const ERROR_BODY_LIMIT = 300;

type ChatCompletionResponse = {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
};

/** Reasoning models may inline their thoughts; the post must only contain the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractContent(body: ChatCompletionResponse): string {
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  text = stripThinking(text);
  if (!text) {
    const why = choice?.finish_reason === "length" ? " (token limit reached before an answer)" : "";
    throw new LlmError(`The model returned no content${why}`, false);
  }
  return text;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

/** One OpenAI-compatible chat completions client for Ollama (dev) and DigitalOcean (production). */
export function createLlmClient(config: Config["llm"], options: LlmClientOptions = {}): LlmClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const url = `${config.baseUrl}/chat/completions`;

  async function attempt(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          ...(opts.temperature !== undefined && { temperature: opts.temperature }),
          ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
          ...(config.reasoningEffort && { reasoning_effort: config.reasoningEffort }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = (error as Error).name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : (error as Error).message;
      throw new LlmError(`LLM request failed: ${reason}`, true);
    }

    if (!response.ok) {
      // The key is never part of the message; only a short slice of the server's reply is.
      const detail = (await response.text().catch(() => "")).slice(0, ERROR_BODY_LIMIT);
      const retryable = response.status === 429 || response.status >= 500;
      throw new RetryableAwareError(`LLM request failed with HTTP ${response.status}: ${detail}`, retryable, response);
    }

    let body: ChatCompletionResponse;
    try {
      body = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new LlmError("LLM returned invalid JSON", true);
    }
    return extractContent(body);
  }

  return {
    async complete(messages, opts = {}) {
      for (let tries = 0; ; tries++) {
        try {
          return await attempt(messages, opts);
        } catch (error) {
          if (!(error instanceof LlmError) || !error.retryable || tries >= maxRetries) throw error;
          const wait =
            (error instanceof RetryableAwareError ? error.retryAfter : null) ?? BACKOFF_BASE_MS * 2 ** tries;
          await sleep(wait);
        }
      }
    },
  };
}

class RetryableAwareError extends LlmError {
  readonly retryAfter: number | null;
  constructor(message: string, retryable: boolean, response: Response) {
    super(message, retryable, response.status);
    this.retryAfter = retryAfterMs(response);
  }
}
