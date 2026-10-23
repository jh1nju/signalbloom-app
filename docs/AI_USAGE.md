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
