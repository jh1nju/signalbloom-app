# Testing Log

| Date | Test | Result | Notes |
|------|------|--------|-------|
| 2026-10-23 | Outage: agent offline, then reconnects | Pass | 4 readings buffered; all 5 sent on reconnect |
| 2026-10-23 | AC-07: phone leaves the network | Pass | Shown offline within one minute |
| 2026-10-23 | Command poller unit tests | Pass | All pytest tests pass, run with --basetemp=.pytest_tmp because the default Windows temp folder was locked |
| 2026-10-23 | Simulated fix round trip | Pass | Queued restart_device on the fake cloud; agent ran the simulated fix within 30 seconds and the result showed as succeeded |
| 2026-10-23 | Fix for a device not on the network | Pass | Made-up MAC reported as failed with a clear message |
| 2026-10-23 | Unsupported command type | Pass | delete_files refused as "Unsupported command type"; nothing ran |
| 2026-10-23 | Fix result during a cloud outage | Pass | Result arrived after the fake cloud restarted; the agent log shows the fix ran once |
| 2026-10-23 | Demo fault unit tests | Pass | 16 tests: readings unchanged when off, changed with the flag or the file, loss capped at 100, normal after turning off |
| 2026-10-23 | Demo fault on during a live run | Pass | Created data\demo_fault; within 30 s the agent logged DEMO FAULT ON and latency rose by about 300 ms |
| 2026-10-23 | Demo fault off during a live run | Pass | Deleted the file; within 30 s the agent logged the fault off and readings returned to normal |
| 2026-10-23 | Health score weights come from settings | Pass | Changed the uptime weight from 30 to 50; the score changed with no code change; set it back to 30 |
| 2026-10-23 | Health score per site | Pass | All three sites show a score; the site with worse sample data has the lowest |
| 2026-10-23 | Network Health at phone width | Pass | Layout fits a phone-sized window with no overflow |
| 2026-10-23 | Simulated fault raises alerts | Pass | Simulate fault on Botany Clinic: critical delay and packet loss alerts appeared and the score dropped |
| 2026-10-23 | Alerts group instead of repeating | Pass | During the fault the repeat count increased and no duplicate alerts appeared |
| 2026-10-23 | Alerts resolve by themselves | Pass | Alerts cleared after the fault ended. The score stayed low for about 12 more minutes because of the 15-minute window, which led to the change to 5 minutes (D-012) |
| 2026-10-23 | No new-device alerts for known devices | Pass | Security tab showed no "New device joined" alerts for the sample devices |
| 2026-10-23 | AI unavailable: alert fallback | Pass | With the Gemini quota used up, alert cards showed "Basic explanation (AI unavailable)" built from the alert reason |
| 2026-10-23 | AI unavailable: chat fallback | Pass | The AI Assistant showed "The AI assistant is busy right now" instead of an error |
| 2026-10-23 | No retry storm | Pass | Failed explanations were retried on the backoff schedule, one log line per attempt |
| 2026-10-23 | Devices tab | Pass | Summary counts match the table; All/Online/Offline filters work; cards at phone width |
| 2026-10-23 | Empty state for a new site | Pass | New Office (no agent) shows Connect this site with a valid setup code; a new code can be created |
| 2026-10-23 | Real AI explanations after the model switch | Pass | Simulate fault produced a real AI explanation; the chat answered "Why is my internet slow?" |
| 2026-10-23 | Approve fix: buttons and confirmation | Pass | After Simulate fault, a device recommendation showed both buttons; Approve fix asked for confirmation, then showed Waiting for the agent |
| 2026-10-23 | Approve fix: status updates | Pass | Simulate agent result moved the card to Running, then Done, with the agent's message |
| 2026-10-23 | Approve fix: no duplicates | Pass | A second approval for the same device and type was blocked while one was pending |
| 2026-10-23 | Activity log | Pass | The approval and the result appeared in Account & Settings, newest first |
| 2026-10-24 | Approved fix clears the demo fault | Pass | With the fake cloud: fault on, fix queued, agent logged DEMO FAULT OFF and the demo_fault file was removed |
| 2026-10-24 | Failed fix keeps the demo fault | Pass | A fix for a made-up MAC failed and the fault stayed on |
