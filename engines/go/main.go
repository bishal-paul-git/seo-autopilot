// seo-crawl: a fast, polite, standard-library-only crawler for auditing your OWN site.
//
// It does the fetching half of seo-autopilot's technical audit. It reads the sitemap, fetches every page with a plain HTTP
// request (what a crawler sees before JavaScript), records redirect chains and timings, follows internal links, probes link
// targets it did not crawl, and prints one JSON document. The Node side builds the link graph and runs the audit rules on
// it, exactly as it does with its own built-in crawler, so both engines produce the same findings.
//
//	seo-crawl --url https://example.com/ [--sitemap URL] [--max-pages 300] [--concurrency 6] [--delay-ms 120] [--out file]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

const version = "0.1.0"

// Config is everything a crawl needs.
type Config struct {
	SiteURL     string
	SitemapURL  string
	MaxPages    int
	Concurrency int
	Delay       time.Duration
	Timeout     time.Duration
	Rounds      int
	Probe       int
	UserAgent   string
}

// Page is one crawled URL, in the same shape the Node audit uses.
type Page struct {
	URL      string   `json:"url"`
	FinalURL string   `json:"finalUrl"`
	Status   int      `json:"status"`
	Chain    []string `json:"chain"`
	TTFB     float64  `json:"ttfb"`
	XRobots  string   `json:"xRobots"`
	IsHTML   bool     `json:"isHtml"`
	InSitemap bool    `json:"inSitemap"`
	Error    string   `json:"error,omitempty"`
	Extracted
}

// Output is the whole result.
type Output struct {
	Engine        string         `json:"engine"`
	Version       string         `json:"version"`
	SitemapURLs   []string       `json:"sitemapUrls"`
	RobotsTxt     *string        `json:"robotsTxt"`
	Pages         []Page         `json:"pages"`
	BrokenTargets map[string]int `json:"brokenTargets"`
	Seconds       float64        `json:"seconds"`
}

var (
	reLoc   = regexp.MustCompile(`<loc>([^<]+)</loc>`)
	reAsset = regexp.MustCompile(`(?i)\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|json|txt|ico|css|js|mp3|mp4)(\?|$)`)
)

func strip(u string) string { return strings.TrimSuffix(u, "/") }

func bareHost(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(p.Host), "www.")
}

// fetchAll fetches urls with a bounded worker pool. Results keep the input order.
func fetchAll(cfg Config, client *http.Client, urls []string, method string) []FetchResult {
	out := make([]FetchResult, len(urls))
	jobs := make(chan int)
	var wg sync.WaitGroup
	n := cfg.Concurrency
	if n < 1 {
		n = 1
	}
	for w := 0; w < n; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = fetchPage(client, urls[i], method, cfg.UserAgent, 6)
				if cfg.Delay > 0 {
					time.Sleep(cfg.Delay)
				}
			}
		}()
	}
	for i := range urls {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return out
}

// crawl runs the whole audit fetch.
func crawl(cfg Config) (*Output, error) {
	started := time.Now()
	site, err := url.Parse(cfg.SiteURL)
	if err != nil || site.Host == "" {
		return nil, fmt.Errorf("--url must be a full URL such as https://example.com/")
	}
	client := newClient(cfg.Timeout)
	host := bareHost(cfg.SiteURL)
	isInternal := func(u string) bool { return bareHost(u) == host }

	out := &Output{Engine: "go", Version: version, SitemapURLs: []string{}, Pages: []Page{}, BrokenTargets: map[string]int{}}
	if sm, ok := fetchText(client, cfg.SitemapURL, cfg.UserAgent); ok {
		for _, m := range reLoc.FindAllStringSubmatch(sm, -1) {
			out.SitemapURLs = append(out.SitemapURLs, strings.TrimSpace(html.UnescapeString(m[1])))
		}
	}
	robotsURL := site.Scheme + "://" + site.Host + "/robots.txt"
	if rb, ok := fetchText(client, robotsURL, cfg.UserAgent); ok {
		out.RobotsTxt = &rb
	}

	inSitemap := map[string]bool{}
	for _, u := range out.SitemapURLs {
		inSitemap[strip(u)] = true
	}
	// The home page and the sitemap URLs make the first batch; each URL is fetched once.
	var queue []string
	seen := map[string]bool{}
	for _, u := range append([]string{cfg.SiteURL}, out.SitemapURLs...) {
		if !seen[strip(u)] {
			seen[strip(u)] = true
			queue = append(queue, u)
		}
	}
	index := map[string]int{} // strip(url) -> position in out.Pages

	for round := 0; round < cfg.Rounds && len(queue) > 0 && len(out.Pages) < cfg.MaxPages; round++ {
		batch := queue
		queue = nil
		if room := cfg.MaxPages - len(out.Pages); len(batch) > room {
			batch = batch[:room]
		}
		for i, r := range fetchAll(cfg, client, batch, http.MethodGet) {
			p := Page{URL: r.URL, FinalURL: r.FinalURL, Status: r.Status, Chain: r.Chain, TTFB: r.TTFB, XRobots: r.XRobots, IsHTML: r.IsHTML, InSitemap: inSitemap[strip(batch[i])], Error: r.Err}
			if p.FinalURL == "" {
				p.FinalURL = p.URL
			}
			if r.IsHTML && r.Status == 200 {
				p.Extracted = extractPage(r.HTML, r.FinalURL)
				for _, l := range p.Links {
					if isInternal(l.URL) && !seen[strip(l.URL)] && !reAsset.MatchString(l.URL) {
						seen[strip(l.URL)] = true
						queue = append(queue, l.URL)
					}
				}
			} else {
				p.Extracted = emptyExtracted()
			}
			index[strip(r.URL)] = len(out.Pages)
			out.Pages = append(out.Pages, p)
		}
	}

	// Internal link targets that were not crawled: check that they resolve (HEAD), capped.
	finalSeen := map[string]bool{}
	for _, p := range out.Pages {
		finalSeen[strip(p.FinalURL)] = true
	}
	probeSet := map[string]bool{}
	var probe []string
	for _, p := range out.Pages {
		for _, l := range p.Links {
			k := strip(l.URL)
			if !isInternal(l.URL) || reAsset.MatchString(l.URL) || probeSet[k] {
				continue
			}
			if _, crawled := index[k]; crawled || finalSeen[k] {
				continue
			}
			probeSet[k] = true
			probe = append(probe, l.URL)
		}
	}
	if len(probe) > cfg.Probe {
		probe = probe[:cfg.Probe]
	}
	for i, r := range fetchAll(cfg, client, probe, http.MethodHead) {
		if r.Status >= 400 || r.Status == 0 {
			out.BrokenTargets[probe[i]] = r.Status
		}
	}
	out.Seconds = time.Since(started).Seconds()
	return out, nil
}

func emptyExtracted() Extracted {
	return Extracted{Alternates: []Alternate{}, H1s: []string{}, H2s: []string{}, Headings: []Heading{}, Links: []Link{}, Mixed: []string{},
		JSONLD: JSONLD{Types: []string{}, Nodes: []SchemaNode{}}}
}

func main() {
	var cfg Config
	var out string
	var showVersion bool
	var delayMS, timeoutS int
	flag.StringVar(&cfg.SiteURL, "url", "", "home page of the site to crawl (required)")
	flag.StringVar(&cfg.SitemapURL, "sitemap", "", "sitemap URL (default: <url>sitemap.xml)")
	flag.IntVar(&cfg.MaxPages, "max-pages", 300, "stop after this many pages")
	flag.IntVar(&cfg.Concurrency, "concurrency", 6, "parallel requests")
	flag.IntVar(&delayMS, "delay-ms", 120, "pause after each request, per worker")
	flag.IntVar(&timeoutS, "timeout-s", 20, "per-request timeout in seconds")
	flag.IntVar(&cfg.Rounds, "rounds", 3, "how many link-following rounds after the sitemap")
	flag.IntVar(&cfg.Probe, "probe", 150, "maximum link targets to check with HEAD")
	flag.StringVar(&cfg.UserAgent, "user-agent", "seo-autopilot-audit/2 (+https://github.com/bishal-paul-git/seo-autopilot)", "User-Agent header")
	flag.StringVar(&out, "out", "", "write JSON to this file instead of standard output")
	flag.BoolVar(&showVersion, "version", false, "print the version")
	flag.Parse()
	if showVersion {
		fmt.Println("seo-crawl", version)
		return
	}
	if cfg.SiteURL == "" {
		fmt.Fprintln(os.Stderr, "seo-crawl: --url is required")
		os.Exit(2)
	}
	if !strings.HasSuffix(cfg.SiteURL, "/") && strings.Count(cfg.SiteURL, "/") <= 2 {
		cfg.SiteURL += "/"
	}
	if cfg.SitemapURL == "" {
		cfg.SitemapURL = strings.TrimSuffix(cfg.SiteURL, "/") + "/sitemap.xml"
	}
	cfg.Delay = time.Duration(delayMS) * time.Millisecond
	cfg.Timeout = time.Duration(timeoutS) * time.Second

	res, err := crawl(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "seo-crawl:", err)
		os.Exit(1)
	}
	w := os.Stdout
	if out != "" {
		f, err := os.Create(out)
		if err != nil {
			fmt.Fprintln(os.Stderr, "seo-crawl:", err)
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(res); err != nil {
		fmt.Fprintln(os.Stderr, "seo-crawl:", err)
		os.Exit(1)
	}
}
