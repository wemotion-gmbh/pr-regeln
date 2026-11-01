// Quote-aware splitting of Bash and PowerShell command lines into simple commands.
// It is a reader for a guard, not a shell: whatever it cannot resolve keeps its "$", so callers can skip it.

const TEXT = '$__text';
const REDIRECT_ALONE = /^(?:\d|\*)?(?:>>?|<)(?:&\d)?$/;
const REDIRECT_ATTACHED = /^(?:\d|\*)?(?:>>?|<)\S/;

// Heredoc and here-string bodies are data, never commands; they become one unknown word.
function dropBodies(command) {
  const lines = command.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const here = /@(['"])[ \t]*$/.exec(line);
    if (here) {
      const close = `${here[1]}@`;
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith(close)) j++;
      if (j < lines.length) {
        out.push(line.slice(0, here.index) + TEXT + lines[j].slice(close.length));
        i = j;
        continue;
      }
    }
    const delimiters = [];
    out.push(line.replace(/(?<!<)<<(?!<)-?[ \t]*(['"]?)([A-Za-z_][\w.-]*)\1/g, (m, q, d) => {
      delimiters.push(d);
      return TEXT;
    }));
    for (const d of delimiters) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== d) j++;
      i = j;
    }
  }
  return out.join('\n');
}

// Segments of tokens; a token is a list of parts { s, q } with q = "'" (literal), '"' or '' (bare).
function scan(text) {
  const segments = [];
  let seg = [];
  let tok = null;
  const add = (s, q) => {
    tok ??= [];
    const last = tok.at(-1);
    if (last && last.q === q) last.s += s;
    else tok.push({ s, q });
  };
  const endTok = () => {
    if (tok) seg.push(tok);
    tok = null;
  };
  const endSeg = () => {
    endTok();
    if (seg.length) segments.push(seg);
    seg = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      const end = j < 0 ? text.length : j;
      add(text.slice(i + 1, end), "'");
      i = end;
    } else if (c === '"') {
      let s = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if ((text[j] === '\\' || text[j] === '`') && text[j + 1] === '"') j++;
        s += text[j];
      }
      add(s, '"');
      i = j;
    } else if ((c === '\\' || c === '`') && next === '\n') {
      i++;
    } else if (c === '\n' || c === ';') {
      endSeg();
    } else if (c === '|' || (c === '&' && next === '&')) {
      endSeg();
      if (next === c) i++;
    } else if (/\s/.test(c)) {
      endTok();
    } else if ('{}()'.includes(c) && !tok && (next === undefined || /\s/.test(next))) {
      endSeg();
    } else if (c === '#' && !tok) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
    } else if (c === '$' && next === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) break;
      }
      add(text.slice(i, j + 1), '');
      i = j;
    } else {
      add(c, '');
    }
  }
  endSeg();
  return segments;
}

function interpolate(s, vars) {
  return s.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)(?![\w:])/g, (m, a, b) => vars.get((a ?? b).toLowerCase()) ?? m);
}

const resolve = (parts, vars) => parts.map((p) => (p.q === "'" ? p.s : interpolate(p.s, vars))).join('');
const isLiteral = (parts, value) => !/\$[\w{(]/.test(value) && !parts.some((p) => p.q !== "'" && /[()@]/.test(p.s));

// $x = 'v', $x='v', x=v and export x=v. A non-literal assignment forgets the name.
function learn(seg, vars) {
  const first = seg[0]?.[0];
  let name;
  let valueParts;
  if (seg.length === 3 && seg[0].length === 1 && first.q === '' && /^\$[A-Za-z_]\w*$/.test(first.s) && seg[1].length === 1 && seg[1][0].s === '=') {
    name = first.s.slice(1);
    valueParts = seg[2];
  } else if (seg.length >= 3 && seg[0].length === 1 && first.q === '' && /^\$[A-Za-z_]\w*$/.test(first.s) && seg[1][0]?.s === '=') {
    vars.delete(first.s.slice(1).toLowerCase());
    return;
  } else {
    const tok = seg.length === 2 && seg[0].length === 1 && seg[0][0].s === 'export' ? seg[1] : seg.length === 1 ? seg[0] : null;
    const m = tok && tok[0].q === '' ? /^(\$?)([A-Za-z_]\w*)=/.exec(tok[0].s) : null;
    if (!m) return;
    name = m[2];
    valueParts = [{ ...tok[0], s: tok[0].s.slice(m[0].length) }, ...tok.slice(1)];
  }
  const value = resolve(valueParts, vars);
  if (isLiteral(valueParts, value)) vars.set(name.toLowerCase(), value);
  else vars.delete(name.toLowerCase());
}

export function splitCommands(command) {
  const vars = new Map();
  const out = [];
  for (const seg of scan(dropBodies(String(command ?? '')))) {
    const words = [];
    for (let i = 0; i < seg.length; i++) {
      const raw = seg[i].map((p) => p.s).join('');
      if (seg[i].every((p) => p.q === '') && REDIRECT_ALONE.test(raw)) {
        if (!raw.includes('&')) i++;
        continue;
      }
      if (seg[i][0].q === '' && REDIRECT_ATTACHED.test(raw)) continue;
      words.push(resolve(seg[i], vars));
    }
    learn(seg, vars);
    if (words.length) out.push(words);
  }
  return out;
}
