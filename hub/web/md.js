// A small, safe Markdown renderer for journal entries: everything is escaped first, then a CommonMark-like subset is
// turned into HTML — headings, paragraphs, line breaks, emphasis, code, links, lists (with task boxes), quotes, rules.
// Raw HTML in the text is shown as text, never rendered.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function safeUrl(u) {
  const url = u.replace(/&amp;/g, '&').trim();
  return /^(https?:|mailto:)/i.test(url) ? esc(url) : null;
}

/** Inline markup of one already-escaped line run. */
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const u = safeUrl(href);
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
  });
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (m, href) => `<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${href}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, href) => `${pre}<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${href}</a>`);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/** Markdown text → HTML string. */
export function markdown(src) {
  const lines = esc(String(src ?? '').replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const listRe = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    let m;
    if ((m = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(line))) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const n = m[1].length;
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s{0,3}&gt;/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}&gt;/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}&gt;\s?/, ''));
      out.push(`<blockquote>${markdown(body.join('\n').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))}</blockquote>`);
      continue;
    }
    if ((m = listRe.exec(line))) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const lm = listRe.exec(lines[i]);
        if (lm && /\d/.test(lm[2]) === ordered) {
          items.push(lm[3]);
          i++;
        } else if (!isBlank(lines[i]) && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i++;
        } else break;
      }
      const lis = items.map((t) => {
        const task = /^\[([ xX])\]\s+(.*)$/s.exec(t);
        if (task) return `<li class="task"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2])}</li>`;
        return `<li>${inline(t)}</li>`;
      });
      const start = ordered && Number.parseInt(m[2], 10) !== 1 ? ` start="${Number.parseInt(m[2], 10)}"` : '';
      out.push(ordered ? `<ol${start}>${lis.join('')}</ol>` : `<ul>${lis.join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^\s*(```|~~~|#{1,6}\s|&gt;)/.test(lines[i]) && !(para.length && listRe.test(lines[i]))) para.push(lines[i++]);
    out.push(`<p>${inline(para.join('\n'))}</p>`);
  }
  return out.join('\n');
}

/** Plain text of Markdown (for snippets and titles). */
export function plain(src) {
  return String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>]+/g, '')
    .replace(/^\s*[-+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
