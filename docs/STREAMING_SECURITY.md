# Streaming security (Phase 5 — not implemented)

Nothing in this document is built yet. It records requirements and the design so Phase 5 can
proceed once DNKI selects a provider.

## Requirements

- Protected member-only streams; server checks authenticated account, verified membership,
  paid/accredited registration, active entitlement, no suspension/revocation.
- Short-lived signed playback tokens issued only after the entitlement check; re-checked on refresh.
- Session/device limits, revocation, playback audit events, optional visible watermark.
- No permanent secrets in the browser; no fallback to public video on failure.
- Public Facebook broadcasts are separate content managed under `Admin → Public content` and
  labelled PUBLIC. The platform cannot authenticate Facebook viewers.

## Provider evaluation (to perform)

| Check                                    | Cloudflare Stream | Mux     |
| ---------------------------------------- | ----------------- | ------- |
| Live input + signed playback URLs/tokens | verify            | verify  |
| Token TTL and key rotation               | verify            | verify  |
| Per-viewer limits / concurrent sessions  | verify            | verify  |
| Watermark / overlay options              | verify            | verify  |
| Nigeria/diaspora delivery performance    | measure           | measure |
| Pricing at forecast audience             | quote             | quote   |

## Planned design

Tables `streaming_sessions`, `streaming_entitlements`, `playback_authorization_events`;
endpoint `POST /streams/:id/playback-token` (entitlement check → provider signing key in server
secret manager → token TTL ≤ 5 min); client refreshes through the same endpoint. Unavailable
provider → clearly labelled "stream unavailable" state.
