#!/usr/bin/env node

/**
 * Antigravity AST & Symbol Indexer (Fast Codebase Discovery)
 *
 * Lightweight, zero-dependency symbol extractor for JS/TS and Python.
 * Extracts functions, classes, methods, and export signatures with line numbers
 * in <5ms, eliminating token-heavy full-file reads during agent exploration.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Scan a single file for symbols.
 */
export function indexFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py'].includes(ext)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const symbols = [];

    const isPython = ext === '.py';

    if (isPython) {
        // Python extraction: def, class, async def
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const classMatch = line.match(/^(\s*)class\s+([A-Za-z0-9_]+)(\s*\(.*?\))?:/);
            if (classMatch) {
                symbols.push({
                    type: 'class',
                    name: classMatch[2],
                    line: lineNum,
                    indent: classMatch[1].length
                });
                continue;
            }

            const defMatch = line.match(/^(\s*)(async\s+)?def\s+([A-Za-z0-9_]+)\s*\((.*?)\):/);
            if (defMatch) {
                const indent = defMatch[1].length;
                symbols.push({
                    type: indent > 0 ? 'method' : 'function',
                    name: defMatch[3],
                    signature: `(${defMatch[4]})`,
                    line: lineNum,
                    indent
                });
            }
        }
    } else {
        // JS/TS extraction: function, class, export, const fn
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Class
            const classMatch = line.match(/^(\s*)(export\s+)?(default\s+)?class\s+([A-Za-z0-9_]+)(\s+extends\s+[A-Za-z0-9_]+)?/);
            if (classMatch) {
                symbols.push({
                    type: 'class',
                    name: classMatch[4],
                    line: lineNum,
                    indent: classMatch[1].length
                });
                continue;
            }

            // Function declaration
            const funcMatch = line.match(/^(\s*)(export\s+)?(async\s+)?function\s*([A-Za-z0-9_]*)\s*\((.*?)\)/);
            if (funcMatch && funcMatch[4]) {
                symbols.push({
                    type: 'function',
                    name: funcMatch[4],
                    signature: `(${funcMatch[5]})`,
                    line: lineNum,
                    indent: funcMatch[1].length
                });
                continue;
            }

            // Const/let arrow or function expression
            const constFuncMatch = line.match(/^(\s*)(export\s+)?(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(async\s+)?(\(.*?\)|[A-Za-z0-9_]+)\s*=>/);
            if (constFuncMatch) {
                symbols.push({
                    type: 'function',
                    name: constFuncMatch[4],
                    signature: `${constFuncMatch[6]} =>`,
                    line: lineNum,
                    indent: constFuncMatch[1].length
                });
                continue;
            }

            // CommonJS / ES exports
            const exportMatch = line.match(/^(\s*)exports\.([A-Za-z0-9_]+)\s*=/);
            if (exportMatch) {
                symbols.push({
                    type: 'export',
                    name: exportMatch[2],
                    line: lineNum,
                    indent: exportMatch[1].length
                });
            }
        }
    }

    return {
        file: filePath,
        language: isPython ? 'python' : 'javascript/typescript',
        totalLines: lines.length,
        symbols
    };
}

/**
 * Traverse directories recursively up to maxDepth.
 */
export function scanTarget(targetPath, depth = 0, maxDepth = 3) {
    const stats = fs.statSync(targetPath);
    if (stats.isFile()) {
        const res = indexFile(targetPath);
        return res ? [res] : [];
    }

    if (!stats.isDirectory() || depth > maxDepth) return [];

    const base = path.basename(targetPath);
    if (['node_modules', '.git', '.venv', '__pycache__', 'dist'].includes(base)) {
        return [];
    }

    let results = [];
    const entries = fs.readdirSync(targetPath);
    for (const e of entries) {
        const full = path.join(targetPath, e);
        try {
            results = results.concat(scanTarget(full, depth + 1, maxDepth));
        } catch {}
    }
    return results;
}

/**
 * CLI Entrypoint Runner
 */
export function runCli(cliArgs = process.argv.slice(2)) {
    const options = {
        target: null,
        filter: null,
        json: false,
        maxDepth: 3
    };

    for (let i = 0; i < cliArgs.length; i++) {
        const a = cliArgs[i];
        if (a === '--filter' && cliArgs[i + 1]) options.filter = cliArgs[++i].toLowerCase();
        else if (a === '--json') options.json = true;
        else if (a === '--max-depth' && cliArgs[i + 1]) options.maxDepth = parseInt(cliArgs[++i], 10);
        else if (!options.target && !a.startsWith('--')) options.target = a;
    }

    if (!options.target) {
        console.log('Usage: node scripts/ast_query.mjs <file_or_dir> [--filter <name>] [--json]');
        process.exit(0);
    }

    const resolved = path.resolve(options.target);
    if (!fs.existsSync(resolved)) {
        console.error(`Error: Path does not exist: ${resolved}`);
        process.exit(1);
    }

    const fileResults = scanTarget(resolved, 0, options.maxDepth);

    if (options.json) {
        console.log(JSON.stringify(fileResults, null, 2));
        process.exit(0);
    }

    console.log(`\n=== AST SYMBOL MAP: ${options.target} ===`);
    let totalSymbols = 0;

    for (const res of fileResults) {
        let filtered = res.symbols;
        if (options.filter) {
            filtered = filtered.filter(s => s.name.toLowerCase().includes(options.filter));
        }
        if (filtered.length === 0) continue;

        totalSymbols += filtered.length;
        console.log(`\n📄 ${path.relative(process.cwd(), res.file)} (${res.totalLines} lines)`);
        for (const sym of filtered) {
            const typeTag = `[${sym.type.toUpperCase()}]`.padEnd(11);
            const sig = sym.signature ? ` ${sym.signature}` : '';
            const prefix = sym.indent > 0 ? '  ↳ ' : '  • ';
            console.log(`${prefix}${typeTag} ${sym.name}${sig} (line ${sym.line})`);
        }
    }

    console.log(`\nFound ${totalSymbols} symbols across ${fileResults.length} file(s).\n`);
}

// Auto-run if executed directly as a script
const isDirectRun = Boolean(
    process.argv[1] && (
        process.argv[1].endsWith('ast_query.mjs') ||
        (import.meta.url && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
    )
);

if (isDirectRun) {
    runCli();
}
