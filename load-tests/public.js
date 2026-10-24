import { check } from "k6";
import http from "k6/http";

export const options = {
  stages: [
    { duration: "1m", target: 200 },
    { duration: "3m", target: 200 },
    { duration: "1m", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<500"], http_req_failed: ["rate<0.01"] },
};

export default function () {
  check(http.get(`${__ENV.BASE}/api/v1/public/event`), { ok: (r) => r.status === 200 });
}
