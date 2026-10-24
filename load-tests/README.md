# Load tests (k6)

Not yet executed. Phase 7 requires a staging environment sized like production and an
agreed peak-concurrency forecast from DNKI (see docs/TEST_PLAN.md).

```bash
# Gate scanning: N staff sessions scanning pre-issued synthetic passes across gates
k6 run -e BASE=https://staging.example.invalid -e SESSIONS=sessions.json -e TOKENS=tokens.json load-tests/scan.js

# Public event page + read path
k6 run -e BASE=https://staging.example.invalid load-tests/public.js
```

`sessions.json` / `tokens.json` are produced against STAGING ONLY with synthetic data. Never run
against production. Record throughput, p95/p99, error rate, DB CPU/connections and bottlenecks in
docs/TEST_PLAN.md.
