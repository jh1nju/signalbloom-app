# AI Tool Usage

| Date | Tool | What it produced | What the team changed or checked |
|------|------|------------------|----------------------------------|
| 2026-10-22 | Google AI Studio | Cloud SQL schema (13 tables), seed script, agent API endpoints | Checked the schema against SPEC.md and API.md; tested endpoints on a dev test page |
| 2026-10-22 | Claude Code | Agent skeleton, config loading and error messages (except _validate), registration (except retry_wait), fake cloud for testing, ping/uptime/gateway collectors | Reviewed each plan before approval; ran all tests |
| 2026-10-22 | GitHub Copilot | Windows route parser (_gateway_from_windows_route) | Ran the test suite; confirmed it found the real router (192.168.88.1) |
| 2026-10-22 | Claude Code | Device scanner and recheck logic (except _is_online), bandwidth collector, 2-miss offline rule | Chose the online rule after weighing false alerts against missed ones; asked for the 2-miss rule to stop flicker; ran all 97 tests and a real scan |
| 2026-10-22 | Claude (claude.ai chat) | Code for _validate (config checks), retry_wait (registration retry waits) and _is_online (ping-or-ARP rule) | Reviewed, added and tested each one; chose the config rules |
| 2026-10-23 | Claude Code | Main loop, sender (except _send_part), buffer, fake cloud changes | Chose the bandwidth test timing and the 400-splitting rule |
| 2026-10-23 | Claude (claude.ai chat) | Code for _send_part (split-and-retry on 400/413) | Reviewed, added and ran all sender tests |
| 2026-10-23 | Claude Code | Command poller, saved command state, result storage and resend loop (except result_action), fake cloud /debug/commands endpoint, tests | Reviewed the plan; checked unknown types are refused and fixes never run twice; ran all tests and the live checks |
| 2026-10-23 | Claude (claude.ai chat) | Code for result_action (maps the cloud's reply to recorded, drop or retry) | Reviewed, added and tested it; chose the allowed command list and the retry rules |
| 2026-10-23 | Claude Code | Demo fault switch (flag and file) (except apply_fault), on/off logging, settings, send-line values, tests | Reviewed the plan; ran all tests and the live on/off checks |
| 2026-10-23 | Claude (claude.ai chat) | Code for apply_fault (applies the fault to a copy of the reading) | Reviewed, added and tested it; fixed an indentation error when pasting |
| 2026-10-23 | Google AI Studio | Sample data script, app shell, Network Health tab (score, breakdown, 24-hour charts), liquid glass theme | Reviewed each result in the preview; corrected renamed labels, invented taglines and a redrawn logo; ran the weight-change check |
| 2026-10-23 | Claude (claude.ai chat) | Health score parts, starting weights and limits; theme and label-correction prompts; cleaned-up logo PNG (transparent background, upscaled) | Chose to use the weights as starting values for the team to confirm; chose the final label names |
| 2026-10-23 | Google AI Studio | Alert engine, alerts API, Active alerts panel, Security tab, sample generator and Simulate fault | Reviewed the plan and asked for three changes before building; ran the fault, grouping and recovery checks |
| 2026-10-23 | Claude (claude.ai chat) | Alert rules and thresholds; the three plan changes (evaluate each reading once, first-10-minutes rule for new devices, dev routes not mounted in production); diagnosis of the slow score recovery | Chose the rules and the 5-minute score window |
