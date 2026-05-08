// Whitelisted error info for fetch_logs.error_message.
//
// NEVER include err.message, err.stack, err.cause, err.$response, or any
// arbitrary error property — Bedrock errors occasionally echo prompt or
// response content in those fields, and D3.3 forbids persisting response
// content. This helper composes the return value from a closed allowlist:
// the error class name, the (string) error code, and a hardcoded human
// message keyed off the class name. Anything outside that allowlist is
// dropped before reaching fetch_logs.
//
// Per follow-up #21, output is capped at 500 chars; column stays TEXT for
// flexibility but the cap is enforced here at the app layer.

const ERROR_CLASS_MESSAGES: Record<string, string> = {
  ThrottlingException: "Bedrock returned a throttling error",
  ValidationException: "Bedrock validation error",
  ModelStreamErrorException: "Bedrock stream error",
  ModelTimeoutException: "Bedrock model timeout",
  AccessDeniedException: "Bedrock access denied",
  ServiceUnavailableException: "Bedrock service unavailable",
  InternalServerException: "Bedrock internal error",
  ResourceNotFoundException: "Bedrock resource not found",
  AbortError: "Request aborted",
};

const MAX_LEN = 500;

export function sanitizeError(err: unknown): string {
  let className: string = "UnknownError";
  if (err && typeof err === "object" && typeof err.constructor?.name === "string") {
    className = err.constructor.name;
  }
  const knownMessage = ERROR_CLASS_MESSAGES[className] ?? "Unknown error";
  let errorCode: string = className;
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof (err as { name: unknown }).name === "string"
  ) {
    errorCode = (err as { name: string }).name;
  }

  const composed = `${className} (${errorCode}): ${knownMessage}`;
  return composed.length > MAX_LEN ? composed.slice(0, MAX_LEN - 3) + "..." : composed;
}

// Note: there is no companion "sanitizeMessage" helper for app-generated
// strings (timeout, content_too_large, no-body). Adding one would create
// a sanitization-bypass surface — its `string` parameter would also accept
// user input and Bedrock body content. Instead, the route handler assigns
// short string literals or template literals over compile-time constants
// directly. The grep rule for fetch_logs.error_message becomes:
//   every assignment to `errorMessage` is one of:
//     - the initial `null`
//     - a string literal
//     - a template literal whose only interpolations are compile-time
//       module-level constants
//     - `sanitizeError(err)`
// Anything else is a sanitization-bypass risk and must be flagged in review.
