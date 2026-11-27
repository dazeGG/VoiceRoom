// Only literal module edges can authorize narrowing; never load/evaluate source from a PR.
// Keep string tokens intact so comments and quoted examples cannot create dependencies.
const quoted = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y;
const trivia = /(?:\s+|\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/)+/y;
const word = /[\w$]+/y;
const regexLiteral = /\/(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\\r\n])*\]|[^/\\[\r\n])+\/[a-z]*/y;

function tokens(source: string): string[] {
  let i = 0;
  const out: string[] = [];
  const consume = (pattern: RegExp) => {
    pattern.lastIndex = i;
    const match = pattern.exec(source);
    if (match) i = pattern.lastIndex;
    return match?.[0];
  };

  function code(interpolation = false) {
    let braces = 0;
    while (i < source.length) {
      if (consume(trivia)) continue;
      if (source.startsWith('/*', i)) throw new Error('unterminated comment');
      const ch = source.charAt(i);
      if (ch === '"' || ch === "'") {
        const literal = consume(quoted);
        if (!literal) throw new Error('unterminated string');
        out.push(literal);
      } else if (ch === '`') {
        const start = i++;
        let computed = false;
        while (i < source.length && source[i] !== '`') {
          if (source[i] === '\\') i += 2;
          else if (source.startsWith('${', i)) {
            computed = true;
            out.push('template');
            i += 2;
            code(true);
          } else i++;
        }
        if (i >= source.length) throw new Error('unterminated template');
        i++;
        out.push(computed ? 'template' : source.slice(start, i));
      } else if (ch === '/') {
        const before = i;
        const regex = consume(regexLiteral);
        const previous = out.at(-1) ?? ';';
        if (
          regex &&
          (/^(?:[=(,:[!&|?;]|return|throw|case)$/.test(previous) || (previous === '>' && out.at(-2) === '='))
        )
          out.push('regex');
        else {
          // Division and a regex after a statement can look alike without a full
          // parser. Do not let quotes/comment delimiters inside one hide an edge.
          if (regex && /['"`\\[\]*{}]/.test(regex)) throw new Error('ambiguous regular expression');
          i = before + 1;
          out.push('/');
        }
      } else {
        const token = consume(word) ?? source.charAt(i++);
        if (token === '{') braces++;
        if (token === '}' && --braces < 0 && interpolation) return;
        out.push(token);
      }
    }
    if (interpolation) throw new Error('unterminated template expression');
  }
  code();
  return out;
}

function literal(token: string | undefined) {
  if (!token || !['"', "'", '`'].includes(token.charAt(0))) return undefined;
  if (token.includes('\\')) throw new Error('escaped module specifier');
  return token.slice(1, -1);
}

function scriptImports(source: string) {
  const found: string[] = [];
  const stream = tokens(source);
  for (const [i, token] of stream.entries()) {
    const next = stream[i + 1];
    if (token === 'from' || token === 'import') {
      const spec = literal(next);
      if (spec !== undefined) found.push(spec); // imports, re-exports, side-effect imports
    }
    if ((token === 'import' || token === 'require') && next === '(') {
      const spec = literal(stream[i + 2]);
      if (!spec || ![')', ','].includes(stream[i + 3] ?? '')) throw new Error('nonliteral module specifier');
      found.push(spec);
    }
    if (token === 'import' && next === '.' && stream[i + 2] === 'meta' && stream[i + 4]?.startsWith('glob'))
      throw new Error('module glob');
  }
  return found;
}

export function moduleImports(path: string, source: string) {
  if (!path.endsWith('.vue')) return scriptImports(source);
  const found: string[] = [];
  // Vue units can have both a normal and a setup script. External SFC blocks
  // are file dependencies too, even when there is no inline script to scan.
  for (const match of source.matchAll(/<(?:script|template|style)\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi))
    if (match[2]) found.push(match[2]);
  const other = source.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (_, script: string) => {
    found.push(...scriptImports(script));
    return '';
  });
  if (/<script\b|\b(?:import|require)\s*\(/i.test(other)) throw new Error('unresolved Vue block');
  return found;
}
