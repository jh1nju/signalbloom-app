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
