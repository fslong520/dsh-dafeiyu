// client/build.mjs — zero-dependency client build for @fslong/dsh-dafeiyu.
//
// Reads client/source.js, substitutes build placeholders, syntax-checks the
// result as a classic script (the __ModuleLoader__ envelope), and writes
// lib/client.js. Wired to `pnpm run build` via package.json scripts.build.
//
//   node client/build.mjs   (or: pnpm run build / npm run build)
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourcePath = path.join(root, 'client', 'source.js');
const svgPath = path.join(root, 'assets', 'fish-logo.svg');
const outPath = path.join(root, 'lib', 'client.js');

const source = readFileSync(sourcePath, 'utf8');
const svg = readFileSync(svgPath, 'utf8');
const pathMatch = svg.match(/\sd="([^"]+)"/);
if (!pathPathMatchGuard(pathMatch)) {
	console.error('[dafeiyu-build] ERROR: assets/fish-logo.svg has no path d="…" attribute');
	process.exit(1);
}
const fishPath = pathMatch[1];

// Function replacers: replacement text is inserted verbatim (no $-patterns).
let out = source
	.replace('__DAFEIYU_VERSION__', () => String(pkg.version))
	.replace('__DAFEIYU_BUILD_TIME__', () => new Date().toISOString())
	.replace('__FISH_PATH_EMBED__', () => fishPath);

for (const token of ['__DAFEIYU_VERSION__', '__DAFEIYU_BUILD_TIME__', '__FISH_PATH_EMBED__']) {
	if (out.includes(token)) {
		console.error(`[dafeiyu-build] ERROR: placeholder ${token} still present after substitution`);
		process.exit(1);
	}
}

// Classic-script syntax check (envelope is not an ES module: no import/export).
try {
	new vm.Script(out, { filename: 'lib/client.js' });
} catch (error) {
	console.error(`[dafeiyu-build] ERROR: syntax check failed: ${error.message}`);
	process.exit(1);
}

mkdirSync(path.join(root, 'lib'), { recursive: true });
const banner = [
	'// GENERATED FILE — do not edit.',
	'// Source: client/source.js  |  Builder: client/build.mjs',
	`// package: ${pkg.name}@${pkg.version}  |  built: ${new Date().toISOString()}`,
	'',
].join('\n');
writeFileSync(outPath, banner + out);

const bytes = statSync(outPath).size;
console.log(`[dafeiyu-build] ok  lib/client.js  ${bytes} bytes  (${pkg.name}@${pkg.version})`);
console.log(`[dafeiyu-build] source client/source.js  fish-embed ${fishPath.length} chars  syntax check passed`);

function pathPathMatchGuard(match) {
	return Boolean(match && match[1] && match[1].length > 100);
}
