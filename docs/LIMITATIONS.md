# Known Limitations

- Registration: if registration succeeds but the reply is lost, the setup code is used up and the user needs a new one. A production version would allow a short retry window on the server.
- Device status: devices that never answer ping (for example firewalled PCs) rely on the ARP table, so they can take several minutes to show as offline.
- One-click fixes (restart, isolate, reconnect device) are simulated in the prototype. The command round trip is real, but no device is actually changed.
- The demo fault changes readings on purpose to show a network problem on cue. It is only active when switched on.
- The agent was tested against a local fake cloud that follows API.md. It connects to the real cloud app once the app is published in Phase 6.
- The health score doesn't yet include device load or error rate, because the agent doesn't measure them. The proposal's full score would add these.
- The dashboard currently runs on sample data. Real agent data replaces it once the app is published.
- Alerts use fixed thresholds, not a learned baseline. Anomaly detection (Isolation Forest) is future work.
- Dev-only tools (sample data generator, Simulate fault) are switched off and their routes are not available in production.
- AI explanations depend on the Gemini API's availability and quota. When it's unavailable, a rule-based explanation is shown instead.
- The app uses the Gemini API free tier (500 requests a day per model). Heavier use would need a paid key.
- No multi-factor sign-in yet.
- No self-service sign-up for new organisations; accounts are created by the team.
- Billing shows sample pricing; no payments are taken.
- No email alerts yet; the email_outbox table exists, but nothing sends to it.
