#!/usr/bin/env node
// After an upstream Engine update: does every Engine route the Mari shell calls still exist?
// Run against a started Engine whose data can be thrown away (requests carry dummy ids and empty bodies):
//
//   node custom-modules/scripts/check-engine-api.mjs [http://127.0.0.1:7860]
//
// A route that is gone answers Fastify's bare {"error":"Not Found"}; any other answer (a 404 for the dummy id,
// a 400 for the empty body, a 200) means the route is still there.

import { readFile } from "node:fs/promises";

const base = (process.argv[2] || process.env.ENGINE_URL || "http://127.0.0.1:7860").replace(/\/$/, "");
const list = JSON.parse(await readFile(new URL("../mari-kit/shell/engine-api.json", import.meta.url), "utf8"));
const missing = [];
for (const route of list.routes) {
  const [method, path] = route.split(" ");
  const url = `${base}/api${path.replaceAll(":id", "mari-kit-probe")}`;
  const body = method === "GET" ? undefined : "{}";
  const res = await fetch(url, {
    method,
    headers: { "x-marinara-csrf": "1", ...(body ? { "content-type": "application/json" } : {}) },
    body,
  });
  const text = await res.text();
  if (res.status === 404 && /^\{"error":"Not Found"\}$|Route .* not found/.test(text.trim())) missing.push(route);
}
if (missing.length) {
  console.error(`Mari shell: ${missing.length} Engine route(s) gone after the update:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`OK Mari shell: all ${list.routes.length} Engine routes it calls are still there`);
