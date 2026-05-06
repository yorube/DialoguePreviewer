// MBU yarn runtime. Walks parsed AST, presents lines/choices, tracks vars.
//
// Usage:
//   const rt = new YarnRuntime(project);
//   rt.start('Start');
//   rt.tick();          // advance until next user-visible event
//   rt.current          // {kind:'line', speaker, text} | {kind:'choices', items}
//                       // or null when ended (rt.ended === true)
//   rt.advance();       // call after rendering a line, to continue
//   rt.choose(idx);     // call after user clicks a choice
//
// Events (overridable):
//   rt.onVarChange(name, value)
//   rt.onJump(nodeTitle)

(function (global) {

  // --- expression eval -------------------------------------------------------

  // Two-phase substitution.
  //   Phase 1: `$Name` → its value as a JS literal.
  //   Phase 2: bare `Name` (no `$`) → if declared in vars table, substitute as
  //            variable; otherwise treat as MBU's loose unquoted-string idiom
  //            (spec 5.3) and emit a string literal.
  // Substituted literals go through a placeholder pipe to keep them opaque to
  // phase-2's identifier scan (so e.g. a substituted "MainScreen" string body
  // isn't re-scanned as another identifier).
  function substituteVars(expr, vars) {
    const RESERVED = /^(true|false|null|undefined|NaN|Infinity)$/i;
    const placeholders = [];
    const place = lit => {
      placeholders.push(lit);
      return `${placeholders.length - 1}`;
    };
    const valToLit = v => {
      if (v === undefined) return '0';
      if (typeof v === 'string') return JSON.stringify(v);
      return String(v);
    };
    let s = expr.replace(/\$[A-Za-z_]\w*/g, m => place(valToLit(vars[m])));
    s = s.replace(/(?<!["'A-Za-z_$\d.])([A-Za-z_][\w]*)(?!\s*\()/g, (m, name) => {
      if (RESERVED.test(name)) return m;
      const $name = '$' + name;
      if ($name in vars) return place(valToLit(vars[$name]));
      return place(JSON.stringify(name));
    });
    return s.replace(/(\d+)/g, (_, i) => placeholders[+i]);
  }

  // Single `=` → `==` (avoid >=, <=, ==, !=).
  function normalizeEqualities(expr) {
    return expr.replace(/(^|[^=<>!])=(?!=)/g, (m, p1) => p1 + '==');
  }

  function evalExpr(expr, vars) {
    if (expr == null) return undefined;
    const sub = substituteVars(expr, vars);
    const norm = normalizeEqualities(sub);
    try {
      // eslint-disable-next-line no-new-func
      return Function('"use strict"; return (' + norm + ');')();
    } catch (e) {
      // Fallback: if the original expression has no operators, treat it as a
      // bare string literal. MBU sources frequently do
      //   <<Set($DLState, 球球去上廁所回來啦)>>
      // i.e. unquoted strings. The Convert-MBUYarnToOfficial.ps1 auto-quotes
      // these for official Yarn; we do the equivalent here at eval time.
      const trimmed = String(expr).trim();
      if (!/[()<>=!+\-*/%&|]/.test(trimmed) && !trimmed.startsWith('$')) {
        return trimmed;
      }
      console.warn('[runtime] expr eval failed:', expr, '→', norm, e.message);
      return undefined;
    }
  }

  function evalBool(expr, vars) {
    return Boolean(evalExpr(expr, vars));
  }

  // --- variable defaults from 變數紀錄 node ---------------------------------

  // Scan a node body for `//public <type> <name> = <default>` comments and
  // returns a map of $name → default value.
  function readDeclaredDefaults(body) {
    const out = {};
    if (!body) return out;
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      // Form: //public bool|float|int|single|string Name = value
      let m = line.match(/\/\/\s*(?:public\s+)?(bool|float|int|single|string)\s+\$?([A-Za-z_]\w*)\s*=\s*([^;\/]+?)\s*(?:\/\/|\/\*|$)/i);
      if (m) {
        const type = m[1].toLowerCase();
        const name = '$' + m[2];
        const raw = m[3].trim();
        let val;
        if (type === 'bool') val = /^true$/i.test(raw);
        else if (type === 'string') val = raw.replace(/^["']|["']$/g, '');
        else val = parseFloat(raw) || 0;
        out[name] = val;
        continue;
      }
      // Form: <<declare $name = default>>  (official Yarn)
      m = line.match(/<<\s*declare\s+\$?([A-Za-z_]\w*)\s*=\s*([^>]+?)\s*>>/);
      if (m) {
        const name = '$' + m[1];
        const raw = m[2].trim();
        let val;
        if (/^true$/i.test(raw)) val = true;
        else if (/^false$/i.test(raw)) val = false;
        else if (/^-?\d/.test(raw)) val = parseFloat(raw);
        else val = raw.replace(/^["']|["']$/g, '');
        out[name] = val;
      }
    }
    return out;
  }

  // --- path → stack ---------------------------------------------------------

  // Decode a label path (from parser.js) into a stack of frames such that
  // ticking the stack from top-of-stack will continue *after* the label.
  // A frame is { stmts, idx } where idx is the next statement to execute.
  function buildStackToPath(topStmts, path) {
    const stack = [];
    let stmts = topStmts;
    let i = 0;
    while (i < path.length) {
      const idx = path[i++];
      if (i >= path.length) {
        stack.push({ stmts, idx: idx + 1 });
        break;
      }
      const sel = path[i];
      if (sel === 'option') {
        const optIdx = path[i + 1];
        i += 2;
        stack.push({ stmts, idx: idx + 1 });
        stmts = stmts[idx].items[optIdx].body;
      } else if (sel === 'then' || sel === 'else') {
        i += 1;
        stack.push({ stmts, idx: idx + 1 });
        stmts = stmts[idx][sel];
      } else {
        stack.push({ stmts, idx: idx + 1 });
        break;
      }
    }
    return stack;
  }

  // --- runtime --------------------------------------------------------------

  class YarnRuntime {
    constructor(project) {
      this.project = project;
      this.vars = {};
      this.stack = [];
      this.currentNodeTitle = null;
      this.current = null;        // pending event for UI
      this.ended = false;
      // historyLen ticks up on every line / choice / chose event. Snapshot
      // captures it; restore truncates back to it. The host owns the actual
      // transcript DOM, so we don't need to remember the events themselves.
      this.historyLen = 0;
      // Hooks (no-ops by default)
      this.onVarChange = () => {};
      this.onJump = () => {};
    }

    // Initialize variables from the 變數紀錄 node, if present.
    primeVarsFromDeclarations() {
      const declNode = this.project.nodes.get('變數紀錄');
      if (declNode) {
        const defaults = readDeclaredDefaults(declNode.body);
        Object.assign(this.vars, defaults);
      }
    }

    start(nodeTitle, overrides) {
      this.vars = {};
      this.primeVarsFromDeclarations();
      // Apply user var overrides BEFORE the first tick so early Set/If see them.
      if (overrides) {
        for (const [k, v] of overrides) this.vars[k] = v;
      }
      this.stack = [];
      this.historyLen = 0;
      this.ended = false;
      this.current = null;
      this._enterNode(nodeTitle);
      this.tick();
    }

    _enterNode(title) {
      const node = this.project.nodes.get(title);
      if (!node) {
        console.warn('[runtime] missing node:', title);
        this.ended = true;
        return;
      }
      this.currentNodeTitle = title;
      this.stack = [{ stmts: node.statements, idx: 0 }];
      this.onJump(title);
    }

    _gotoLabel(name) {
      // Try current node first
      const cur = this.project.nodes.get(this.currentNodeTitle);
      if (cur && cur.labels.has(name)) {
        const path = cur.labels.get(name);
        this.stack = buildStackToPath(cur.statements, path);
        return;
      }
      // Cross-node
      const targetTitle = this.project.globalLabels.get(name);
      if (targetTitle) {
        this._enterNode(targetTitle);
        const node = this.project.nodes.get(targetTitle);
        const path = node.labels.get(name);
        if (path) this.stack = buildStackToPath(node.statements, path);
        return;
      }
      console.warn('[runtime] unresolved label:', name);
      this.ended = true;
    }

    // Advance internal state until we have a user-visible event in `this.current`,
    // or `this.ended` becomes true.
    tick() {
      this.current = null;
      let safety = 100000;
      while (safety-- > 0) {
        if (this.ended) return;
        if (!this.stack.length) {
          this.ended = true;
          return;
        }
        const frame = this.stack[this.stack.length - 1];
        if (frame.idx >= frame.stmts.length) {
          this.stack.pop();
          continue;
        }
        const s = frame.stmts[frame.idx];
        frame.idx++;

        switch (s.type) {
          case 'line': {
            const evt = {
              kind: 'line',
              speaker: s.speaker,
              text: s.text,
              isCommunicator: !!s.isCommunicator,
              isAnonymous: !!s.isAnonymous,
              srcLine: s.srcLine,
            };
            this.current = evt;
            this.historyLen++;
            return;
          }

          case 'choices': {
            const visible = s.items
              .map((it, i) => ({ ...it, _origIdx: i }))
              .filter(it => !it.cond || evalBool(it.cond, this.vars));
            if (!visible.length) {
              // No visible choice → fall through
              continue;
            }
            this.current = {
              kind: 'choices',
              items: visible.map(it => ({ text: it.text, _body: it.body, srcLine: it.srcLine })),
              srcLine: s.srcLine,
            };
            this.historyLen++;
            return;
          }

          case 'set':
            try {
              const val = evalExpr(s.expr, this.vars);
              this.vars[s.variable] = val;
              this.onVarChange(s.variable, val);
            } catch (e) {
              console.warn('[runtime] set failed:', s, e);
            }
            continue;

          case 'goto':
            this._gotoLabel(s.label);
            continue;

          case 'condGoto':
            if (evalBool(s.cond, this.vars)) this._gotoLabel(s.label);
            continue;

          case 'label':
            // No-op marker
            continue;

          case 'if':
            // Push a frame for the branch we take
            if (evalBool(s.cond, this.vars)) {
              this.stack.push({ stmts: s.then, idx: 0 });
            } else if (s.else && s.else.length) {
              this.stack.push({ stmts: s.else, idx: 0 });
            }
            continue;

          case 'end':
            this.ended = true;
            return;

          case 'wait':
            // No-op for preview
            continue;

          case 'unknown':
            // Could surface as a warning row; for now silently drop
            continue;

          default:
            console.warn('[runtime] unhandled stmt:', s);
            continue;
        }
      }
      console.error('[runtime] tick safety abort');
      this.ended = true;
    }

    advance() {
      if (this.ended) return;
      if (this.current && this.current.kind === 'line') {
        this.current = null;
        this.tick();
      }
    }

    choose(idx) {
      if (this.ended) return;
      if (!this.current || this.current.kind !== 'choices') return;
      const item = this.current.items[idx];
      if (!item) return;
      this.historyLen++;
      // Push the option body as a new frame
      this.stack.push({ stmts: item._body, idx: 0 });
      this.current = null;
      this.tick();
    }

    // Capture enough state to restore from. AST arrays (stmts, items._body)
    // are shared by reference because they are immutable.
    snapshot() {
      return {
        currentNodeTitle: this.currentNodeTitle,
        stack: this.stack.map(f => ({ stmts: f.stmts, idx: f.idx })),
        vars: { ...this.vars },
        current: this.current && {
          ...this.current,
          items: this.current.items && this.current.items.map(it => ({ ...it }))
        },
        ended: this.ended,
        historyLen: this.historyLen
      };
    }

    restore(s) {
      this.currentNodeTitle = s.currentNodeTitle;
      this.stack = s.stack.map(f => ({ stmts: f.stmts, idx: f.idx }));
      this.vars = { ...s.vars };
      this.current = s.current && {
        ...s.current,
        items: s.current.items && s.current.items.map(it => ({ ...it }))
      };
      this.ended = s.ended;
      this.historyLen = s.historyLen;
    }
  }

  global.YarnRuntime = YarnRuntime;
  // Used by ui.js's vars panel to populate declared defaults before any
  // node has been started, so translators can pre-set branch flags.
  global.YarnRuntime.readDeclaredDefaults = readDeclaredDefaults;
})(typeof window !== 'undefined' ? window : globalThis);
