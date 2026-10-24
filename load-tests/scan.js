import { check } from "k6";
import { SharedArray } from "k6/data";
import http from "k6/http";

// Provisional target from the specification: online QR validation p95 < 300 ms.
export const options = {
  scenarios: {
    gates: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE ?? 50),
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 100,
    },
  },
  thresholds: { "http_req_duration{name:scan}": ["p(95)<300"], http_req_failed: ["rate<0.01"] },
};

const sessions = new SharedArray("sessions", () => JSON.parse(open(__ENV.SESSIONS))); // [{cookie, gateId, deviceId}]
const tokens = new SharedArray("tokens", () => JSON.parse(open(__ENV.TOKENS))); // ["DNKI1.…"]

export default function () {
  const s = sessions[__VU % sessions.length];
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  const res = http.post(`${__ENV.BASE}/api/v1/scanner/scan`, JSON.stringify({ token, gateId: s.gateId, deviceId: s.deviceId }), {
    headers: { "content-type": "application/json", "x-dnki-csrf": "1", cookie: s.cookie },
    tags: { name: "scan" },
  });
  check(res, { decided: (r) => r.status === 200 && ["VALID_ADMIT", "ALREADY_CHECKED_IN"].includes(r.json("result")) });
}
