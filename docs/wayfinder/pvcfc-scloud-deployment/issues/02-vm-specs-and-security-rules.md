# Decide VM OS, specs, and security group rules for the backend

## Question

What OS and instance size should the SCloud VM run, and which ports must be open in the Security Rules?

## Type

`wayfinder:grilling` (HITL)

## Status

## Resolution

The original UHost sizing decision is **superseded for the demo** by the cheaper ULightHost deployment.

- **Current product:** SCloud ULightHost / Simple Application Server
- **Region:** VN(Ho Chi Minh City), Zone A
- **Instance:** 1 vCPU / 2 GB RAM / 40 GB system disk
- **Public network:** bundled 30 Mbps peak bandwidth and 400 GB traffic package
- **Public IP:** ULightHost `165.154.229.65`
- **Firewall:** web-service recommendation bound to the host; TCP 22, 80, 443, ICMP, and TCP 3389
- **Monthly cost:** `$7.22/month`

The existing UHost plan (Ubuntu 22.04, 2 vCPU / 4 GB, separate EIP) remains a future migration option, not the current demo host. The existing EIP `165.154.229.126` remains unbound.

**SCloud console evidence 2026-08-07:** ULightHost resource `ulhost-1tregne0qp7u` is Running with the configuration above.
