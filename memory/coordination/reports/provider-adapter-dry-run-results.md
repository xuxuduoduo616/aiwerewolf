# Provider Adapter Dry-Run Results

- Date: 2026-07-16T10:45:59.319Z
- Mode: dry-run only (zero network)
- Network/SDK access attempts during dry-run phase: 0

| Provider | Protocol | Model | Dry-run | Live probe |
| --- | --- | --- | --- | --- |
| gemini-2.5-flash | gemini | gemini-2.5-flash | PASS — model_used=gemini-2.5-flash, cost_estimate=9e-7, fallback_used=false | skipped — LIVE_PROBE not set |
| aicodemirror-claude | anthropic-messages | claude-sonnet-4-6 | PASS — model_used=aicodemirror-claude, cost_estimate=0.000018, fallback_used=false | skipped — LIVE_PROBE not set |
| deepseek-anthropic | anthropic-messages | deepseek-chat | PASS — model_used=deepseek-anthropic, cost_estimate=0.0000016200000000000002, fallback_used=false | skipped — LIVE_PROBE not set |
| deepseek-openai | openai-chat | deepseek-chat | PASS — model_used=deepseek-openai, cost_estimate=0.0000016200000000000002, fallback_used=false | skipped — LIVE_PROBE not set |
| local-fallback | local | local-fallback | PASS — model_used=local-fallback, cost_estimate=0, fallback_used=false | skipped — LIVE_PROBE not set |

## Open issues

- none
