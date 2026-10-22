# AI Tool Usage

| Date | Tool | What it produced | What the team changed or checked |
|------|------|------------------|----------------------------------|
| 2026-10-22 | Google AI Studio | Cloud SQL schema (13 tables), seed script, agent API endpoints | Checked the schema against SPEC.md and API.md; tested endpoints on a dev test page |
| 2026-10-22 | Claude Code | Agent skeleton, config validation, registration, fake cloud for testing, ping/uptime/gateway collectors | Reviewed each plan before approval; wrote retry_wait; ran all tests |
| 2026-10-22 | GitHub Copilot | Windows route parser (_gateway_from_windows_route) | Ran the test suite; confirmed it found the real router (192.168.88.1) |
| 2026-10-22 | Claude Code | Device discovery and bandwidth collectors, per-device online rule, 2-miss offline rule | Chose the online rule after weighing false alerts against missed ones; asked for the 2-miss rule to stop flicker; ran all 97 tests and a real scan |
