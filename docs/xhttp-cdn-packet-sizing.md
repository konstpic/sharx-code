# XHTTP packet uploads through a CDN

With `uplinkDataPlacement: "header"`, `uplinkChunkSize` limits each payload
header, while `scMaxEachPostBytes` limits the entire packet upload request.
Small header chunks alone cannot prevent a large request from exceeding a CDN
or origin header limit.

Sharx exports `scMaxEachPostBytes` into the subscription link's `extra` JSON,
alongside `uplinkChunkSize` and `scMinPostsIntervalMs`. Numeric values and
string ranges are preserved. Empty and zero values retain the core defaults.
Clients must refresh their subscription to receive a changed packet limit.

A tested starting point for GET/OPTIONS packet uploads carrying data in
headers is an 8192-byte packet, 4096-byte header chunks and a 2 ms minimum
interval. Validate these against the actual CDN and client core; they are
not universal provider limits.

Keep the receiving server's packet limit at least as large as every supported
client's limit. During a migration, an older cached subscription may still
send larger packets. Separate subscription-source and receiving inbounds can
retain a larger server limit while issuing smaller packets to refreshed
clients. Restore the original server settings before rolling traffic back to
an old origin whose limit was lowered.
