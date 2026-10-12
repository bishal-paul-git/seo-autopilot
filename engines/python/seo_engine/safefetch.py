"""Fetch a public web page for an agent without letting it reach private networks.

An agent decides which URLs to read, and that decision can be influenced by untrusted text (search results, feeds, page
content). So the fetch itself must be safe whatever the URL says:
  * only http and https, only ports 80 and 443 unless the caller allows more;
  * every hostname is resolved, and every address must be globally routable (no loopback, private, link-local, multicast
    or reserved ranges, which also blocks cloud metadata services);
  * the connection is made to the address that was checked, not re-resolved, so DNS cannot swap in a private address;
  * redirects are followed by hand and each hop is checked again;
  * size, time and content type are capped.
"""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

UA = "seo-autopilot-agent/1 (+https://github.com/bishal-paul-git/seo-autopilot)"
MAX_BYTES = 1_500_000
OK_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "application/json", "application/xml", "text/xml", "application/ld+json")


class FetchError(Exception):
    pass


def _public_addresses(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise FetchError(f"cannot resolve {host}: {e}") from None
    addrs = []
    for info in infos:
        ip = info[4][0]
        if not ipaddress.ip_address(ip.split("%")[0]).is_global:
            raise FetchError(f"{host} resolves to a non-public address ({ip}); refusing")
        addrs.append(ip)
    if not addrs:
        raise FetchError(f"no address for {host}")
    return addrs


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host, port, ip, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, port, ip, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        raw = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def fetch(url: str, timeout: float = 15.0, max_redirects: int = 5, allow_ports: tuple[int, ...] = (80, 443)) -> dict:
    """Return {url, status, contentType, body (text), redirects}. Raises FetchError on anything unsafe or broken."""
    chain = []
    current = url
    for _ in range(max_redirects + 1):
        parts = urlsplit(current)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise FetchError("only http and https URLs are allowed")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in allow_ports:
            raise FetchError(f"port {port} is not allowed")
        ip = _public_addresses(parts.hostname, port)[0]
        conn_cls = _PinnedHTTPS if parts.scheme == "https" else _PinnedHTTP
        conn = conn_cls(parts.hostname, port, ip, timeout)
        try:
            path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
            conn.request("GET", path, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,text/plain,application/json;q=0.8", "Accept-Encoding": "identity"})
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308) and resp.getheader("Location"):
                chain.append(current)
                current = urljoin(current, resp.getheader("Location"))
                continue
            ctype = (resp.getheader("Content-Type") or "").split(";")[0].strip().lower()
            if resp.status == 200 and ctype and not ctype.startswith(OK_TYPES):
                raise FetchError(f"content type {ctype} is not text")
            raw = resp.read(MAX_BYTES + 1)[:MAX_BYTES]
            charset = "utf-8"
            ct = resp.getheader("Content-Type") or ""
            if "charset=" in ct:
                charset = ct.split("charset=")[1].split(";")[0].strip() or "utf-8"
            try:
                body = raw.decode(charset, errors="replace")
            except LookupError:
                body = raw.decode("utf-8", errors="replace")
            return {"url": current, "status": resp.status, "contentType": ctype, "body": body, "redirects": chain}
        except (OSError, http.client.HTTPException) as e:
            raise FetchError(f"request failed: {e}") from None
        finally:
            conn.close()
    raise FetchError("too many redirects")


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.title = ""
        self._in_title = False
        self.parts: list[str] = []
        self.h: list[str] = []
        self._h = None

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP and tag != "head":
            self.skip += 1
        if tag in ("h1", "h2", "h3"):
            self._h = tag
            self.h.append("")
        if tag in ("p", "br", "li", "div", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP and tag != "head" and self.skip:
            self.skip -= 1
        if tag in ("h1", "h2", "h3"):
            self._h = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self.skip:
            return
        self.parts.append(data)
        if self._h is not None and self.h:
            self.h[-1] += data


def readable(html: str, max_chars: int = 12000) -> dict:
    """Title, headings and visible text of an HTML page."""
    p = _Text()
    try:
        p.feed(html)
    except Exception:  # malformed HTML must never crash a tool call
        pass
    text = " ".join("".join(p.parts).split())
    return {"title": " ".join(p.title.split()), "headings": [" ".join(h.split()) for h in p.h if h.strip()][:40], "words": len(text.split()), "text": text[:max_chars]}
