import { z } from "zod";

// Treat empty strings (e.g. `KEY=` in .env) as unset so defaults apply.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const dbUrl = z
  .string()
  .min(1)
  .refine((value) => /^(mysql|mariadb):\/\//.test(value), {
    message: "must start with mysql:// or mariadb://",
  });

// The default lives inside the preprocess so that blank values also fall back to it.
const number = (min: number, max: number, fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).default(fallback));

const integer = (min: number, max: number, fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));

const DEFAULT_WIKIPEDIA_USER_AGENT = "birds.quest/0.1 (bird watching blog; https://birds.quest)";

const LLM_DEFAULTS = {
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "gemma4:e2b",
    // Gemma 4 on Ollama "thinks" by default and can use its whole token budget before answering.
    reasoningEffort: "none",
  },
  digitalocean: {
    baseUrl: "https://inference.do-ai.run/v1",
    model: "gemma-4-31B-it",
    reasoningEffort: undefined,
  },
} as const;

const envSchema = z
  .object({
    // Databases: the app owns its own schema; Traccar's DB is read-only.
    DATABASE_URL: dbUrl,
    TRACCAR_DATABASE_URL: dbUrl,
    // Dev only: lets the seed script create fake Traccar tables.
    TRACCAR_ADMIN_DATABASE_URL: optional(dbUrl),

    LLM_PROVIDER: z.enum(["ollama", "digitalocean"]).default("ollama"),
    LLM_BASE_URL: optional(z.url()),
    LLM_API_KEY: optional(z.string().min(1)),
    LLM_MODEL: optional(z.string().min(1)),
    // Sent as `reasoning_effort` when set. Defaults: ollama "none", digitalocean unset.
    LLM_REASONING_EFFORT: optional(z.enum(["none", "low", "medium", "high"])),

    // `$` must be written as `\$` in .env files (Next.js expands `$VAR`); the
    // backslashes are removed here so every loader (Next, Node, systemd) works.
    ADMIN_PASSWORD_HASH: z
      .string()
      .transform((value) => value.replace(/\\\$/g, "$"))
      .refine((value) => value.startsWith("$argon2"), {
        message: "must be an argon2 hash (starts with $argon2)",
      }),
    SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),

    IDLE_THRESHOLD_MINUTES: integer(1, 24 * 60, 10),
    MIN_TRIP_MINUTES: integer(1, 24 * 60, 10),
    PREDICTION_THRESHOLD: number(0, 1, 0.15),
    PREDICTION_TOP_K: integer(1, 200, 20),

    // Wikimedia asks API clients to identify themselves, ideally with contact details.
    WIKIPEDIA_USER_AGENT: optional(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === "digitalocean") {
      if (!env.LLM_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["LLM_API_KEY"],
          message: "required when LLM_PROVIDER=digitalocean",
        });
      }
    }
  });

export type Config = {
  databaseUrl: string;
  traccarDatabaseUrl: string;
  traccarAdminDatabaseUrl?: string;
  llm: {
    provider: "ollama" | "digitalocean";
    baseUrl: string;
    apiKey?: string;
    model: string;
    reasoningEffort?: "none" | "low" | "medium" | "high";
  };
  adminPasswordHash: string;
  sessionSecret: string;
  idleThresholdMinutes: number;
  minTripMinutes: number;
  predictionThreshold: number;
  predictionTopK: number;
  wikipediaUserAgent: string;
};

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  const e = result.data;
  const defaults = LLM_DEFAULTS[e.LLM_PROVIDER];
  return {
    databaseUrl: e.DATABASE_URL,
    traccarDatabaseUrl: e.TRACCAR_DATABASE_URL,
    traccarAdminDatabaseUrl: e.TRACCAR_ADMIN_DATABASE_URL,
    llm: {
      provider: e.LLM_PROVIDER,
      baseUrl: (e.LLM_BASE_URL ?? defaults.baseUrl).replace(/\/+$/, ""),
      apiKey: e.LLM_API_KEY,
      model: e.LLM_MODEL ?? defaults.model,
      reasoningEffort: e.LLM_REASONING_EFFORT ?? defaults.reasoningEffort,
    },
    adminPasswordHash: e.ADMIN_PASSWORD_HASH,
    sessionSecret: e.SESSION_SECRET,
    idleThresholdMinutes: e.IDLE_THRESHOLD_MINUTES,
    minTripMinutes: e.MIN_TRIP_MINUTES,
    predictionThreshold: e.PREDICTION_THRESHOLD,
    predictionTopK: e.PREDICTION_TOP_K,
    wikipediaUserAgent: e.WIKIPEDIA_USER_AGENT ?? DEFAULT_WIKIPEDIA_USER_AGENT,
  };
}

let cached: Config | undefined;

// Parsed lazily so that importing this module (e.g. during `next build`) never throws.
export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
