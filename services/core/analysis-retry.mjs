export function classifyAnalysisFailure(error) {
  const message = String(error?.message ?? "");
  const transient =
    /TimeoutError|AbortError|timed? ?out|ECONNRESET|ECONNREFUSED|fetch failed|Ollama HTTP (?:429|5\d\d)/i.test(
      message,
    ) || ["TimeoutError", "AbortError", "TypeError"].includes(error?.name);
  return transient ? "TRANSIENT" : "SEMANTIC_OR_CONFIGURATION";
}
export function retryPlan(
  error,
  attempt,
  { now = new Date(), maxAttempts = 3, baseMs = 60000 } = {},
) {
  const kind = classifyAnalysisFailure(error);
  const retryable = kind === "TRANSIENT" && attempt < maxAttempts;
  return {
    kind,
    retryable,
    status: retryable ? "ANALYSIS_RETRY" : "ANALYSIS_DEAD_LETTER",
    next_retry_at: retryable
      ? new Date(
          now.getTime() + baseMs * 2 ** Math.max(0, attempt - 1),
        ).toISOString()
      : null,
  };
}
