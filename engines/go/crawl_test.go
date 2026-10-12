package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const sample = `<!doctype html><html lang="en"><head>
<title>My &amp; Title</title>
<meta name="description" content="A page about widgets and how to pick one.">
<meta name="robots" content="NoIndex,Follow">
<meta name="viewport" content="width=device-width">
<meta property="og:title" content="OG title">
<link rel="canonical" href="/page">
<link rel="alternate" hreflang="fr" href="/fr/page">
<script type="application/ld+json">{"@graph":[{"@type":"Article","headline":"H","datePublished":"2026-01-01"},{"@type":"Organization","name":"Org","sameAs":[]}]}</script>
<script type="application/ld+json">{ broken json </script>
</head><body>
<h1>Main heading</h1><h2>Second</h2>
<p>Hello <b>world</b> and some more words here.</p>
<a href="/next">Next page</a> <a href="https://other.test/x" rel="nofollow noopener">Other</a>
<a href="mailto:a@b.c">mail</a> <a href="#top">top</a>
<img src="a.png" alt="x"><img src="b.png"><img src="http://insecure.test/c.png" alt="">
<script>var hidden = "not visible text";</script></body></html>`

func TestExtractPage(t *testing.T) {
	x := extractPage(sample, "https://s.test/page")
	if x.Title != "My & Title" {
		t.Fatalf("title %q", x.Title)
	}
	if x.Canonical == nil || *x.Canonical != "https://s.test/page" {
		t.Fatalf("canonical %v", x.Canonical)
	}
	if x.Robots != "noindex,follow" {
		t.Fatalf("robots %q", x.Robots)
	}
	if len(x.H1s) != 1 || x.H1s[0] != "Main heading" || len(x.H2s) != 1 {
		t.Fatalf("headings %v %v", x.H1s, x.H2s)
	}
	if x.Lang == nil || *x.Lang != "en" {
		t.Fatalf("lang %v", x.Lang)
	}
	if x.JSONLD.Invalid != 1 || x.JSONLD.Blocks != 2 {
		t.Fatalf("jsonld counts %+v", x.JSONLD)
	}
	if len(x.JSONLD.Types) != 2 {
		t.Fatalf("types %v", x.JSONLD.Types)
	}
	if f := x.JSONLD.ArticleFields; f == nil || !f["headline"] || !f["datePublished"] || f["author"] || f["image"] {
		t.Fatalf("article fields %v", x.JSONLD.ArticleFields)
	}
	for _, n := range x.JSONLD.Nodes {
		if n.Type == "Organization" {
			for _, p := range n.Props {
				if p == "sameAs" {
					t.Fatalf("an empty array must not count as a property: %v", n.Props)
				}
			}
		}
	}
	if len(x.Alternates) != 1 || x.Alternates[0].Href != "https://s.test/fr/page" {
		t.Fatalf("alternates %v", x.Alternates)
	}
	if len(x.Links) != 2 || x.Links[0].URL != "https://s.test/next" || !x.Links[1].Nofollow {
		t.Fatalf("links %+v", x.Links)
	}
	if x.Images != 3 || x.ImagesNoAlt != 1 {
		t.Fatalf("images %d %d", x.Images, x.ImagesNoAlt)
	}
	if len(x.Mixed) != 1 || x.Mixed[0] != "http://insecure.test/c.png" {
		t.Fatalf("mixed %v", x.Mixed)
	}
	if strings.Contains(x.Text, "not visible") {
		t.Fatalf("script text leaked: %q", x.Text)
	}
	if x.OG.Title == nil || *x.OG.Title != "OG title" || x.OG.Image != nil {
		t.Fatalf("og %+v", x.OG)
	}
	if x.Description == nil || x.Viewport == nil || x.Words < 8 || len(x.TextHash) != 40 {
		t.Fatalf("misc %+v", x)
	}
}

func TestVisibleTextKeepsHeaderButDropsHead(t *testing.T) {
	got := visibleText("<html><head><title>T</title></head><body><header>Site name</header><p>Hi <b>there</b></p><style>a{}</style></body></html>")
	if got != "Site name Hi there" {
		t.Fatalf("got %q", got)
	}
}

func page(title, body string) string {
	return fmt.Sprintf(`<html lang="en"><head><title>%s</title><meta name="description" content="%s"><link rel="canonical" href="x"></head><body><h1>%s</h1>%s</body></html>`, title, strings.Repeat("d", 100), title, body)
}

func TestCrawlSmallSite(t *testing.T) {
	var base string
	mux := http.NewServeMux()
	mux.HandleFunc("/sitemap.xml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		fmt.Fprintf(w, `<urlset><url><loc>%s/</loc></url><url><loc>%s/a</loc></url><url><loc>%s/old</loc></url></urlset>`, base, base, base)
	})
	mux.HandleFunc("/robots.txt", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "User-agent: *\nAllow: /\n")
	})
	html := func(s string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, s)
		}
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(404)
			fmt.Fprint(w, "gone")
			return
		}
		html(page("Home", `<a href="/a">A</a> <a href="/discovered">D</a> <a href="/missing">M</a> <a href="/file.pdf">pdf</a>`))(w, r)
	})
	mux.HandleFunc("/a", html(page("Page A", `<a href="/">home</a>`)))
	mux.HandleFunc("/discovered", html(page("Discovered", `<a href="/">home</a>`)))
	mux.HandleFunc("/old", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/mid", http.StatusMovedPermanently) })
	mux.HandleFunc("/mid", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/new", http.StatusFound) })
	mux.HandleFunc("/new", html(page("New", "")))
	srv := httptest.NewServer(mux)
	defer srv.Close()
	base = srv.URL

	out, err := crawl(Config{SiteURL: base + "/", SitemapURL: base + "/sitemap.xml", MaxPages: 50, Concurrency: 4, Delay: 0, Timeout: 5 * time.Second, Rounds: 3, Probe: 20, UserAgent: "test"})
	if err != nil {
		t.Fatal(err)
	}
	byURL := map[string]Page{}
	for _, p := range out.Pages {
		byURL[strings.TrimSuffix(p.URL, "/")] = p
	}
	if len(out.SitemapURLs) != 3 || out.RobotsTxt == nil {
		t.Fatalf("sitemap/robots: %v %v", out.SitemapURLs, out.RobotsTxt)
	}
	if _, ok := byURL[base+"/discovered"]; !ok {
		t.Fatalf("a page found only by following links was not crawled: %v", keys(byURL))
	}
	if p := byURL[base+"/a"]; p.Status != 200 || !p.InSitemap || p.Title != "Page A" || p.TTFB < 0 {
		t.Fatalf("page a: %+v", p)
	}
	old := byURL[base+"/old"]
	if old.Status != 200 || len(old.Chain) != 2 || !strings.HasSuffix(old.FinalURL, "/new") {
		t.Fatalf("redirect chain: status %d chain %v final %s", old.Status, old.Chain, old.FinalURL)
	}
	if _, ok := byURL[base+"/file.pdf"]; ok {
		t.Fatal("asset links must not be crawled")
	}
	if st, ok := out.BrokenTargets[base+"/missing"]; !ok || st != 404 {
		t.Fatalf("broken target not reported: %v", out.BrokenTargets)
	}
	if len(out.BrokenTargets) != 1 {
		t.Fatalf("unexpected broken targets: %v", out.BrokenTargets)
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]interface{}
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	pg := back["pages"].([]interface{})[0].(map[string]interface{})
	for _, field := range []string{"url", "finalUrl", "status", "chain", "ttfb", "isHtml", "inSitemap", "title", "h1s", "links", "jsonld", "alternates", "og", "words", "text", "textHash", "mixed"} {
		if _, ok := pg[field]; !ok {
			t.Fatalf("output lacks field %q", field)
		}
	}
	if pg["chain"] == nil || pg["links"] == nil || pg["h1s"] == nil {
		t.Fatal("empty lists must be [] not null")
	}
}

func TestMaxPagesIsRespected(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, page("P", `<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a><a href="/4">4</a>`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	out, err := crawl(Config{SiteURL: srv.URL + "/", SitemapURL: srv.URL + "/sitemap.xml", MaxPages: 3, Concurrency: 2, Timeout: 5 * time.Second, Rounds: 3, Probe: 5, UserAgent: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Pages) > 3 {
		t.Fatalf("crawled %d pages with a limit of 3", len(out.Pages))
	}
}

func keys(m map[string]Page) []string {
	var k []string
	for u := range m {
		k = append(k, u)
	}
	return k
}
