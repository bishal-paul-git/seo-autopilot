// Email (D40): the notify function's core with fake Supabase, Auth invite and SMTP. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runNotify, composeSummary, itemLink } from "../cloud/portal/supabase/functions/notify/core.mjs";

const PORTAL = "https://seo.example.test/";
const queue = () => ({
  invites: [{ kind: "agency", id: "org-1:new@a.test", email: "new@a.test", agency: "Agency A" }, { kind: "client", id: "7", email: "boss@c.test", agency: "Agency A" }, { kind: "agency", id: "org-1:taken@a.test", email: "taken@a.test" }, { kind: "agency", id: "org-1:bad@a.test", email: "bad@a.test" }],
  summaries: [{ user_id: "u1", email: "alice@a.test", items: [{ kind: "approval", siteName: "Plumber", title: '<img src=x onerror="alert(1)">Fix titles', site: "s1", page: "god", at: "2026-11-08T10:00:00Z" }, { kind: "answer", siteName: "Plumber", title: "Rank for boilers · accepted", site: "s1", page: "requests" }] }, { user_id: "u2", email: "none@a.test", items: [] }],
});
function fakes({ smtp = true } = {}) {
  const sent = [], marked = [], invited = [];
  const rpc = async (fn, args) => { if (fn === "email_queue") return queue(); if (fn === "email_sent") { marked.push(args); return null; } throw new Error(fn); };
  const invite = async (email, o) => { invited.push({ email, ...o }); if (email === "taken@a.test") return { alreadyRegistered: true }; if (email === "bad@a.test") return { error: "HTTP 429 rate limited" }; return { ok: true }; };
  const sendMail = smtp ? async (m) => { sent.push(m); } : null;
  return { rpc, invite, sendMail, sent, marked, invited };
}

test("invites go through Supabase Auth once each; already-registered addresses are recorded, failures retried later", async () => {
  const f = fakes();
  const r = await runNotify({ rpc: f.rpc, invite: f.invite, sendMail: f.sendMail, portalUrl: PORTAL });
  assert.equal(r.invited, 2);
  assert.deepEqual(f.invited.map((x) => x.email), ["new@a.test", "boss@c.test", "taken@a.test", "bad@a.test"]);
  assert.ok(f.invited.every((x) => x.redirectTo === PORTAL));
  const inv = f.marked.filter((m) => m.p_kind !== "summary").map((m) => m.p_id);
  assert.deepEqual(inv, ["org-1:new@a.test", "7", "org-1:taken@a.test"], "the failed one stays queued");
  assert.ok(r.errors.some((e) => /429/.test(e)));
});

test("summaries: one email per person with items, escaped, linking to the right page; marked as sent", async () => {
  const f = fakes();
  const r = await runNotify({ rpc: f.rpc, invite: f.invite, sendMail: f.sendMail, portalUrl: PORTAL });
  assert.equal(r.summaries, 1);
  assert.equal(f.sent.length, 1, "nobody without items is emailed");
  const m = f.sent[0];
  assert.equal(m.to, "alice@a.test");
  assert.equal(m.subject, "SEO Autopilot: 2 things need your attention");
  assert.ok(!m.html.includes("<img"), "stored text escaped in HTML");
  assert.ok(m.html.includes("&lt;img") && m.text.includes("#/s/s1/god") && m.text.includes("#/k/s1/requests"));
  assert.deepEqual(f.marked.find((x) => x.p_kind === "summary"), { p_kind: "summary", p_id: "u1" });
});

test("without SMTP secrets: invites still go out; summaries are skipped with the reason, nothing marked", async () => {
  const f = fakes({ smtp: false });
  const r = await runNotify({ rpc: f.rpc, invite: f.invite, sendMail: null, portalUrl: PORTAL });
  assert.equal(r.invited, 2); assert.equal(r.summaries, 0); assert.equal(r.skippedSummaries, 1);
  assert.ok(r.errors.some((e) => /SMTP_/.test(e)));
  assert.ok(!f.marked.some((x) => x.p_kind === "summary"));
});

test("links and wording", () => {
  assert.equal(itemLink("https://p.test/#/x", { kind: "approval", site: "a b", page: "god" }), "https://p.test/#/s/a%20b/god");
  assert.equal(composeSummary([{ kind: "stuck", siteName: "S", title: "t" }], PORTAL).subject, "SEO Autopilot: 1 thing needs your attention");
});
