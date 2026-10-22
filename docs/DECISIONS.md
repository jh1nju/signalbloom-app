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

## D-005: When a device counts as online
Context: Windows PCs block ping by default, but ARP table entries can stay for minutes after a device leaves.
Options: ping only; ping or ARP; ping for devices that answer it, ARP for devices that never do.
Choice: devices that have ever answered ping are judged by ping, and go offline after 2 missed checks in a row. Devices that never answer ping use the ARP table.
Reason: avoids false "offline" alerts for firewalled PCs (reducing alert fatigue is a core goal in the proposal), while devices that answer ping still show offline quickly.
