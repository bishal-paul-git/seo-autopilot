// Unicode / Arabic tokens, normalisation, coverage and slugs. English behaviour must stay exactly as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic, tokens, slugify, stripArabicPrefix } from "../src/lib/text.mjs";
import { makeCovered, tokens as adapterTokens } from "../src/adapters/index.mjs";
import { linkOpportunities } from "../src/audit/links.mjs";

// The tokenizer exactly as it was before this change.
const OLD_STOP = new Set(["ai", "for", "to", "the", "and", "of", "a", "in", "with", "how", "what", "is", "do", "does", "can", "vs", "best", "your", "my", "on", "an", "are", "why"]);
const oldTokens = (q) => String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !OLD_STOP.has(w));
const oldSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";

// Queries taken from the existing test fixtures, plus punctuation and digit edge cases.
const ENGLISH = ["VPS Hosting", "Web Hosting UK", "a", "acme invoices", "acme login", "ai automation agency uk", "ai automation consultant", "ai readiness checklist",
  "big gap", "boiler repair leeds", "chatbot for small business", "cheap hosting", "cheap web hosting", "combi boiler service", "domain names", "erudite consulting",
  "how to move a website to new hosting", "how to set up web hosting", "invoice automation", "pizza recipes", "plumber near me", "ssl certificate", "web hosting for wordpress",
  "automation for plumbing", "dental practice marketing", "What's the best CRM for 2026?", "  spaced   out--query!! ", "", "x-y_z 404 error", "UPPER lower MiXeD"];

test("English tokens() output is identical to the old tokenizer", () => {
  for (const q of ENGLISH) {
    assert.deepEqual(tokens(q), oldTokens(q), q);
    assert.deepEqual(adapterTokens(q), oldTokens(q), q);
  }
});

test("Latin slugs are byte-identical to the old slug", () => {
  for (const t of [...ENGLISH, "How to Choose Web Hosting in 2026 (a complete, practical guide for small businesses on a budget)", "---", "$$$", "A--B", "Ünïcode café"]) {
    assert.equal(slugify(t), oldSlug(t), t);
    assert.equal(slugify(t, { style: "ascii" }), oldSlug(t), t);
  }
});

test("normalizeArabic: marks, tatweel, alef forms, ta marbuta, alef maqsura, hamza carriers, digits", () => {
  assert.equal(normalizeArabic("مُبِيعَات"), "مبيعات");
  assert.equal(normalizeArabic("مدرســـــة"), "مدرسه");
  assert.equal(normalizeArabic("أفضل إعلان آمن ٱلله"), "افضل اعلان امن الله");
  assert.equal(normalizeArabic("مدرسة"), normalizeArabic("مدرسه"));
  assert.equal(normalizeArabic("مستشفى"), "مستشفي");
  assert.equal(normalizeArabic("مؤسسة مسئول"), "موسسه مسيول");
  assert.equal(normalizeArabic("٢٠٢٦ و ۱۲۳"), "2026 و 123");
  assert.equal(normalizeArabic("plain English 123"), "plain English 123");
});

test("Arabic queries produce tokens (everyday searches)", () => {
  assert.deepEqual(tokens("أفضل تطبيقات مدرسة لزيادة المبيعات"), ["تطبيقات", "مدرسه", "زياده", "مبيعات"]);
  assert.deepEqual(tokens("كيف أزيد مبيعات متجري في مدرسة"), ["ازيد", "مبيعات", "متجري", "مدرسه"]);
  assert.deepEqual(tokens("تطبيق نوافذ منبثقة لمتجر ورد"), ["تطبيق", "نوافذ", "منبثقه", "متجر", "ورد"]);
  assert.deepEqual(tokens("أفضل 5 تطبيقات ٢٠٢٦"), ["تطبيقات", "2026"]);
  assert.ok(tokens("مَتْجَر").length === 1);
});

test("tokens keep digits as numbers and mixed Arabic/Latin queries work", () => {
  assert.deepEqual(tokens("تطبيق popup لمتجر مدرسة 2026"), ["تطبيق", "popup", "متجر", "مدرسه", "2026"]);
});

test("alef, ta marbuta and diacritic variants give the same tokens", () => {
  const plain = tokens("أفضل تطبيقات مدرسة لزيادة المبيعات");
  for (const v of ["افضل تطبيقات مدرسه لزياده المبيعات", "إفضل تَطْبِيقَات مَدْرَسَة لِزِيَادَة الْمَبِيعَات", "أفضل تطبيقات مدرســة لزيادة المبيعات"]) assert.deepEqual(tokens(v), plain, v);
});

test("prefix handling needs 3+ letters left and leaves short words alone", () => {
  assert.equal(stripArabicPrefix("المبيعات"), "مبيعات");
  assert.equal(stripArabicPrefix("والمبيعات"), "مبيعات");
  assert.equal(stripArabicPrefix("بالمتجر"), "متجر");
  assert.equal(stripArabicPrefix("للمتجر"), "متجر");
  assert.equal(stripArabicPrefix("لزياده"), "زياده");
  assert.equal(stripArabicPrefix("بيع"), "بيع");     // only 2 letters would remain
  assert.equal(stripArabicPrefix("الان"), "الان");
  assert.equal(stripArabicPrefix("كتاب"), "كتاب");   // ك is not a single-letter prefix
});

test("coverage: Arabic queries were never covered before, now a matching page covers them; unrelated pages do not", () => {
  const page = { text: "تطبيقات مدرسة: دليل أفضل التطبيقات لزيادة المبيعات في متجرك على منصة التعليم" };
  const covered = makeCovered([page]);
  assert.ok(covered("أفضل تطبيقات مدرسة لزيادة المبيعات"));
  assert.ok(covered("افضل تطبيقات مدرسه لزياده المبيعات"));                 // alef / ta marbuta variants
  assert.ok(covered("أَفْضَل تَطْبِيقَات مَدْرَسَة لِزِيَادَة المَبِيعَات")); // with diacritics
  assert.ok(!covered("تطبيق نوافذ منبثقة لمتجر ورد"));
  assert.ok(!makeCovered([{ text: "وصفات البيتزا الإيطالية في المنزل" }])("أفضل تطبيقات مدرسة لزيادة المبيعات"));
  assert.equal(oldTokens("أفضل تطبيقات مدرسة لزيادة المبيعات").length, 0, "the old tokenizer found nothing in this query");
  // A page written with diacritics and tatweel still matches a plain query.
  assert.ok(makeCovered([{ text: "تَطْبِيقَات سَلــة لِزِيَادَة المَبِيعَات" }])("تطبيقات مدرسة زيادة المبيعات"));
  // English still works the same way.
  assert.ok(makeCovered([{ text: "plumbing and hvac automation guide" }])("automation for plumbing"));
});

test("internal link opportunities work for Arabic phrases", () => {
  const mk = (url, h1, text, links = []) => ({ url, status: 200, isHtml: true, inSitemap: true, title: h1, h1s: [h1], text, links: links.map((u) => ({ url: u })) });
  const pages = [mk("https://x.test/apps", "تطبيقات مدرسة", "دليل شامل"), mk("https://x.test/guide", "دليل المتجر", "عند اختيار تَطْبِيقَات مدرسة يجب مقارنة الأسعار")];
  const out = linkOpportunities(pages);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, "https://x.test/apps");
});

test("slugs for Arabic titles are native, non-empty, stable and clean", () => {
  const a = slugify("أفضل تطبيقات مدرسة لزيادة المبيعات");
  assert.equal(a, "أفضل-تطبيقات-مدرسة-لزيادة-المبيعات");
  assert.equal(slugify("أَفْضَل تَطْبِيقَات مَدْرَسَة، لِزِيَادَة المَبِيعَات!"), a);   // diacritics removed, punctuation -> one hyphen
  assert.equal(slugify("  كيف أزيد مبيعات متجري في مدرسة؟  "), "كيف-أزيد-مبيعات-متجري-في-مدرسة");
  assert.equal(slugify("تطبيق نوافذ منبثقة لمتجر ورد"), "تطبيق-نوافذ-منبثقة-لمتجر-ورد");
  assert.equal(slugify("مدرســـــة ٢٠٢٦"), "مدرسة-2026");
  assert.equal(slugify("School apps تطبيقات مدرسة"), "school-apps-تطبيقات-مدرسة");
  assert.equal(slugify("تطبيقات مدرسة"), slugify("تطبيقات مدرسة"));
  assert.equal(slugify("!!!"), "page");
  const long = slugify("تطبيقات مدرسة ".repeat(20));
  assert.ok(long.length <= 60 && !long.endsWith("-") && long.length > 10);
  assert.equal(slugify("Ünïcode café", { style: "unicode" }), "ünïcode-café");
});
