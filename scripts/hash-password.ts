// Creates the ADMIN_PASSWORD_HASH value for .env.
// Usage: pnpm admin:hash   (prompts for the password; it is not echoed)
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/auth";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow echoed characters; only the prompt is printed.
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    out._writeToOutput = (s) => {
      if (!prompted) {
        process.stdout.write(s);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const password = process.env.ADMIN_PASSWORD ?? (await askHidden("New admin password: "));
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log("\nAdd this line to .env (the $ signs are escaped for .env files):\n");
  console.log(`ADMIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
}

void main();
