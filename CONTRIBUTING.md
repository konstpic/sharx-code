## Local Development Setup

- Create a directory named `x-ui` in the project root 
- Rename `.env.example` to `.env `
- Run `main.go`
## Checks that gate a release

A tag push (`harbor-release.yml`) first runs `go test ./...`, `govulncheck` and `npm audit` (`go-tests.yml`); if any of them fails nothing is built. Each image (sharx, sharxnode, sharxbalancer) is then built locally and scanned with Trivy (`.github/actions/trivy-scan`) **before** it is pushed to Harbor:

- fixable HIGH and CRITICAL findings in our own binaries and the OS packages block the release;
- fixable CRITICAL findings anywhere in the image block it too;
- HIGH findings in the third-party binaries bundled under `bin/` (Xray, Telemt, AmneziaWG) are only reported: they belong to their upstreams and the fix is a new upstream release.

The same scan runs every Monday and on demand (`image-scan.yml`, "Run workflow"), because new CVEs appear for images that are already released. An exception for a finding we accept goes into `.trivyignore` with the reason and a date; it is the owner's decision.
