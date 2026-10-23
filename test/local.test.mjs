// Local pack data: name, address and phone consistency, LocalBusiness markup completeness, thin and swapped-town location
// pages, the owner's confirmed details, routing to the pack agents, and the job run against a fake site.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phoneKey, addressKey, phonesOnPage, pageFacts, analyseLocal, localMarkdown } from "../src/analysis/local.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { run } from "../src/jobs/local.mjs";

const biz = (extra = {}) => ({ "@type": "Dentist", name: "Example Dental", telephone: "+44 20 7946 0000", address: { "@type": "PostalAddress", streetAddress: "1 High St", addressLocality: "Leeds", postalCode: "LS1 1AA" }, openingHours: "Mo-Fr 09:00-17:00", geo: { latitude: 1, longitude: 2 }, ...extra });
const SERVICES = ["check-ups", "hygiene visits", "fillings", "crowns", "bridges", "veneers", "whitening", "implants", "dentures", "root canal treatment", "children's dentistry", "emergency appointments", "mouth guards", "orthodontic advice", "gum care"];
const body = (town, extra = "") => `We are a family dental practice in ${town}. ` + SERVICES.map((s, i) => `Our ${s} service runs on weekday ${i % 2 ? "mornings" : "afternoons"} and the team explains every step, the likely cost and the aftercare before treatment starts.`).join(" ") + ` Visit us in ${town}. ${extra}`;
const words = (t) => t.split(/\s+/).length;

test("keys: phones compare by digits across formats and prefixes; addresses by normalised text", () => {
  assert.equal(phoneKey("+44 20 7946 0000"), phoneKey("020 7946 0000"));
  assert.equal(phoneKey("(020) 7946-0000"), "079460000");
  assert.equal(phoneKey("+1 (212) 555-0100"), phoneKey("212.555.0100"));
  assert.equal(phoneKey("12"), "", "too short to be a phone");
  assert.equal(addressKey({ streetAddress: "1 High St.", addressLocality: "Leeds" }), addressKey("1 high street, leeds"));
  assert.deepEqual(phonesOnPage('<a href="tel:+442079460000">Call</a>', "Or ring 0113 496 0000 today").map(phoneKey).sort(), ["079460000", "134960000"]);
});

test("consistency: one stray phone number and a second address form are found, with the pages that carry them", () => {
  const pages = [
    pageFacts({ url: "https://d.test/", nodes: [biz()], text: "Call +44 20 7946 0000", words: 400 }),
    pageFacts({ url: "https://d.test/contact", nodes: [biz({ address: "1 High Street, Leeds, LS1 1AA" })], text: "Call 020 7946 0000", words: 200 }),
    pageFacts({ url: "https://d.test/about", nodes: [], html: '<a href="tel:01134960000">old number</a>', text: "", words: 300 }),
  ];
  const r = analyseLocal(pages);
  const phone = r.findings.find((f) => f.id === "phone-variants");
  assert.equal(phone.severity, "high"); assert.deepEqual(phone.pages, ["https://d.test/about"]);
  assert.ok(!r.findings.some((f) => f.id === "address-variants"), "the same address written two ways is one address");
  assert.ok(!r.findings.some((f) => f.id === "markup-incomplete"));
  assert.deepEqual(r.nap.phones.map((p) => p.pages), [2, 1]);
});

test("owner's confirmed details: a site that never shows the confirmed phone is flagged", () => {
  const r = analyseLocal([pageFacts({ url: "https://d.test/", nodes: [biz()], words: 400 })], { owner: { phone: "0113 496 0000" } });
  assert.ok(r.findings.some((f) => f.id === "phone-not-owner" && f.severity === "high"));
  assert.ok(!analyseLocal([pageFacts({ url: "https://d.test/", nodes: [biz()], words: 400 })], { owner: { phone: "020 7946 0000" } }).findings.some((f) => f.id === "phone-not-owner"));
});

test("markup: none at all, or blocks missing recommended fields", () => {
  assert.equal(analyseLocal([pageFacts({ url: "https://d.test/", nodes: [{ "@type": "WebSite" }], words: 300 })]).findings[0].id, "no-local-markup");
  const r = analyseLocal([pageFacts({ url: "https://d.test/", nodes: [biz({ geo: undefined, openingHours: undefined })], words: 300 })]);
  assert.match(r.findings.find((f) => f.id === "markup-incomplete").detail, /missing hours, geo/);
});

test("location pages: swapped-town templates are near-duplicates; real local substance is not; thin pages and pages with no facts flagged", () => {
  const leeds = body("Leeds"), york = body("York"), hull = body("Hull", "Our Hull clinic is on the harbour, with step-free access, parking behind the building, a children's corner and evening appointments on Thursdays. ".repeat(10));
  const pages = [
    pageFacts({ url: "https://d.test/", nodes: [biz()], words: 400, text: "Home" }),
    pageFacts({ url: "https://d.test/locations/leeds", nodes: [biz()], text: leeds, words: words(leeds) }),
    pageFacts({ url: "https://d.test/locations/york", nodes: [], html: "", text: york, words: words(york) }),
    pageFacts({ url: "https://d.test/locations/hull", nodes: [biz()], html: '<iframe src="https://www.google.com/maps/embed?x"></iframe>', text: hull, words: words(hull) }),
    pageFacts({ url: "https://d.test/areas/selby", nodes: [], text: "We also cover Selby.", words: 4 }),
  ];
  const r = analyseLocal(pages);
  assert.equal(r.locationPages, 4);
  const dup = r.findings.find((f) => f.id === "location-duplicates");
  assert.equal(dup.severity, "high"); assert.deepEqual(r.duplicates.map((d) => [d.a, d.b]), [["https://d.test/locations/leeds", "https://d.test/locations/york"]]);
  assert.deepEqual(r.findings.find((f) => f.id === "location-thin").pages, ["https://d.test/areas/selby"]);
  assert.deepEqual(r.findings.find((f) => f.id === "location-no-facts").pages, ["https://d.test/locations/york", "https://d.test/areas/selby"]);
  assert.match(localMarkdown({ siteName: "D", result: r }), /HIGH: 1 pair\(s\) of location pages are near-identical/);
});

test("branches: one address per location page is not an inconsistency", () => {
  const branch = (town, phone) => pageFacts({ url: `https://d.test/locations/${town.toLowerCase()}`, nodes: [biz({ telephone: phone, address: `1 Main Road, ${town}` })], words: 500, text: body(town) + town.repeat(50) });
  const r = analyseLocal([branch("Leeds", "0113 496 0000"), branch("York", "01904 496 000")]);
  assert.equal(r.nap.multiLocation, true);
  assert.ok(!r.findings.some((f) => f.id === "address-variants" || f.id === "phone-variants"));
});

test("routing: phone and address problems go to the citation auditor, location pages to the local content writer, with targets", () => {
  const local = { findings: [{ id: "phone-variants", severity: "high", title: "2 phones", pages: ["https://d.test/about"] }, { id: "location-duplicates", severity: "high", title: "1 pair", pages: ["https://d.test/locations/leeds", "https://d.test/locations/york"] }] };
  const steps = routeAgents({ profile: { mode: "edit", signals: { structuredData: ["Dentist"] } }, local }).steps;
  const cit = steps.find((s) => s.agent === "seo-local-citation-auditor"), writer = steps.find((s) => s.agent === "seo-local-content-writer");
  assert.match(cit.why, /business name, address or phone/); assert.deepEqual(cit.targets, ["/about"]);
  assert.deepEqual(writer.targets, ["/locations/leeds", "/locations/york"]);
});

test("job: skips sites the local pack does not apply to; checks home, contact and location pages of a local site", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-local-")), state = join(root, "state"); mkdirSync(state, { recursive: true });
  const site = { id: "d", name: "D", url: "https://d.test/", paths: { state, root, data: root } };
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {} }, { fetch: async () => { throw new Error("must not fetch"); }, delayMs: 0 });
    assert.match(JSON.parse(readFileSync(join(state, "local.json"), "utf8")).skipped, /not a local business/);
    writeFileSync(join(state, "audit.json"), JSON.stringify({ pages: ["https://d.test/", "https://d.test/contact", "https://d.test/locations/leeds", "https://d.test/blog/x"].map((url) => ({ url, status: 200 })) }));
    const html = (inner, ld) => `<html><body><main>${inner}</main><script type="application/ld+json">${JSON.stringify(ld)}</script></body></html>`;
    const pagesHtml = { "/": html("<p>Welcome</p>", biz()), "/contact": html('<p>Ring <a href="tel:01134960000">0113 496 0000</a></p>', biz()), "/locations/leeds": html(`<p>${body("Leeds")}</p>`, biz()) };
    const fetched = [];
    const f = async (u) => { const p = new URL(u).pathname; fetched.push(p); if (p === "/robots.txt") return new Response("", { status: 404 }); return pagesHtml[p] ? new Response(pagesHtml[p], { headers: { "content-type": "text/html" } }) : new Response("no", { status: 404 }); };
    await run({ site: { ...site, verticals: ["local"] }, flags: {} }, { fetch: f, delayMs: 0 });
    const out = JSON.parse(readFileSync(join(state, "local.json"), "utf8"));
    assert.ok(!fetched.includes("/blog/x"), "only home, contact and location pages");
    assert.equal(out.checked, 3); assert.equal(out.locationPages, 1);
    assert.ok(out.findings.some((x) => x.id === "phone-variants"), "the contact page's other number is found");
    assert.ok(!("text" in out.pages[0]), "page text is not stored");
    assert.match(readFileSync(join(state, "local.md"), "utf8"), /## Name, address, phone as the site shows them/);
  } finally { console.log = log; }
});
