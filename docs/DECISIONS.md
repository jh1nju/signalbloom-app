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
