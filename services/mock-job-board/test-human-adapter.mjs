// Test harness only. Production orchestration must never import this module.
export async function fixtureHumanCaptcha({ baseUrl, draftId, testToken }) {
  if (!testToken || new URL(baseUrl).port !== '3002' || !['127.0.0.1', 'localhost', 'mock-job-board'].includes(new URL(baseUrl).hostname)) throw new Error('TEST_ADAPTER_MOCK_ONLY');
  const response = await fetch(`${baseUrl}/__test/captcha?draft=${encodeURIComponent(draftId)}`, { headers: { 'x-test-token': testToken } });
  if (!response.ok) throw new Error('FIXTURE_HUMAN_ADAPTER_FAILED');
  return response.json();
}
