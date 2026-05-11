import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

// Phase 5 Stream B (D14.2 / D14.4) — Bedrock client for the read-only admin
// assistant. Distinct from src/lib/bedrock.ts (the AWS-SDK low-level client
// the buyer-side /api/agent/fetch uses); this module instantiates the
// Anthropic-authored @anthropic-ai/bedrock-sdk which presents a higher-level
// `client.messages.create / .stream` surface with native tool-use support.
//
// Future Stream consolidation (follow-up #83) may collapse both modules onto
// one SDK; today they coexist because the buyer-side path is load-bearing
// production traffic and migrating it is a separate deliberate change.
//
// AUTH PATTERN (D14.4): bare instantiation `new AnthropicBedrock({ awsRegion })`.
// The AWS SDK default credential chain (env vars → shared creds file → EC2
// instance-profile metadata → ECS task role) is consulted internally; on the
// EC2 production box this resolves to the `bkstr-ec2-role` instance profile
// without any explicit `@aws-sdk/credential-providers` dep. The Gate 2 EC2
// smoke test (2026-05-11) confirmed this resolution path works end-to-end
// against the IAM role.
//
// LAZY-PROXY SINGLETON (D10.4 / template: src/lib/stripe.ts):
//   - Next.js's `next build` evaluates API route modules at compile time for
//     static analysis. Eager construction at module-load (i.e. `export const
//     bedrock = new AnthropicBedrock(...)`) can throw when AWS creds are not
//     present at build time on CI workers, breaking the build.
//   - The Proxy materializes the real client only on FIRST property access,
//     by which time the EC2 instance-profile chain has resolved real creds.
//   - This mirrors the precedent set by src/lib/stripe.ts:33-62 for the
//     Stripe client — same shape, same rationale.
//
// MODEL ID RESOLUTION (D14.2):
//   - `process.env.ASSISTANT_MODEL_ID` read at module-load time. If unset,
//     defaults to the VERBATIM buyer-side Sonnet 4.5 ID from
//     src/app/api/agent/fetch/route.ts:22 — same model, same provisioned
//     throughput, IAM role already approved.
//   - Opus 4.7 upgrade is follow-up #84 — Gate 1 IAM smoke test on
//     2026-05-11 returned 403 for that model ID; operator picked path (c)
//     "ship with Sonnet 4.5 default, upgrade later." Until #84 is closed,
//     operators staging /etc/bkstr/assistant.env with the Opus 4.7 ID will
//     get a Bedrock-side 403 on every assistant request.
//   - Boot-time WARN-on-missing (NOT fatal) — matches the stripe.env /
//     oauth.env / aws.env pattern at src/lib/stripe.ts:22-31. The assistant
//     route still works with the default; the warning surfaces the
//     "operator forgot to stage assistant.env" failure mode in pm2 logs
//     where the deploy can be audited.

// VERBATIM from src/app/api/agent/fetch/route.ts:22 (D14.2 exact-match-to-
// buyer-side-ID requirement). Do not change this string in lockstep without
// also bumping the buyer-side constant — they are deliberately coupled.
const DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

if (!process.env.ASSISTANT_MODEL_ID) {
  console.warn(
    "[assistant] WARN: ASSISTANT_MODEL_ID missing — defaulting to Sonnet 4.5. Stage /etc/bkstr/assistant.env to silence or upgrade to Opus 4.7 (see follow-up #84).",
  );
}

export const ASSISTANT_MODEL_ID: string = process.env.ASSISTANT_MODEL_ID || DEFAULT_MODEL_ID;

const globalForBedrock = globalThis as unknown as {
  assistantBedrockClient?: AnthropicBedrock;
};

function makeBedrockClient(): AnthropicBedrock {
  // No explicit credentials argument → the SDK consults the AWS default
  // credential chain. On EC2 this picks up the `bkstr-ec2-role` instance
  // profile; locally it picks up `~/.aws/credentials` or env vars per
  // standard SDK behavior.
  return new AnthropicBedrock({ awsRegion: "us-east-1" });
}

function getBedrockClient(): AnthropicBedrock {
  if (!globalForBedrock.assistantBedrockClient) {
    globalForBedrock.assistantBedrockClient = makeBedrockClient();
  }
  return globalForBedrock.assistantBedrockClient;
}

// Public surface: a Proxy onto a deferred-instantiation client. Reads like
// `bedrock.messages.create(...)` hit `get` → resolve the real client →
// forward. Keeps `import { bedrock } from "@/lib/admin/assistant/bedrock-client"`
// shape while deferring construction to first call.
export const bedrock = new Proxy({} as AnthropicBedrock, {
  get(_target, prop) {
    const client = getBedrockClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
