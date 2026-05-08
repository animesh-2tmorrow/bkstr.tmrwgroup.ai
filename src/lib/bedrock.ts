import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const globalForBedrock = globalThis as unknown as { bedrockClient?: BedrockRuntimeClient };

export const bedrockClient =
  globalForBedrock.bedrockClient ?? new BedrockRuntimeClient({ region: "us-east-1" });

if (process.env.NODE_ENV !== "production") globalForBedrock.bedrockClient = bedrockClient;
