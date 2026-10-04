export function classifyAnalysisFailure(error) {
  if(['INPUT_BUDGET_EXCEEDED','NATIVE_TOKEN_COUNT_UNVERIFIED','LMSTUDIO_MODEL_UNVERIFIED','INFERENCE_TIMEOUT'].includes(error?.code))return 'INFRASTRUCTURE';
  const message = String(error?.message ?? "");
  const transient =
    /TimeoutError|AbortError|timed? ?out|ECONNRESET|ECONNREFUSED|fetch failed|Ollama HTTP (?:429|5\d\d)/i.test(
      message,
    ) || ["TimeoutError", "AbortError"].includes(error?.name)||/^HTTP_(?:429|5\d\d)$|^(?:TIMEOUT|NETWORK_ERROR)$/.test(error?.code??'');
  return transient ? "TRANSIENT" : "SEMANTIC_OR_CONFIGURATION";
}
export function retryPlan(
  error,
  attempt,
  { now = new Date(), maxAttempts = 3, baseMs = 60000 } = {},
) {
  const kind = classifyAnalysisFailure(error);
  const infrastructure=kind==='INFRASTRUCTURE';
  const retryable = infrastructure || kind === "TRANSIENT" && (error?.code==='HTTP_429'||attempt < maxAttempts);
  return {
    kind,
    retryable,
    consumes_attempt: !infrastructure,
    status: retryable ? "ANALYSIS_RETRY" : "ANALYSIS_DEAD_LETTER",
    next_retry_at: retryable
      ? new Date(
          now.getTime() + (infrastructure?300000:error?.code==='HTTP_429'?Math.max(300000,Number(error.retry_after_seconds||0)*1000):baseMs * 2 ** Math.max(0, attempt - 1)),
        ).toISOString()
      : null,
  };
}
