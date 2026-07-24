#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const HAN_PATTERN = /\p{Script=Han}/gu;
const ALLOWED_CATEGORIES = new Set([
  'USER_AUTHORED',
  'AI_OR_PLAYER_SPEECH_OR_CHAT',
  'STORED_HISTORICAL_RECORD',
]);
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);
const ROOT_FILES = [
  'index.css',
  'index.html',
  'src/App.tsx',
  'src/constants.ts',
  'src/types.ts',
];
const ROOT_DIRECTORIES = ['src/components', 'src/hooks', 'src/services', 'src/styles'];
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const parseArguments = argv => {
  const options = { allowlist: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allowlist') options.allowlist = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.allowlist) throw new Error('Usage: audit-ui-copy.mjs --allowlist <path> [--output <path>]');
  return options;
};

const collectSourceFiles = async root => {
  const files = [...ROOT_FILES];
  const visit = async relativeDirectory => {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relativePath);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !TEST_FILE_PATTERN.test(entry.name)) files.push(relativePath);
    }
  };
  for (const directory of ROOT_DIRECTORIES) await visit(directory);
  return files.sort();
};

const nodeText = node => {
  if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) return node.text;
  if (ts.isJsxText(node)) return node.getText();
  return null;
};

const identifierText = node => {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
};

const findingContext = node => {
  let current = node;
  let symbol = null;
  let property = null;
  let attribute = null;
  while (current) {
    if (!attribute && ts.isJsxAttribute(current)) attribute = identifierText(current.name);
    if (!property && ts.isPropertyAssignment(current)) property = identifierText(current.name);
    if (!symbol && ts.isVariableDeclaration(current)) symbol = identifierText(current.name);
    if (!symbol && ts.isFunctionDeclaration(current)) symbol = identifierText(current.name);
    if (!symbol && ts.isMethodDeclaration(current)) symbol = identifierText(current.name);
    current = current.parent;
  }
  return { symbol, property, attribute };
};

const codepointsFor = text => Array.from(new Set(
  [...text.matchAll(HAN_PATTERN)].map(match => `U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
)).sort();

const scanSourceFile = async (root, relativePath) => {
  const sourceText = await readFile(path.join(root, relativePath), 'utf8');
  if (relativePath.endsWith('.html') || relativePath.endsWith('.css')) {
    const withoutComments = relativePath.endsWith('.css')
      ? sourceText.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\r\n]/g, ' '))
      : sourceText.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\r\n]/g, ' '));
    return withoutComments.split('\n').flatMap((text, index) => {
      if (!HAN_PATTERN.test(text)) return [];
      HAN_PATTERN.lastIndex = 0;
      return [{
        path: relativePath,
        line: index + 1,
        column: 1,
        symbol: null,
        property: null,
        attribute: null,
        codepoints: codepointsFor(text),
      }];
    });
  }
  const scriptKind = relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  const visit = node => {
    const text = nodeText(node);
    if (text && HAN_PATTERN.test(text)) {
      HAN_PATTERN.lastIndex = 0;
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({
        path: relativePath,
        line: position.line + 1,
        column: position.character + 1,
        ...findingContext(node),
        codepoints: codepointsFor(text),
      });
    }
    HAN_PATTERN.lastIndex = 0;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
};

const validateAllowlist = allowlist => {
  if (allowlist?.version !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error('Allowlist must have version 1 and an entries array.');
  }
  const ids = new Set();
  for (const entry of allowlist.entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Allowlist entry id is missing or duplicated: ${entry.id ?? '<missing>'}`);
    ids.add(entry.id);
    if (!ALLOWED_CATEGORIES.has(entry.category)) throw new Error(`Invalid category for ${entry.id}: ${entry.category}`);
    if (!entry.path || (!entry.line && !entry.symbol && !entry.selector)) {
      throw new Error(`Allowlist entry ${entry.id} needs path plus line, symbol, or selector.`);
    }
    if (!entry.provenance || !entry.reason) throw new Error(`Allowlist entry ${entry.id} needs provenance and reason.`);
  }
};

const entryMatches = (entry, finding) => {
  if (entry.runtimeOnly || entry.path !== finding.path) return false;
  if (entry.line && entry.line !== finding.line) return false;
  if (entry.symbol && entry.symbol !== finding.symbol) return false;
  if (entry.property && entry.property !== finding.property) return false;
  if (entry.attribute && entry.attribute !== finding.attribute) return false;
  return true;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const root = process.cwd();
  const allowlist = JSON.parse(await readFile(path.resolve(root, options.allowlist), 'utf8'));
  validateAllowlist(allowlist);

  const files = await collectSourceFiles(root);
  const findings = (await Promise.all(files.map(file => scanSourceFile(root, file)))).flat();
  const usage = Object.fromEntries(allowlist.entries.map(entry => [entry.id, 0]));
  const allowed = [];
  const unallowlisted = [];
  const ambiguous = [];

  for (const finding of findings) {
    const matches = allowlist.entries.filter(entry => entryMatches(entry, finding));
    if (matches.length === 1) {
      usage[matches[0].id] += 1;
      allowed.push({ ...finding, allowlistId: matches[0].id, category: matches[0].category });
    } else if (matches.length === 0) unallowlisted.push(finding);
    else ambiguous.push({ ...finding, allowlistIds: matches.map(entry => entry.id) });
  }

  const unusedStaticEntries = allowlist.entries
    .filter(entry => !entry.runtimeOnly && usage[entry.id] === 0)
    .map(entry => entry.id);
  const passed = unallowlisted.length === 0 && ambiguous.length === 0 && unusedStaticEntries.length === 0;
  const result = {
    schema: 'aiwerewolf/ui-copy-audit/v1',
    passed,
    scannedFiles: files.length,
    findingCounts: {
      total: findings.length,
      allowed: allowed.length,
      unallowlisted: unallowlisted.length,
      ambiguous: ambiguous.length,
    },
    categoryCounts: Object.fromEntries([...ALLOWED_CATEGORIES].map(category => [
      category,
      allowed.filter(finding => finding.category === category).length,
    ])),
    unallowlisted,
    ambiguous,
    allowlistUsage: usage,
    unusedStaticEntries,
    runtimeEntries: allowlist.entries.filter(entry => entry.selector).map(entry => ({
      id: entry.id,
      path: entry.path,
      selector: entry.selector,
      category: entry.category,
      provenance: entry.provenance,
      reason: entry.reason,
    })),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await writeFile(path.resolve(root, options.output), serialized, 'utf8');
  process.stdout.write(serialized);
  process.exitCode = passed ? 0 : 1;
};

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
