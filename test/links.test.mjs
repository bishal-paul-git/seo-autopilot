// Brief 01 item 6: internal links to add for weakly linked pages, from the saved link graph. Report only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relatedLinks } from "../src/audit/links.mjs";

const S = "https://s.test";
const pg = (path, title, links = [], inbound = 5) => ({ url: `${S}${path}`, finalUrl: `${S}${path}`, status: 200, inSitemap: true, title, h1: title, inbound, links: links.map((l) => `${S}${l}`) });

test("weakly linked pages get mention, reverse and sibling suggestions, weakest first, never one that already exists", () => {
  const pages = [
    pg("/", "Home", ["/guides/invoice-reminders"]),
    pg("/guides/invoice-reminders", "Invoice reminder emails that get paid", ["/services/invoicing"], 1),
    pg("/services/invoicing", "Invoicing automation for small firms", [], 4),
    pg("/guides/invoice-templates", "Invoice email templates for late payers", ["/guides/invoice-reminders"]),
    pg("/guides/late-payment", "Chasing late payment by email", [], 0),
    pg("/blog/news", "Company news", []),
  ];
  const mentions = [{ to: `${S}/guides/late-payment`, from: `${S}/blog/news`, anchor: "late payment", context: "how we handle late payment now" }];
  const out = relatedLinks(pages, mentions);
  assert.deepEqual(out.map((o) => [o.to.replace(S, ""), o.from.replace(S, ""), o.reason]), [
    ["/guides/late-payment", "/blog/news", "mention"],
    ["/guides/late-payment", "/guides/invoice-templates", "sibling"],
    ["/guides/invoice-reminders", "/services/invoicing", "reverse"],
  ]);
  assert.match(out[2].evidence, /links to it; shared topic: invoicing/);
  assert.ok(!out.some((o) => o.from === `${S}/guides/invoice-templates` && o.to === `${S}/guides/invoice-reminders`), "already linked: not suggested");
});

test("same-section siblings need two shared title words; well-linked pages get nothing", () => {
  const pages = [
    pg("/guides/ai-call-answering-plumbers", "AI call answering for plumbers", [], 0),
    pg("/guides/ai-call-answering-dentists", "AI call answering for dentists", []),
    pg("/guides/ai-pricing", "AI pricing explained", []),
    pg("/services/call-answering", "Call answering service", [], 0),
  ];
  const out = relatedLinks(pages, []);
  assert.deepEqual(out.map((o) => [o.to.replace(S, ""), o.from.replace(S, ""), o.reason]), [["/guides/ai-call-answering-plumbers", "/guides/ai-call-answering-dentists", "sibling"]]);
  assert.deepEqual(relatedLinks(pages, [], { maxInbound: -1 }), []);
});

test("links job: reads audit.json, skips an old audit without a link graph, writes links.json and links.md", async () => {
  const { run } = await import("../src/jobs/links.mjs");
  const state = mkdtempSync(join(tmpdir(), "seo-links-"));
  const site = { id: "s", name: "S", url: `${S}/`, paths: { state } };
  const log = console.log; console.log = () => {};
  try {
    writeFileSync(join(state, "audit.json"), JSON.stringify({ pages: [{ url: `${S}/a`, status: 200, title: "A" }] }));
    await run({ site, flags: {} });
    writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "2026-10-18T00:00:00Z", opportunities: [], pages: [pg("/guides/x-y-z", "Widget repair guide", ["/services/widget-repair"], 0), pg("/services/widget-repair", "Widget repair service", [])] }));
    await run({ site, flags: {} });
  } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "links.json"), "utf8"));
  assert.equal(r.items.length, 1);
  assert.match(readFileSync(join(state, "links.md"), "utf8"), /On \/services\/widget-repair, link to \/guides\/x-y-z \(0 inbound\) as "Widget repair guide"\. Why: reverse/);
});
