package main

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// FetchResult is one fetch, with redirects followed by hand so the whole chain is recorded.
type FetchResult struct {
	URL      string
	FinalURL string
	Status   int
	Chain    []string
	TTFB     float64 // milliseconds until response headers for the first request
	IsHTML   bool
	HTML     string
	XRobots  string
	Err      string
}

const maxBody = 2_000_000

func newClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		// Never follow redirects automatically: the chain itself is what the audit reports.
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			MaxIdleConnsPerHost: 8,
			IdleConnTimeout:     30 * time.Second,
		},
	}
}

// fetchPage fetches rawURL with method GET or HEAD and follows up to maxHops redirects.
func fetchPage(client *http.Client, rawURL, method, userAgent string, maxHops int) FetchResult {
	res := FetchResult{URL: rawURL, Chain: []string{}}
	current := rawURL
	started := time.Now()
	for hop := 0; hop <= maxHops; hop++ {
		req, err := http.NewRequest(method, current, nil)
		if err != nil {
			res.FinalURL, res.Err = current, err.Error()
			return res
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		resp, err := client.Do(req)
		if err != nil {
			res.FinalURL, res.Err = current, shorten(err.Error(), 120)
			return res
		}
		if hop == 0 {
			res.TTFB = float64(time.Since(started).Milliseconds())
		}
		loc := resp.Header.Get("Location")
		if resp.StatusCode >= 300 && resp.StatusCode < 400 && loc != "" {
			resp.Body.Close()
			next, err := url.Parse(current)
			if err != nil {
				res.FinalURL, res.Err = current, err.Error()
				return res
			}
			target, err := next.Parse(loc)
			if err != nil {
				res.FinalURL, res.Err = current, err.Error()
				return res
			}
			res.Chain = append(res.Chain, current)
			current = target.String()
			continue
		}
		res.FinalURL = current
		res.Status = resp.StatusCode
		res.XRobots = resp.Header.Get("X-Robots-Tag")
		res.IsHTML = strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "html")
		if method == http.MethodGet && res.IsHTML {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
			res.HTML = string(b)
		}
		resp.Body.Close()
		return res
	}
	res.FinalURL, res.Err = current, "too many redirects"
	return res
}

func shorten(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// fetchText gets a plain text resource (sitemap, robots.txt). ok is false unless the server answered 200.
func fetchText(client *http.Client, rawURL, userAgent string) (string, bool) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", false
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	return string(b), true
}
