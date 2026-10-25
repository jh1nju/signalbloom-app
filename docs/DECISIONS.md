# Design Decisions

## D-001: Agent sends data out instead of a VPN tunnel
Context: the proposal uses an HA VPN tunnel into each customer network.
Options: HA VPN per site; agent calling the cloud over HTTPS.
Choice: outbound HTTPS with a per-site token for the prototype.
Reason: same goal (encrypted, customer network never exposed) at no cost; HA VPN stays the production design.

## D-002: What latency and packet loss measure
Context: the API has one latency_ms and one packet_loss_pct per reading, but the agent can ping both the router and a public address.
Options: public address only; router only; public address with the router as an extra local reading.
Choice: latency_ms and packet_loss_pct measure the public address (1.1.1.1). The router is pinged separately and shown as a local-only reading.
Reason: the public address reflects what staff experience; the router reading can later tell an office network problem from an internet provider problem.

## D-003: "Destination host unreachable" counts as packet loss
Context: Windows ping counts an "unreachable" reply from the router as a received packet.
Options: follow Windows; count it as lost.
Choice: count it as lost.
Reason: following Windows would under-report outages, for example showing 25% loss instead of 50%.

## D-004: How often devices are checked
Context: a full scan of the network (254 addresses) takes up to 30 seconds, but SPEC AC-07 needs an offline device to show within one minute.
Options: full scan every 5 minutes; full scan every 60 seconds; full scan every 5 minutes plus a quick recheck of known devices.
Choice: full scan every 5 minutes to find new devices, plus a quick ping of known devices on every cycle.
Reason: meets AC-07 without flooding the network with a full scan every minute.
Result: known devices are rechecked every 20 seconds; AC-07 met (a phone was shown offline within one minute, tested on 23 Oct).

## D-005: When a device counts as online
Context: Windows PCs block ping by default, but ARP table entries can stay for minutes after a device leaves.
Options: ping only; ping or ARP; ping for devices that answer it, ARP for devices that never do.
Choice: devices that have ever answered ping are judged by ping, and go offline after 2 missed checks in a row. Devices that never answer ping use the ARP table.
Reason: avoids false "offline" alerts for firewalled PCs (reducing alert fatigue is a core goal in the proposal), while devices that answer ping still show offline quickly.

## D-006: When the bandwidth test runs
Context: a bandwidth test can take up to 60 seconds, longer than the 30-second send interval, and a busy link raises ping latency.
Options: run it inline and skip a reading; run it in the background at any time; run it in the background straight after a ping.
Choice: background thread, started right after a reading's ping. Any overlap with the next ping is logged.
Reason: sends stay on time, and latency isn't raised by the test, which would otherwise cause false "slow network" alerts.

## D-007: What happens to readings the cloud rejects
Context: the cloud returns 400 invalid_body for a reading it can't accept, and a retry won't help.
Options: drop the whole batch; keep it in the buffer; split the batch to find the bad reading.
Choice: split the batch until the bad reading is isolated, drop only that reading, and save it to rejected.jsonl. If a single reading is still rejected, retry it once without the device list, in case the device list is the problem.
Reason: one bad reading can't block the queue or throw away hundreds of good ones, and the saved file shows exactly what the cloud rejected.

## D-008: The agent only runs three known commands
Context: the cloud can send commands to the agent to carry out approved one-click fixes. An agent that runs whatever the cloud sends would let anyone who took over the cloud or a site token control the customer's network.
Options: run any command the cloud sends; allow a fixed list of command types.
Choice: only restart_device, isolate_device and reconnect_device are allowed. Anything else is refused, reported as "Unsupported command type" and logged. In the prototype all three fixes are simulated.
Reason: a fixed list keeps the customer's network safe even if the cloud is compromised. Values like "rm -rf /" and "exec" are tested and refused.

## D-009: A fix never runs twice
Context: the agent's report of a fix result can be lost if the cloud is unreachable, and the cloud could send the same command again.
Options: re-run the fix when unsure; save each command's state and only resend the result.
Choice: handled command IDs and their results are saved before the fix runs. A lost result is resent next cycle without re-running the fix. If the agent stops mid-fix, the fix is reported as failed, not run again.
Reason: running a fix like "restart device" twice could disrupt the office, while resending a result is harmless.

## D-010: What happens after the cloud answers a fix result
Context: the cloud's reply to a fix result decides whether the agent keeps it.
Options: retry everything; drop everything that isn't a success; decide by status code.
Choice: 2xx and 409 mean recorded. 408, 429 and 5xx mean retry next cycle. Other 4xx (such as 400 and 404) mean drop, log it and save to rejected.jsonl.
Reason: temporary cloud problems are retried, but a request the cloud says is wrong is never retried forever.

## D-011: How the demo fault works
Context: the demo needs a network problem on cue, so the audience can see SignalBloom detect it, explain it and recover.
Options: restart the agent with a flag; a switch that works while the agent is running; a separate fault simulator.
Choice: --demo-fault starts the agent with the fault on, and creating or deleting a file named demo_fault in data_dir turns it on or off within 30 seconds without a restart. While on, latency rises by 300 ms and packet loss by 20 percentage points (capped at 100). Off by default. When an approved fix succeeds while the demo fault is on, the agent turns the fault off, so the demo shows the network recovering after the fix. A failed fix leaves the fault on.
Reason: the fault can start at the right moment in the demo. Readings carry no demo marker, so the cloud reacts exactly as it would to a real problem.

## D-012: How the health score is calculated
Context: a non-technical office manager needs one number that says whether the network is healthy, but the agent measures several different things.
Options: show each measurement separately; one score with equal weights; one weighted score with an explanation of what's affecting it.
Choice: a score from 0 to 100, calculated from the last 5 minutes (score_window_minutes in the settings table). Five parts, each scored 0 to 100 between a "zero" and a "full marks" limit: internet uptime (weight 30; full at 100%, zero at 90% or less), delay (25; full at 30 ms or less, zero at 200 ms or more), packet loss (20; full at 0%, zero at 10% or more), internet speed (15; full at 100 Mbps or more, zero at 5 Mbps or less), devices online (10; full when all are online, zero at half or fewer). A part with no data is left out and its weight shared among the others. 80 to 100 is "Healthy", 50 to 79 "Needs attention", below 50 "Problem". Weights and limits are stored in the settings table, not in code. These are starting values for the team to confirm.
Reason: an outage hurts a business most, then slowness and lost data, so uptime carries the most weight. The "What's affecting your score" list shows which part is pulling the score down, so the number is never a black box. The window was cut from 15 to 5 minutes after testing showed the score stayed low for about 12 minutes after a fault had cleared, out of step with the alerts.

## D-013: Plain-English labels
Context: the users are not technical.
Choice: the dashboard uses "Internet uptime", "Delay", "Packet loss", "Internet speed" and "Devices online", in sentence case, with the technical term and unit in a tooltip.
Reason: users understand the screen without IT knowledge, while the technical meaning is one hover away.

## D-014: When an alert is raised and cleared
Context: alerts must catch real problems without flooding a non-technical user with noise, the main complaint about competitors such as Auvik.
Options: alert on every bad reading; alert after several bad readings in a row, grouped and auto-resolved.
Choice: delay (warning above 100 ms, critical above 250 ms) and packet loss (warning above 5%, critical above 15%) must stay bad for 3 readings in a row; internet down is critical after 2; a known device offline for more than 2 minutes is a warning. Only one open alert per site, rule and device: repeats raise its count instead of creating new alerts. An alert resolves itself after 3 normal readings. Each reading is evaluated once, and all thresholds are stored in the settings table.
Reason: a single blip never raises an alert, repeats don't pile up, and every alert states its reason with the actual numbers, so the user can see why it fired.

## D-015: Which devices count as new
Context: when an agent first connects, every device on the network is new to SignalBloom, which would flood the Security tab with "New device joined" alerts.
Options: alert on every unknown device; treat the first scan as the starting list.
Choice: devices found in a site's first 10 minutes after the agent registers are marked as known with no alert. After that, each newly seen device raises one "New device joined" warning and is then marked known.
Reason: the alert keeps its value (an unexpected device on an office network is worth knowing about) without a burst of false alarms at setup.

## D-016: Which Gemini model the app uses and what it sees
Context: alert explanations and the AI Assistant need fast, short, plain answers, and every call counts against an API quota separate from the AI Studio plan.
Options: a top model for best quality; a Flash model for speed and cost.
Choice: gemini-3.5-flash-lite, with gemini-3.1-flash-lite as the fallback on 503 or 429, using exact model names (no -latest aliases). Gemini is called only from the backend, so the key never reaches the browser. It receives only a short site summary (score, its parts, open alerts, offline devices, latest readings), never customer names, emails or tokens.
Reason: short explanations don't need a top model, Flash answers fast enough for a live dashboard, and sending only a summary keeps customer data private (Privacy Act 2020) and the answers grounded in facts. On the free tier these allow 500 requests a day each, against 20 for Gemini 3.8 Flash, which ran out during testing.

## D-017: What happens when the AI is unavailable
Context: during testing Gemini returned 503 (high demand), then the free tier's limit of 20 requests a day ran out in minutes because every alert was retried every 15 seconds.
Options: keep retrying; show an error; back off and fall back to a rule-based explanation.
Choice: explanations are generated only when an alert card is shown, then saved and reused (regenerated only if the alert's severity changes). Failed alerts back off (30 s, 1 min, 2 min, 5 min, then every 10 min). While no AI explanation exists, the card shows "Basic explanation (AI unavailable)" built from the alert's own reason. A 402 (no prepaid credits) also shows this fallback. The chat retries once after 3 seconds, then says the assistant is busy.
Reason: the dashboard always explains a problem, even when Gemini is down, and the quota isn't burned by retries.

## D-018: What a site shows before its agent connects
Context: a new site has no data, and a blank dashboard would confuse a non-technical user.
Choice: Network Health and Devices show a "Connect this site" card with three steps and the site's setup code (with a button for a new 24-hour code). Once the agent registers, it shows "Waiting for the first readings" until data arrives.
Reason: onboarding is guided on the screen the user is already looking at, which answers the open onboarding question in SPEC.md.

## D-019: How a user approves a fix
Context: the proposal promises one-click fixes, but users must stay in control (customer choice between manual and approved AI actions) and every automated action must be accountable.
Options: fix automatically; one-click fix without confirmation; offer both a manual choice and an approved fix with confirmation.
Choice: each AI recommendation with a device action shows "I'll do it myself" and "Approve fix". Approving asks for confirmation, then queues a command the agent picks up. The card shows the status (waiting, running, done or didn't work) with the agent's message. Only one pending fix per device and type is allowed. Every approval, manual choice and result is written to the audit log and shown in Account & Settings as an Activity log. Fixes are labelled "Simulated in this prototype".
Reason: the user always decides, nothing runs twice, and the Activity log gives the approval and audit record the proposal's Accountability value calls for.

## D-020: Sign-in and roles
Context: once published, anyone with the link could open the dashboard, and SPEC.md defines Admin and Staff.
Choice: Firebase Auth email and password sign-in. Admin can do everything; Staff sees Network health, Security, Devices and the AI assistant, but can't approve fixes, see billing, manage sites or setup codes, or see the Activity log. Roles are checked in the backend (403) as well as hidden in the interface. The agent keeps using its site token, not a user sign-in.
Reason: least-privilege access, as the proposal's security section asks, without changing how the agent connects.

## D-021: Adding a site
Choice: Admins add a site in Account & Settings, which goes straight to its Connect this site card with a 24-hour setup code. Billing shows sample pricing only.
Reason: a new customer goes from adding a site to live data in a few minutes, on one screen.
