#!/usr/bin/env node
// One-off codemod that turns the API's CommonJS modules into ES modules
// (docs/ARCHITECTURE.md, "PR 0"). It edits source text by AST positions so
// formatting and comments survive, and prints everything it could not convert
// so a human finishes those by hand.
//
//   node scripts/codemods/cjs-to-esm.mjs [--dry-run] <files...>
//
// Rules:
// - top-level `const x = require('m')` / `const { a, b: c } = require('m')`
//   become imports. How a package is imported is decided by loading it the way
//   ESM will: named imports when the ES namespace really has the names,
//   otherwise a default import plus destructuring.
// - relative specifiers get their real extension; a relative module bound to
//   one identifier becomes a namespace import (converted modules only have
//   named exports).
// - `module.exports = { ... }` becomes `export { ... }`.
// - `require.main === module` -> `import.meta.main`, `__dirname`/`__filename`
//   -> `import.meta.dirname`/`filename`, `require.resolve(rel)` ->
//   `fileURLToPath(new URL(rel, import.meta.url))`.
// - In test files, relative requires that follow a top-level process.env write
//   become `await import()` so the module still sees the environment it saw
//   under CommonJS (static imports would be hoisted above the writes).
// - Any require() left inside a function keeps working through createRequire
//   in tests; in source files it is reported.

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter((arg) => !arg.startsWith('--')).map((file) => path.resolve(file));
const builtins = new Set(builtinModules);
const report = [];
const namespaceCache = new Map();

function isBuiltin(spec) {
  return spec.startsWith('node:') || builtins.has(spec);
}

async function loadNamespace(spec) {
  // Packages are hoisted to the root node_modules, so importing from here
  // resolves them exactly as the API's ES modules will (the "import" export
  // condition, not the CommonJS "main").
  if (!namespaceCache.has(spec)) namespaceCache.set(spec, await import(spec).catch(() => null));
  return namespaceCache.get(spec);
}

function resolveRelative(spec, fromFile) {
  if (/\.(?:js|mjs|cjs|mts|json)$/.test(spec)) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(`${base}.js`)) return `${spec}.js`;
  if (fs.existsSync(path.join(base, 'index.js'))) return `${spec}/index.js`;
  throw new Error(`cannot resolve ${spec} from ${fromFile}`);
}

function camel(spec) {
  const name = spec.replace(/^node:/, '').replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
  return `${name}Module`;
}

function requireSpec(node) {
  if (!node || !ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return null;
  const [arg] = node.arguments;
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function bindingText(pattern, sourceText) {
  // { a, b: c } in destructuring -> import specifiers "a, b as c"
  const parts = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken || element.initializer || !ts.isIdentifier(element.name)) return null;
    const local = element.name.text;
    const imported = element.propertyName ? element.propertyName.getText() : local;
    parts.push(imported === local ? local : `${imported} as ${local}`);
  }
  return parts;
}

async function convert(file) {
  const original = fs.readFileSync(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const text = original.replace(/\r\n/g, '\n');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const isTest = /[\\/]test[\\/]/.test(file);
  const edits = [];
  const notes = [];
  let envWritten = false;
  let needsFileURLToPath = false;
  const replace = (start, end, value) => edits.push({ start, end, value });

  const statementRange = (statement) => {
    const start = statement.getStart(source);
    let end = statement.getEnd();
    if (text[end] === '\n') end += 1;
    return [start, end];
  };

  for (const statement of source.statements) {
    // 'use strict'
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use strict') {
      const [start, end] = statementRange(statement);
      replace(start, end + (text[end] === '\n' ? 1 : 0), '');
      continue;
    }

    if (
      ts.isExpressionStatement(statement)
      && ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = statement.expression.left.getText(source);
      if (/^process\.env\b/.test(left)) envWritten = true;
      if (left === 'module.exports' && ts.isObjectLiteralExpression(statement.expression.right)) {
        const specifiers = [];
        const extras = [];
        for (const property of statement.expression.right.properties) {
          if (ts.isShorthandPropertyAssignment(property)) specifiers.push(property.name.text);
          else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
            const exported = property.name.getText(source);
            const local = property.initializer.text;
            specifiers.push(local === exported ? local : `${local} as ${exported}`);
          } else if (ts.isPropertyAssignment(property)) {
            const exported = property.name.getText(source);
            extras.push(`export const ${exported} = ${property.initializer.getText(source)};`);
          } else {
            notes.push(`unsupported export property: ${property.getText(source).slice(0, 60)}`);
          }
        }
        const [start, end] = statementRange(statement);
        const body = specifiers.length > 4
          ? `export {\n  ${specifiers.join(',\n  ')}\n};\n`
          : `export { ${specifiers.join(', ')} };\n`;
        replace(start, end, `${extras.map((line) => `${line}\n`).join('')}${specifiers.length ? body : ''}`);
        continue;
      }
      if (/^(module\.)?exports\./.test(left)) notes.push(`exports.* assignment at line ${source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1}`);
    }

    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const declaration = statement.declarationList.declarations[0];
      let init = declaration.initializer;
      let property = null;
      if (init && ts.isPropertyAccessExpression(init) && requireSpec(init.expression)) {
        property = init.name.text;
        init = init.expression;
      }
      const spec = requireSpec(init);
      if (spec) {
        const [start, end] = statementRange(statement);
        const relative = spec.startsWith('.');
        const json = spec.endsWith('.json');
        const target = relative ? resolveRelative(spec, file) : spec;
        const dynamic = isTest && relative && envWritten;
        const namespace = relative ? null : await loadNamespace(spec);
        let out;
        if (ts.isIdentifier(declaration.name)) {
          const local = declaration.name.text;
          if (property) {
            if (dynamic) out = `const ${local} = (await import('${target}')).${property};`;
            else if (relative || isBuiltin(spec) || (namespace && property in namespace)) out = `import { ${property === local ? local : `${property} as ${local}`} } from '${target}';`;
            else out = `import ${camel(spec)} from '${target}';\nconst ${local} = ${camel(spec)}.${property};`;
          } else if (json) {
            out = dynamic
              ? `const ${local} = (await import('${target}', { with: { type: 'json' } })).default;`
              : `import ${local} from '${target}' with { type: 'json' };`;
          } else if (relative || spec.startsWith('@voice-room/')) {
            out = dynamic ? `const ${local} = await import('${target}');` : `import * as ${local} from '${target}';`;
          } else {
            out = `import ${local} from '${target}';`;
          }
        } else if (ts.isObjectBindingPattern(declaration.name)) {
          const parts = bindingText(declaration.name, source);
          if (!parts) {
            notes.push(`complex destructuring of ${spec}`);
            continue;
          }
          const names = declaration.name.elements.map((element) => (element.propertyName || element.name).getText(source));
          const named = relative || isBuiltin(spec) || (namespace && names.every((name) => name in namespace));
          if (property) {
            // const { a } = require('m').prop: destructure the property of the module.
            out = dynamic
              ? `const ${declaration.name.getText(source)} = (await import('${target}')).${property};`
              : `import * as ${camel(spec)} from '${target}';
const ${declaration.name.getText(source)} = ${camel(spec)}.${property};`;
          } else if (dynamic) {
            out = `const ${declaration.name.getText(source)} = await import('${target}');`;
          } else if (named) {
            out = parts.length > 3
              ? `import {\n  ${parts.join(',\n  ')}\n} from '${target}';`
              : `import { ${parts.join(', ')} } from '${target}';`;
          } else {
            out = `import ${camel(spec)} from '${target}';\nconst ${declaration.name.getText(source)} = ${camel(spec)};`;
          }
        } else {
          notes.push(`unsupported require binding for ${spec}`);
          continue;
        }
        replace(start, end, `${out}\n`);
        continue;
      }
    }
  }

  // Expression-level rewrites anywhere in the file.
  let leftoverRequire = false;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.left.getText(source) === 'require.main'
      && node.right.getText(source) === 'module'
    ) {
      replace(node.getStart(source), node.getEnd(), 'import.meta.main');
      return;
    }
    if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename')) {
      replace(node.getStart(source), node.getEnd(), node.text === '__dirname' ? 'import.meta.dirname' : 'import.meta.filename');
      return;
    }
    if (
      ts.isCallExpression(node)
      && node.expression.getText(source) === 'require.resolve'
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text.startsWith('.')
    ) {
      const target = resolveRelative(node.arguments[0].text, file);
      replace(node.getStart(source), node.getEnd(), `fileURLToPath(new URL('${target}', import.meta.url))`);
      needsFileURLToPath = true;
      return;
    }
    if (requireSpec(node) && !edits.some((edit) => edit.start <= node.getStart(source) && edit.end >= node.getEnd())) {
      leftoverRequire = true;
      notes.push(`nested require('${requireSpec(node)}') at line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  edits.sort((a, b) => b.start - a.start);
  let output = text;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);

  const header = [];
  if (needsFileURLToPath && !/import \{[^}]*\bfileURLToPath\b[^}]*\} from 'node:url'/.test(output)) {
    header.push("import { fileURLToPath } from 'node:url';");
  }
  if (leftoverRequire && isTest) {
    header.push("import { createRequire } from 'node:module';", 'const require = createRequire(import.meta.url);');
  }
  if (header.length) {
    // after the leading comment block, before the first import/statement
    const firstStatement = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).statements[0];
    const at = firstStatement ? firstStatement.getStart() : 0;
    output = `${output.slice(0, at)}${header.join('\n')}\n${output.slice(at)}`;
  }
  output = output.replace(/^\n+/, '');

  if (notes.length) report.push({ file: path.relative(process.cwd(), file), notes });
  if (!dryRun && output !== text) fs.writeFileSync(file, output.replace(/\n/g, eol));
}

for (const file of files) await convert(file);
for (const entry of report) {
  process.stdout.write(`${entry.file}\n${entry.notes.map((note) => `  - ${note}`).join('\n')}\n`);
}
process.stdout.write(`${files.length} files processed${dryRun ? ' (dry run)' : ''}, ${report.length} with notes\n`);
