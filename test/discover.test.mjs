import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverSite, jsonLdNodes, pagesToRead } from "../src/analysis/discover.mjs";
import { scanSite, sitemapFrom } from "../src/hosted/scan.mjs";

const HOME = `<!doctype html><html lang="en-GB"><head><title>Home | Acme Plumbing</title>
<meta name="description" content="Emergency plumbers in Leeds.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"ignored"},{"@type":"Plumber","name":"Acme Plumbing Ltd","telephone":"0113 496 0000","email":"hello@acme.test","logo":"/logo.png","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Leeds","postalCode":"LS1 1AA","addressCountry":"GB"},"openingHours":"Mo-Fr 08:00-18:00","sameAs":["https://www.facebook.com/acmeplumbing"]}]}</script>
</head><body><h1>Plumbers in Leeds</h1>
<a href="mailto:Jobs@Acme.test?subject=hi">Email</a> <a href="tel:+44 113 496 0000">Call</a> <a href="tel:12">bad</a>
<a href="https://instagram.com/acme.plumbing/">IG</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
<a href="/contact/">Contact</a> <a href="/about/">About</a></body></html>`;

test("jsonLdNodes flattens @graph and skips invalid blocks", () => {
  const n = jsonLdNodes(HOME + '<script type="application/ld+json">{broken</script>');
  assert.deepEqual(n.map((x) => x["@type"]).filter((t) => t !== "PostalAddress"), ["WebSite", "Plumber"]);
});

test("discoverSite reads only what the site states, with its source", () => {
  const pages = [
    { url: "https://acme.test/", status: 200, depth: 0, title: "Home | Acme Plumbing", h1s: ["Plumbers in Leeds"], words: 400 },
    { url: "https://acme.test/contact/", status: 200, depth: 1, title: "Contact | Acme Plumbing", h1s: ["Contact us"], words: 100 },
    { url: "https://acme.test/about/", status: 200, depth: 1, title: "About | Acme Plumbing", h1s: ["About Acme"], words: 300 },
    { url: "https://acme.test/gone/", status: 404, depth: 2 },
  ];
  const d = discoverSite({ siteUrl: "https://acme.test/", docs: [{ url: "https://acme.test/", html: HOME }], pages, sitemapUrls: ["a", "b"], robotsTxt: "" });
  assert.equal(d.name.value, "Acme Plumbing Ltd");
  assert.equal(d.logo.value, "https://acme.test/logo.png");
  assert.equal(d.language.value, "en-GB");
  assert.equal(d.description.value, "Emergency plumbers in Leeds.");
  assert.ok(d.businessTypes.includes("Plumber") && !d.businessTypes.includes("WebSite"));
  assert.deepEqual(d.emails.map((e) => e.value), ["hello@acme.test", "jobs@acme.test"]);
  assert.deepEqual(d.phones.map((p) => p.value), ["0113 496 0000", "+44 113 496 0000"]);
  assert.equal(d.addresses[0].value, "1 Main St, Leeds, LS1 1AA, GB");
  assert.equal(d.hours[0].value, "Mo-Fr 08:00-18:00");
  assert.deepEqual(d.socials.map((s) => s.platform).sort(), ["Facebook", "Instagram"]);
  assert.ok(!d.socials.some((s) => /sharer/.test(s.value)), "share buttons are not profiles");
  assert.equal(d.keyPages.contact, "https://acme.test/contact/");
  assert.deepEqual(d.topics.map((t) => t.value), ["Contact us", "About Acme"]);
  assert.deepEqual(d.stats, { pagesRead: 3, pagesFailed: 1, sitemapUrls: 2, robotsTxt: true, avgWords: 267 });
  assert.equal(d.emails[0].source, "https://acme.test/");
});

test("discoverSite falls back to the brand shared by page titles, and invents nothing", () => {
  const d = discoverSite({ siteUrl: "https://x.test/", docs: [{ url: "https://x.test/", html: "<title>Welcome – Brightside Dental</title>" }], pages: [{ title: "Fees – Brightside Dental", status: 200 }, { title: "Team – Brightside Dental", status: 200 }] });
  assert.equal(d.name.value, "Brightside Dental");
  assert.deepEqual([d.emails, d.phones, d.addresses, d.socials], [[], [], [], []]);
  assert.equal(d.logo, null);
});

test("pagesToRead picks home, contact and about", () => {
  assert.deepEqual(pagesToRead("https://a.test/", [{ url: "https://a.test/about-us", status: 200 }, { url: "https://a.test/contact", status: 200 }, { url: "https://a.test/x", status: 200 }]), ["https://a.test/", "https://a.test/contact", "https://a.test/about-us"]);
});

test("sitemapFrom uses robots.txt, else /sitemap.xml", () => {
  assert.equal(sitemapFrom("User-agent: *\nSitemap: https://a.test/sm.xml", "https://a.test/"), "https://a.test/sm.xml");
  assert.equal(sitemapFrom("", "https://a.test/"), "https://a.test/sitemap.xml");
});

test("scanSite builds a portal snapshot from the address alone (offline)", async () => {
  const site = {
    "https://acme.test/robots.txt": ["User-agent: *\nSitemap: https://acme.test/sitemap.xml", "text/plain"],
    "https://acme.test/sitemap.xml": ["<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/contact/</loc></url></urlset>", "application/xml"],
    "https://acme.test/": [HOME, "text/html"],
    "https://acme.test/contact/": ['<html lang="en"><title>Contact | Acme Plumbing</title><h1>Contact us</h1><a href="mailto:office@acme.test">mail</a><a href="/">home</a></html>', "text/html"],
    "https://acme.test/about/": ['<html><title>About | Acme Plumbing</title><h1>About Acme</h1></html>', "text/html"],
  };
  const fetchImpl = async (u, o = {}) => {
    const hit = site[String(u)];
    if (!hit) return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(o.method === "HEAD" ? null : hit[0], { status: 200, headers: { "content-type": hit[1] } });
  };
  const r = await scanSite({ id: "s1", name: "Acme", url: "https://acme.test/" }, { fetchImpl, now: "2026-11-04T00:00:00Z" });
  assert.equal(r.snapshot.site.url, "https://acme.test/");
  assert.equal(r.snapshot.audit.pages, 3);
  assert.ok(r.snapshot.pages.length >= 3);
  assert.equal(r.snapshot.discovered.name.value, "Acme Plumbing Ltd");
  assert.ok(r.snapshot.discovered.emails.some((e) => e.value === "office@acme.test"));
  assert.equal(r.snapshot.source.kind, "url");
  assert.equal(r.snapshot.integrations[0].name, "Website scan");
  await assert.rejects(scanSite({ id: "s2", name: "Down", url: "https://down.test/" }, { fetchImpl }), /could not read/);
});

test("the scan Edge Function bundle copies every module scan.mjs needs", async () => {
  const { readFileSync } = await import("node:fs");
  const { FILES, importsOf } = await import("../cloud/portal/build-scan.mjs");
  const { dirname, join } = await import("node:path");
  for (const f of FILES) for (const i of importsOf(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))) {
    assert.ok(FILES.includes(join(dirname(f), i).replace(/\\/g, "/")), `${f} imports ${i}, missing from build-scan.mjs FILES`);
  }
});

test("searchConsoleRows tries the domain property, then the URL prefix, and gives null when neither is shared", async () => {
  const { searchConsoleRows } = await import("../src/hosted/scan.mjs");
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(decodeURIComponent(String(u)));
    if (String(u).includes("sc-domain")) return new Response(JSON.stringify({ error: { message: "User does not have sufficient permission" } }), { status: 403 });
    return new Response(JSON.stringify({ rows: [{ keys: ["plumber leeds", "https://acme.test/"], clicks: 3, impressions: 90, position: 7.26 }] }), { status: 200 });
  };
  const r = await searchConsoleRows("https://www.acme.test/", "tok", { fetchImpl, now: Date.parse("2026-11-05") });
  assert.equal(r.property, "https://www.acme.test/");
  assert.deepEqual(r.rows[0], { query: "plumber leeds", page: "https://acme.test/", clicks: 3, impressions: 90, position: 7.3 });
  assert.ok(seen[0].includes("sc-domain:acme.test"));
  assert.equal(await searchConsoleRows("https://x.test/", "tok", { fetchImpl: async () => new Response("{}", { status: 403 }) }), null);
});

test("brand: declared theme colour is stated; CSS variables and fonts are inferred; unsafe values never kept (D39)", async () => {
  const { brandOf, discoverSite } = await import("../src/analysis/discover.mjs");
  const html = `<html><head><meta name="theme-color" content="#0A7A4B">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&amp;family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <style>:root{--brand-primary:#0a7a4b;--color-accent: #F5A623;--text:#111;--primary-x:#12345;--secondary:url(javascript:alert(1))}
      body{font-family:"Inter",system-ui,sans-serif} h1{font-family: 'Playfair Display', serif} h2{font-family:"<script>x</script>"}</style></head>
    <body><div style="--brand-dark:#003322"></div></body></html>`;
  const b = brandOf(html, "https://plumber.test/");
  assert.deepEqual(b.themeColor, { value: "#0a7a4b", source: "https://plumber.test/", basis: "stated" });
  assert.deepEqual(b.colors.map((c) => [c.name, c.value, c.basis]), [["brand-primary", "#0a7a4b", "inferred"], ["color-accent", "#f5a623", "inferred"], ["brand-dark", "#003322", "inferred"]]);
  assert.deepEqual(b.fonts.map((f) => f.value), ["Playfair Display", "Inter"]);
  assert.ok(b.fonts.every((f) => f.basis === "inferred"));
  const none = brandOf(`<meta name="theme-color" content="red;background:url(x)"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto}</style>`, "u");
  assert.deepEqual(none, { themeColor: null, colors: [], fonts: [] }, "only hex colours and real font names; generic stacks dropped");
  const d = discoverSite({ siteUrl: "https://plumber.test/", docs: [{ url: "https://plumber.test/", html }] });
  assert.equal(d.brand.themeColor.value, "#0a7a4b", "part of discovery");
});

test("brand reaches the dossier and site memory as brand facts with their basis", async () => {
  const { buildDossier, dossierMemory } = await import("../src/god/onboarding.mjs");
  const discovered = { brand: { themeColor: { value: "#0a7a4b", source: "https://p.test/" }, colors: [{ value: "#f5a623", source: "https://p.test/" }], fonts: [{ value: "Inter", source: "https://p.test/" }] } };
  const dossier = buildDossier({ site: { url: "https://p.test/", name: "P" }, discovered });
  const mem = dossierMemory(dossier).filter((m) => m.kind === "brand");
  assert.deepEqual(mem.map((m) => [m.key, m.value.value, m.basis]), [["theme_color", "#0a7a4b", "stated"], ["brand_color", "#f5a623", "inferred"], ["brand_font", "Inter", "inferred"]]);
});
