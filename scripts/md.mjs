// Tiny, dependency-free Markdown to HTML for the landing site (agents and playbooks pages).
// Supports: headings, paragraphs, bullet and numbered lists, pipe tables, fenced code, block quotes, rules,
// and inline code, bold, italic and links. Everything is HTML-escaped first, so file content can never inject markup.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Split off a leading --- front matter block. */
export function frontMatter(text) {
  const m = String(text).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(text).replace(/\r\n/g, "\n") };
  const meta = {};
  for (const line of m[1].split("\n")) { const k = line.match(/^([A-Za-z-]+):\s*(.*)$/); if (k) meta[k[1]] = k[2]; }
  return { meta, body: m[2].replace(/^\s+/, "") };
}

export function inline(text, linkMap = (h) => h) {
  let s = esc(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const h = linkMap(href.replace(/&amp;/g, "&"));
    if (/^(javascript|data|vbscript):/i.test(h)) return label;
    return `<a href="${esc(h)}"${/^https?:/i.test(h) ? ' rel="noopener"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function markdown(src, { linkMap, headingOffset = 0 } = {}) {
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const inl = (t) => inline(t, linkMap);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = Math.min(6, h[1].length + headingOffset); out.push(`<h${n}>${inl(h[2])}</h${n}>`); i++; continue; }
    if (/^---+$/.test(line.trim())) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${inl(buf.join(" "))}</blockquote>`); continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]); const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) { items.push(m[3]); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inl(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\|.*\|\s*$|\s*([-*]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length) out.push(`<p>${inl(buf.join(" "))}</p>`); else i++;
  }
  return out.join("\n");
}
