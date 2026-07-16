# Provider Discovery — Initial Findings

Date: 2026-07-16
Method: unauthenticated curl probes (plus dummy-credential probes to classify auth errors). No real keys were sent to any remote endpoint. All curls used `--connect-timeout 10 --max-time 15`.

Network context: local DNS is 114.114.114.114 with a fake-IP proxy in front (all hosts resolve to 198.18.0.x), i.e. traffic goes through a local proxy/VPN. This affects reachability results, especially vibecoder.store.

## Results (JSON)

```json
{
  "providers": [
    {
      "name": "aicodemirror-claudecode",
      "base_url": "https://api.aicodemirror.com/api/claudecode",
      "reachable": true,
      "protocol_type": "anthropic-messages (proxy)",
      "model_ids_found": [],
      "auth_method": "x-api-key OR Authorization: Bearer (provider-issued key; both header styles accepted)",
      "notes": [
        "TLS cert CN=aicodemirror.com (Google Trust Services), served via Cloudflare, Next.js app titled 'Claude Mirror Proxy Service'.",
        "GET /api/claudecode -> 404 (Next.js HTML). It is a base path, not an endpoint.",
        "POST /api/claudecode/v1/messages (no auth) -> 401 {\"error\":\"Unauthorized - No authentication provided\"}.",
        "POST /api/claudecode/v1/messages with dummy x-api-key -> 401 {\"error\":\"Unauthorized - Invalid API Key\"}; same result with dummy Bearer token, so both header styles are parsed.",
        "GET /api/claudecode/v1/models (no auth) -> 401 same error shape; model listing appears to exist behind auth but could not be enumerated without a key.",
        "GET /v1/models and /models at domain root -> 404 Next.js page (no OpenAI-style root API).",
        "Error body shape {\"error\": \"string\"} is the proxy's own wrapper, not Anthropic's {\"type\":\"error\",\"error\":{...}} — expect proxy-specific error handling."
      ]
    },
    {
      "name": "vibecoder-store",
      "base_url": "https://vibecoder.store",
      "reachable": false,
      "protocol_type": "unknown (could not connect)",
      "model_ids_found": [],
      "auth_method": "unknown",
      "notes": [
        "DNS resolves (fake-IP 198.18.0.164 via local proxy).",
        "TCP connect succeeds, then TLS handshake dies: curl (35) LibreSSL SSL_ERROR_SYSCALL — connection reset during ClientHello. Reproduced on 2 attempts.",
        "Plain HTTP (port 80) also fails (exit code 000).",
        "Pattern is consistent with the site being down, blocking this network path, or being GFW/proxy-filtered. Cannot classify as Anthropic-Messages or Codex candidate from this machine. Retry from a different network/proxy rule before ruling it out."
      ]
    },
    {
      "name": "deepseek-anthropic",
      "base_url": "https://api.deepseek.com/anthropic",
      "reachable": true,
      "protocol_type": "anthropic-messages (DeepSeek official Anthropic-compatible endpoint)",
      "model_ids_found": ["deepseek-chat (accepted by route; list endpoint requires auth)"],
      "auth_method": "x-api-key: <DeepSeek API key> (Anthropic-style header accepted on /anthropic; /v1 uses Authorization: Bearer)",
      "notes": [
        "AWS CloudFront + ELB, cert *.deepseek.com.",
        "GET /anthropic (no auth) -> 401 plain-text 'Authentication Fails (governor)'.",
        "POST /anthropic/v1/messages with dummy x-api-key -> 401 JSON {\"error\":{\"message\":\"Authentication Fails, Your api key: test is invalid\",\"type\":\"authentication_error\",...}} — the route parses x-api-key, confirming Anthropic-style auth works here.",
        "GET /v1/models with dummy Bearer -> same authentication_error JSON (OpenAI-style error object). Model list requires a valid key; DeepSeek's published models are deepseek-chat and deepseek-reasoner but that was NOT verified live (auth required).",
        "GET /models and /anthropic/v1/models without auth -> 401 governor text; no unauthenticated model listing."
      ]
    },
    {
      "name": "aicodemirror-codex",
      "base_url": "https://api.aicodemirror.com/api/codex/backend-api/codex",
      "reachable": true,
      "protocol_type": "codex-backend (OpenAI Responses-style, ChatGPT backend-api proxy)",
      "model_ids_found": [],
      "auth_method": "Authorization header with provider-issued key in a specific format (dummy 'sk-...' rejected as 'Invalid API Key format')",
      "notes": [
        "GET base path (no auth) -> 401 {\"error\":\"Unauthorized - No authorization header provided\"}, content-type application/json — this path IS routed (unlike /api/claudecode which 404s on GET), consistent with a codex backend-api mount.",
        "POST /api/codex/backend-api/codex/responses (no auth) -> 401 same 'No authorization header provided'.",
        "POST /responses with dummy 'Bearer sk-test-dummy' -> 401 {\"error\":\"Unauthorized - Invalid API Key format\"} — the proxy validates key format before upstream, implying keys have a provider-specific prefix (not 'sk-').",
        "No unauthenticated model listing found."
      ]
    }
  ],
  "environment": {
    "keys_in_env": "ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN found in env (values not inspected/printed). ANTHROPIC_BASE_URL points to a local proxy http://127.0.0.1:15721, so these env credentials belong to the local router, not necessarily to any provider above. They were NOT sent to any remote host.",
    "default_models_in_env": ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5", "claude-fable-5"]
  },
  "open_questions": [
    "vibecoder.store reachability — retest from another network or with different proxy rules.",
    "Model enumeration on both aicodemirror routes and deepseek requires valid keys; needs a follow-up authenticated probe with the correct provider keys (do not reuse the local-proxy Anthropic token for this)."
  ]
}
```
