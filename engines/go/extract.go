package main

// Turns the HTML a server sends into the facts an SEO audit needs. It mirrors src/audit/extract.mjs field for field so the
// audit rules can run on either engine. Standard library only, regular-expression based and deliberately conservative: it
// reads what a crawler sees before any JavaScript runs.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

type Link struct {
	URL      string `json:"url"`
	Text     string `json:"text"`
	Nofollow bool   `json:"nofollow"`
}

type Alternate struct {
	Hreflang string `json:"hreflang"`
	Href     string `json:"href"`
}

type OG struct {
	Title *string `json:"title"`
	Image *string `json:"image"`
}

type SchemaNode struct {
	Type  string   `json:"type"`
	Props []string `json:"props"`
}

type JSONLD struct {
	Types         []string        `json:"types"`
	Invalid       int             `json:"invalid"`
	Blocks        int             `json:"blocks"`
	ArticleFields map[string]bool `json:"articleFields"`
	Nodes         []SchemaNode    `json:"nodes"`
}

// Extracted holds everything read from one HTML document.
type Extracted struct {
	Title       string      `json:"title"`
	Description *string     `json:"description"`
	Robots      string      `json:"robots"`
	Viewport    *string     `json:"viewport"`
	Canonical   *string     `json:"canonical"`
	Alternates  []Alternate `json:"alternates"`
	H1s         []string    `json:"h1s"`
	H2s         []string    `json:"h2s"`
	Lang        *string     `json:"lang"`
	OG          OG          `json:"og"`
	JSONLD      JSONLD      `json:"jsonld"`
	Links       []Link      `json:"links"`
	Images      int         `json:"images"`
	ImagesNoAlt int         `json:"imagesNoAlt"`
	Mixed       []string    `json:"mixed"`
	Words       int         `json:"words"`
	Text        string      `json:"text"`
	TextHash    string      `json:"textHash"`
}

var (
	reHead     = regexp.MustCompile(`(?is)<head\b.*?</head>`)
	reTitle    = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reMeta     = regexp.MustCompile(`(?i)<meta\b[^>]*>`)
	reLink     = regexp.MustCompile(`(?i)<link\b[^>]*>`)
	reAttr     = regexp.MustCompile(`([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?`)
	reH1       = regexp.MustCompile(`(?is)<h1\b[^>]*>(.*?)</h1>`)
	reH2       = regexp.MustCompile(`(?is)<h2\b[^>]*>(.*?)</h2>`)
	reLD       = regexp.MustCompile(`(?is)<script\b[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>`)
	reAnchor   = regexp.MustCompile(`(?is)<a\b([^>]*)>(.*?)</a>`)
	reImg      = regexp.MustCompile(`(?i)<img\b[^>]*>`)
	reAlt      = regexp.MustCompile(`(?i)\balt\s*=`)
	reMixed    = regexp.MustCompile(`(?i)<(?:script|link|img|iframe|source)\b[^>]*?(?:src|href)=["'](http://[^"']+)["']`)
	reLang     = regexp.MustCompile(`(?i)<html\b[^>]*\blang=["']?([A-Za-z-]+)`)
	reTag      = regexp.MustCompile(`<[^>]+>`)
	reComment  = regexp.MustCompile(`(?s)<!--.*?-->`)
	reSpace    = regexp.MustCompile(`\s+`)
	reSkipHref = regexp.MustCompile(`(?i)^(mailto:|tel:|javascript:|#)`)
	reArticle  = regexp.MustCompile(`Article|BlogPosting|NewsArticle`)
	reAltCanon = regexp.MustCompile(`(?i)rel=["']?(?:alternate|canonical)`)
	reInvisible = func() []*regexp.Regexp {
		var out []*regexp.Regexp
		for _, t := range []string{"script", "style", "noscript", "svg", "template", "head"} {
			out = append(out, regexp.MustCompile(`(?is)<`+t+`\b[^>]*>.*?</`+t+`>`))
		}
		return out
	}()
)

func stripTags(s string) string {
	return strings.TrimSpace(reSpace.ReplaceAllString(html.UnescapeString(reTag.ReplaceAllString(s, " ")), " "))
}

// attrs reads the attributes of one tag, with lower-case names.
func attrs(tag string) map[string]string {
	out := map[string]string{}
	body := regexp.MustCompile(`^<\w+`).ReplaceAllString(tag, "")
	body = regexp.MustCompile(`/?>$`).ReplaceAllString(body, "")
	for _, m := range reAttr.FindAllStringSubmatch(body, -1) {
		v := m[2]
		if v == "" {
			v = m[3]
		}
		if v == "" {
			v = m[4]
		}
		out[strings.ToLower(m[1])] = html.UnescapeString(v)
	}
	return out
}

// visibleText removes scripts, styles and other non-visible blocks and returns the text a reader would see.
func visibleText(doc string) string {
	s := reComment.ReplaceAllString(doc, " ")
	for _, re := range reInvisible {
		s = re.ReplaceAllString(s, " ")
	}
	return stripTags(s)
}

func normalizeURL(href, base string) (string, bool) {
	b, err := url.Parse(base)
	if err != nil {
		return "", false
	}
	u, err := b.Parse(strings.TrimSpace(href))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	u.Fragment = ""
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String(), true
}

func strp(s string) *string { return &s }

func truthy(v interface{}) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	default:
		return true
	}
}

func isEmptyValue(v interface{}) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case []interface{}:
		return len(x) == 0
	}
	return false
}

func collapse(s string) string { return reSpace.ReplaceAllString(s, " ") }

func hashText(text string) string {
	t := strings.ToLower(collapse(text))
	if utf8.RuneCountInString(t) > 3000 {
		t = string([]rune(t)[:3000])
	}
	sum := sha1.Sum([]byte(t))
	return hex.EncodeToString(sum[:])
}

func parseJSONLD(doc string) JSONLD {
	out := JSONLD{Types: []string{}, Nodes: []SchemaNode{}}
	for _, m := range reLD.FindAllStringSubmatch(doc, -1) {
		out.Blocks++
		var data interface{}
		if err := json.Unmarshal([]byte(m[1]), &data); err != nil {
			out.Invalid++
			continue
		}
		var nodes []interface{}
		switch d := data.(type) {
		case []interface{}:
			nodes = d
		case map[string]interface{}:
			if g, ok := d["@graph"].([]interface{}); ok && len(g) > 0 {
				nodes = g
			} else {
				nodes = []interface{}{d}
			}
		}
		for _, raw := range nodes {
			n, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			var types []string
			switch t := n["@type"].(type) {
			case string:
				types = []string{t}
			case []interface{}:
				for _, x := range t {
					if s, ok := x.(string); ok {
						types = append(types, s)
					}
				}
			}
			keys := make([]string, 0, len(n))
			for k, v := range n {
				if !isEmptyValue(v) {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			isArticle := false
			for _, t := range types {
				out.Types = append(out.Types, t)
				out.Nodes = append(out.Nodes, SchemaNode{Type: t, Props: keys})
				if reArticle.MatchString(t) {
					isArticle = true
				}
			}
			if isArticle {
				out.ArticleFields = map[string]bool{"headline": truthy(n["headline"]), "datePublished": truthy(n["datePublished"]), "author": truthy(n["author"]), "image": truthy(n["image"])}
			}
		}
	}
	return out
}

func texts(re *regexp.Regexp, doc string) []string {
	out := []string{}
	for _, m := range re.FindAllStringSubmatch(doc, -1) {
		if t := stripTags(m[1]); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// extractPage reads one HTML document served from pageURL.
func extractPage(doc, pageURL string) Extracted {
	head := reHead.FindString(doc)
	if head == "" {
		head = doc
		if len(head) > 20000 {
			head = head[:20000]
		}
	}
	x := Extracted{Alternates: []Alternate{}, Links: []Link{}, Mixed: []string{}}
	if m := reTitle.FindStringSubmatch(head); m != nil {
		x.Title = stripTags(m[1])
	}
	metas, props := map[string]string{}, map[string]string{}
	for _, t := range reMeta.FindAllString(head, -1) {
		a := attrs(t)
		if a["name"] != "" {
			metas[strings.ToLower(a["name"])] = a["content"]
		}
		if a["property"] != "" {
			props[strings.ToLower(a["property"])] = a["content"]
		}
	}
	for _, t := range reLink.FindAllString(head, -1) {
		a := attrs(t)
		rel := strings.ToLower(a["rel"])
		for _, r := range strings.Fields(rel) {
			if r == "canonical" && a["href"] != "" {
				if u, ok := normalizeURL(a["href"], pageURL); ok {
					x.Canonical = strp(u)
				}
			}
		}
		if rel == "alternate" && a["hreflang"] != "" && a["href"] != "" {
			if u, ok := normalizeURL(a["href"], pageURL); ok {
				x.Alternates = append(x.Alternates, Alternate{Hreflang: a["hreflang"], Href: u})
			}
		}
	}
	if v, ok := metas["description"]; ok {
		x.Description = strp(v)
	}
	if v, ok := metas["viewport"]; ok {
		x.Viewport = strp(v)
	}
	x.Robots = strings.ToLower(metas["robots"])
	if v, ok := props["og:title"]; ok {
		x.OG.Title = strp(v)
	}
	if v, ok := props["og:image"]; ok {
		x.OG.Image = strp(v)
	}
	x.H1s, x.H2s = texts(reH1, doc), texts(reH2, doc)
	x.JSONLD = parseJSONLD(doc)

	for _, m := range reAnchor.FindAllStringSubmatch(doc, -1) {
		a := attrs("<a " + m[1] + ">")
		if a["href"] == "" || reSkipHref.MatchString(a["href"]) {
			continue
		}
		if u, ok := normalizeURL(a["href"], pageURL); ok {
			text := stripTags(m[2])
			if r := []rune(text); len(r) > 120 {
				text = string(r[:120])
			}
			x.Links = append(x.Links, Link{URL: u, Text: text, Nofollow: strings.Contains(strings.ToLower(a["rel"]), "nofollow")})
		}
	}
	imgs := reImg.FindAllString(doc, -1)
	x.Images = len(imgs)
	for _, t := range imgs {
		if !reAlt.MatchString(t) {
			x.ImagesNoAlt++
		}
	}
	if strings.HasPrefix(strings.ToLower(pageURL), "https:") {
		for _, m := range reMixed.FindAllStringSubmatch(doc, -1) {
			if !reAltCanon.MatchString(m[1]) && len(x.Mixed) < 5 {
				x.Mixed = append(x.Mixed, m[1])
			}
		}
	}
	if m := reLang.FindStringSubmatch(doc); m != nil {
		x.Lang = strp(m[1])
	}
	x.Text = visibleText(doc)
	if x.Text != "" {
		x.Words = len(strings.Fields(x.Text))
	}
	x.TextHash = hashText(x.Text)
	return x
}
