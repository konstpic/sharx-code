# Network tests

Public tests cover the client, wire protocol, witness primitives and node QoS.
Run `go test -race ./network/... ./node/qos/...`.

The coordinator, PostgreSQL migrations, ledger and full two-panel integration
stand live in the private repository:
https://gitlab.sharxconnect.app/kpichugin/sharx-coordinator

The kernel test image/scripts in this directory remain public. Full integration
tests require both checkouts; no private coordinator source should be copied here.
