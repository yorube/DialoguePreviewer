// MBU custom-yarn body parser.
// Input: body string from a node (the .body field of per-locale .json).
// Output: { statements: Stmt[], labels: Map<labelName, path> }
//
// Statement shapes:
//   { type: 'line',   speaker, text }
//   { type: 'choices', items: [{ text, condition, body: Stmt[] }] }
//   { type: 'goto',   label }
//   { type: 'condGoto', cond, label, isElse }
//   { type: 'label',  name }
//   { type: 'set',    variable, expr }
//   { type: 'if',     cond, then: Stmt[], else: Stmt[] }
//   { type: 'end' }
//   { type: 'wait',   seconds }
//
// Drops: <<Play>>, <<PlayUntil>>, <<CloseCommunicator>>, // comments, blank lines.

(function (global) {
  // Strip TMP markup completely (visible text only). Used in places where we
  // can't render HTML, e.g. node titles or fallbacks.
  function stripMarkup(s) {
    if (s == null) return '';
    return String(s).replace(/<\/?[a-zA-Z][^<>]*>/g, '');
  }

  // Convert MBU/TMP markup tags to safe HTML for innerHTML rendering.
  // All literal content is HTML-escaped first; whitelisted tags are then
  // un-escaped back to real HTML. Unknown tags are stripped silently
  // (their inner text is preserved).
  //
  // Supported (TMP / MBU dialect):
  //   <i> <b> <u> <sup> <sub>      direct HTML mapping
  //   <s>                          → <i> (MBU spec: 悄悄話/小聲)
  //   <y>                          → MBU warm-yellow span
  //   <color=#hex>                 → span with inline color
  //   <size=Npx>, <size=N>         → span with inline font-size
  //   <mark=#hex>                  → span with background highlight
  function markupToSafeHtml(s) {
    if (s == null) return '';
    let out = String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    out = out.replace(/&lt;color=#?([0-9a-fA-F]{3,8})&gt;/gi,
      (_, hex) => '<span style="color:#' + hex + '">');
    out = out.replace(/&lt;\/color&gt;/gi, '</span>');

    out = out.replace(/&lt;y&gt;/gi, '<span style="color:#E7D6A9">');
    out = out.replace(/&lt;\/y&gt;/gi, '</span>');

    out = out.replace(/&lt;s&gt;/gi, '<i>');
    out = out.replace(/&lt;\/s&gt;/gi, '</i>');

    out = out.replace(/&lt;(\/?)(i|b|u|sup|sub)&gt;/gi, '<$1$2>');

    out = out.replace(/&lt;size=(\d+(?:\.\d+)?)(?:px)?&gt;/gi,
      (_, n) => '<span style="font-size:' + n + 'px">');
    out = out.replace(/&lt;\/size&gt;/gi, '</span>');

    out = out.replace(/&lt;mark=#?([0-9a-fA-F]{3,8})&gt;/gi,
      (_, hex) => '<span style="background:#' + hex + '33">');
    out = out.replace(/&lt;\/mark&gt;/gi, '</span>');

    // Anything still escaped as &lt;…&gt; is unknown markup; strip the tag
    // shell but keep any text that was between consecutive tags. (This fires
    // for things like <t=0.1>, <e=0.5>, <f> animation timing tokens.)
    out = out.replace(/&lt;[^>]*?&gt;/g, '');

    return out;
  }

  // Detect "<<...>>" command and return inner text, else null.
  function asCommand(line) {
    const m = line.match(/^<<\s*([\s\S]*?)\s*>>$/);
    return m ? m[1].trim() : null;
  }

  // Split a raw line by ";" but respect << >> nesting (no ; inside commands today,
  // but be safe).
  function splitStatements(rawLine) {
    const out = [];
    let depth = 0, buf = '';
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (c === '<' && rawLine[i + 1] === '<') { depth++; buf += '<<'; i++; continue; }
      if (c === '>' && rawLine[i + 1] === '>') { depth--; buf += '>>'; i++; continue; }
      if (c === ';' && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += c;
    }
    if (buf.length) out.push(buf);
    return out.map(s => s.trim()).filter(Boolean);
  }

  function indentOf(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].replace(/\t/g, '    ').length : 0;
  }

  // Tokenize a node body into "logical lines": each entry is { indent, text }
  // where text is one statement (after splitting by ;).
  function tokenize(body) {
    const rawLines = body.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      if (!raw.trim()) continue;
      if (raw.trim().startsWith('//')) continue;
      const indent = indentOf(raw);
      const stripped = raw.replace(/^\s+/, '');
      const stmts = splitStatements(stripped);
      if (!stmts.length) continue;
      const srcLine = i + 1;   // 1-based, matches what renderSource shows

      out.push({ indent, text: stmts[0], srcLine });

      // If the first statement is an option, statements after it on the same
      // physical line (separated by `;`) are *attached to that option* — they
      // fire when the option is chosen. Treat them as if indented one level
      // deeper so build()'s body-collection loop scoops them up.
      // For non-option leaders, trailing `;`-statements stay as sibling
      // statements at the same indent (sequential execution).
      const firstIsOption = stmts[0].startsWith('->');
      const trailingIndent = firstIsOption ? indent + 4 : indent;
      for (let j = 1; j < stmts.length; j++) {
        const s = stmts[j];
        if (!s || s.startsWith('//')) continue;
        out.push({ indent: trailingIndent, text: s, srcLine });
      }
    }
    return out;
  }

  // Identify simple drop-on-sight commands (animation/etc.).
  function isDropCommand(inner) {
    const head = inner.split(/[\s(]/)[0];
    const drops = ['Play', 'PlayUntil', 'CloseCommunicator', '#Wait', 'wait',
                   '#Simple', '#EndSimple', '#End'];
    // #Simple/#EndSimple are wrappers; we drop them but need them as group markers.
    // We'll handle Simple/EndSimple/End at higher level — return false here
    // for those and let the parser see them.
    if (head === '#Simple' || head === '#EndSimple' || head === '#End') return false;
    return drops.includes(head);
  }

  // Parse "Set" command in either `<<Set($v, val)>>` or `<<set $v to val>>` style.
  function parseSet(inner) {
    // Try `Set ( $v, expr )` form
    let m = inner.match(/^[Ss]et\s*\(\s*\$?([A-Za-z_][\w]*)\s*,\s*(.+?)\s*\)\s*$/);
    if (m) {
      const variable = '$' + m[1];
      let expr = m[2].trim();
      // MBU shorthand `$+N` / `$-N` means "self ± N". Spec 4.5.
      const sh = expr.match(/^\$\s*([+\-])\s*(\d+(?:\.\d+)?)\s*$/);
      if (sh) expr = `${variable} ${sh[1]} ${sh[2]}`;
      return { variable, expr };
    }
    // Try `set $v to expr` form
    m = inner.match(/^[Ss]et\s+\$?([A-Za-z_][\w]*)\s+to\s+(.+)$/);
    if (m) return { variable: '$' + m[1], expr: m[2] };
    return null;
  }

  // Parse one command body (the inner of <<...>>) into a Stmt or null.
  function parseCommand(inner) {
    if (!inner) return null;
    const head = inner.split(/[\s(]/)[0];

    // Drops
    if (isDropCommand(inner)) return null;

    // #End
    if (head === '#End') return { type: 'end' };

    // #Simple / #EndSimple — markers handled by caller
    if (head === '#Simple') return { type: '_simpleStart' };
    if (head === '#EndSimple') return { type: '_simpleEnd' };

    // #GoTo
    let m = inner.match(/^#GoTo\s*\(\s*@?(.+?)\s*\)\s*$/);
    if (m) return { type: 'goto', label: m[1] };

    // #IsGoTo / #IsElseTo
    m = inner.match(/^#(IsGoTo|IsElseTo)\s*\(\s*(.+?)\s*,\s*@?(.+?)\s*\)\s*$/);
    if (m) return { type: 'condGoto', cond: m[2], label: m[3], isElse: m[1] === 'IsElseTo' };

    // #If / #IfNot / #EndIf  (block markers)
    m = inner.match(/^#If\s*\(\s*(.+?)\s*\)\s*$/);
    if (m) return { type: '_ifStart', cond: m[1], negate: false };
    m = inner.match(/^#IfNot\s*\(\s*(.+?)\s*\)\s*$/);
    if (m) return { type: '_ifStart', cond: m[1], negate: true };
    if (head === '#EndIf') return { type: '_ifEnd' };

    // @label (inline label)
    m = inner.match(/^@(.+)$/);
    if (m) return { type: 'label', name: m[1].trim() };

    // Set
    const setRes = parseSet(inner);
    if (setRes) return { type: 'set', variable: setRes.variable, expr: setRes.expr };

    // #Wait
    m = inner.match(/^#?[Ww]ait\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?$/);
    if (m) return { type: 'wait', seconds: parseFloat(m[1]) };

    // Unknown command — drop with marker
    return { type: 'unknown', raw: inner };
  }

  // Strip MBU speaker modifiers — `?prefix` (anonymous, displays as ???) and
  // `(c)suffix` (communicator). Spec 4.1.
  function splitSpeakerModifiers(rawSpeaker) {
    let name = rawSpeaker;
    let isCommunicator = false;
    let isAnonymous = false;
    const cm = name.match(/^(.*?)\s*[（(]\s*c\s*[)）]\s*$/i);
    if (cm) {
      name = cm[1].trim();
      isCommunicator = true;
    }
    if (/^[?？]/.test(name)) {
      name = name.replace(/^[?？]+/, '').trim();
      isAnonymous = true;
    }
    return { name, isCommunicator, isAnonymous };
  }

  // Parse a dialogue line `Speaker: text` or narrator `text`.
  // Markup is preserved on `text` so the UI can render it via
  // markupToSafeHtml. Speaker name is plain text only.
  function parseDialogue(text) {
    const m = text.match(/^([^:：<>]{1,40}?)[:：]\s*(.+)$/);
    if (m) {
      const mods = splitSpeakerModifiers(m[1].trim());
      return {
        type: 'line',
        speaker: mods.name,
        isCommunicator: mods.isCommunicator,
        isAnonymous: mods.isAnonymous,
        text: m[2],
      };
    }
    return { type: 'line', speaker: '', text: text };
  }

  // Parse an option `-> text [(cond)] [<<cmd>>...]`
  function parseOption(text) {
    // text starts with `-> `
    let body = text.replace(/^->\s*/, '');
    // Pull off any inline commands separated by ; — but here splitStatements
    // already split. So `body` is just the option label. But can still have
    // `(cond)` suffix for display condition.
    // Match optional `(...)` at the END of the line (display-condition).
    let cond = null;
    const condM = body.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (condM) {
      body = condM[1].trim();
      cond = condM[2].trim();
      // Bare `$varName` semantics in MBU = `$varName >= 0`
      if (/^\$[A-Za-z_]\w*$/.test(cond)) cond = cond + ' >= 0';
    }
    return { type: '_option', text: body, cond };
  }

  // Top-level statement parser: take a tokenized line, classify it.
  // Returns Stmt or marker (_simpleStart/_simpleEnd/_ifStart/_ifEnd/_option).
  function classifyLine(text) {
    if (text.startsWith('->')) return parseOption(text);
    const cmdInner = asCommand(text);
    if (cmdInner !== null) return parseCommand(cmdInner);
    return parseDialogue(text);
  }

  // Build a Stmt array from a sub-range of tokens, recognizing indentation
  // for option-bodies and #If/#EndIf blocks. Returns the array.
  // tokens = [{indent, text, _classified?}]
  // Modifies tokens by classifying in place.
  function build(tokens, baseIndent) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.indent < baseIndent) break;
      if (t.indent > baseIndent) {
        // Stray over-indented content at the top — should be consumed by
        // option bodies or if-blocks below, not at this level. Skip.
        i++; continue;
      }
      const cl = t._classified || (t._classified = classifyLine(t.text));

      if (cl === null) { i++; continue; }   // dropped (animation, wait, etc.)

      if (cl.type === '_option') {
        // Collect a CHOICES group: consecutive _option at same indent.
        // Drop-commands (Play/Wait/etc.) at this indent are skipped without
        // splitting the group — MBU's <<#Simple>> blocks routinely interleave
        // animation with options.
        const items = [];
        const choicesSrcLine = t.srcLine;
        while (i < tokens.length && tokens[i].indent === baseIndent) {
          const tt = tokens[i];
          const cc = tt._classified || (tt._classified = classifyLine(tt.text));
          if (cc === null) { i++; continue; }
          if (cc.type !== '_option') break;
          i++;
          const bodyStart = i;
          while (i < tokens.length && tokens[i].indent > baseIndent) i++;
          const bodyTokens = tokens.slice(bodyStart, i);
          const optBaseIndent = bodyTokens.length ? bodyTokens[0].indent : baseIndent + 4;
          const body = build(bodyTokens, optBaseIndent);
          items.push({ text: cc.text, cond: cc.cond, body, srcLine: tt.srcLine });
        }
        out.push({ type: 'choices', items, srcLine: choicesSrcLine });
        continue;
      }

      if (cl.type === '_simpleStart') {
        // Drop wrapper; the next consecutive options at this indent will form a group.
        i++;
        continue;
      }
      if (cl.type === '_simpleEnd') {
        // Drop wrapper.
        i++;
        continue;
      }

      if (cl.type === '_ifStart') {
        // Collect until matching _ifEnd at any indent (we treat it as block).
        i++;
        const blockStart = i;
        let depth = 1;
        while (i < tokens.length && depth > 0) {
          const tt = tokens[i];
          const cc = tt._classified || (tt._classified = classifyLine(tt.text));
          if (cc !== null) {
            if (cc.type === '_ifStart') depth++;
            else if (cc.type === '_ifEnd') {
              depth--;
              if (depth === 0) break;
            }
          }
          i++;
        }
        const inner = tokens.slice(blockStart, i);
        // Skip the _ifEnd token
        if (i < tokens.length) i++;
        // Use the inner block's own minimum indent as base
        const innerBase = inner.length ? Math.min(...inner.map(t => t.indent)) : baseIndent;
        const thenBody = build(inner, innerBase);
        out.push({
          type: 'if',
          cond: cl.negate ? '!(' + cl.cond + ')' : cl.cond,
          then: thenBody,
          else: [],
          srcLine: t.srcLine
        });
        continue;
      }
      if (cl.type === '_ifEnd') {
        // Stray; ignore.
        i++;
        continue;
      }

      cl.srcLine = t.srcLine;
      out.push(cl);
      i++;
    }
    return out;
  }

  // Walk a Stmt array and collect labels with their address path.
  // path is an array of indices: [0] means top-level index 0;
  // [3, 'choices', 1, 0] means top-level[3].items[1].body[0].
  function indexLabels(stmts, path, map) {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      const here = path.concat(i);
      if (s.type === 'label') {
        if (!map.has(s.name)) map.set(s.name, here);
      }
      if (s.type === 'choices') {
        for (let j = 0; j < s.items.length; j++) {
          indexLabels(s.items[j].body, here.concat(['option', j]), map);
        }
      } else if (s.type === 'if') {
        indexLabels(s.then, here.concat('then'), map);
        if (s.else) indexLabels(s.else, here.concat('else'), map);
      }
    }
  }

  function parseNodeBody(body) {
    const tokens = tokenize(body);
    const minIndent = tokens.length ? Math.min(...tokens.map(t => t.indent)) : 0;
    const statements = build(tokens, minIndent);
    const labels = new Map();
    indexLabels(statements, [], labels);
    return { statements, labels };
  }

  // Parse a whole MBU per-locale JSON ([{title, body, ...}, ...]) into a
  // Project { nodes, globalLabels, parseErrors }.
  // Per-node parse failures are caught so one bad node doesn't kill the load;
  // they're collected into `parseErrors` for the UI to surface.
  function parseProject(jsonArray) {
    const nodes = new Map();
    const globalLabels = new Map();
    const parseErrors = [];
    // 保留原 JSON array 作為 raw source（翻譯流程要用：BuildSO + WriteJson）
    const rawNodes = Array.isArray(jsonArray) ? jsonArray : [];
    // nodeIndex 對應 v2 的 SO node index（UID 計算的一部分）
    let nodeIndex = -1;
    for (const node of jsonArray) {
      nodeIndex++;
      if (!node.title || node.body == null) continue;
      try {
        const parsed = parseNodeBody(node.body);
        nodes.set(node.title, {
          title: node.title,
          body: node.body,
          statements: parsed.statements,
          labels: parsed.labels,
          nodeIndex,
        });
        for (const labelName of parsed.labels.keys()) {
          if (!globalLabels.has(labelName)) globalLabels.set(labelName, node.title);
        }
      } catch (e) {
        console.error(`[parser] node "${node.title}" failed:`, e);
        parseErrors.push({ title: node.title, error: e.message });
        // Still register an empty node so it shows in the list
        nodes.set(node.title, {
          title: node.title,
          body: node.body,
          statements: [{ type: 'line', speaker: '', text: `[解析失敗: ${e.message}]` }],
          labels: new Map(),
          nodeIndex,
        });
      }
    }
    return { nodes, globalLabels, parseErrors, rawNodes };
  }

  global.YarnParser = { parseNodeBody, parseProject, stripMarkup, markupToSafeHtml };
})(typeof window !== 'undefined' ? window : globalThis);
