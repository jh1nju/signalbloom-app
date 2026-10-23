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
