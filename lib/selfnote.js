/**
 * Managed self-note block for the system prompt.
 *
 * Ported from `astrbot_plugin_dafeiyu/dafeiyu_selfnote.py:71-220` (the block
 * markers, well-formedness rules and replace/strip logic), re-expressed for
 * DSH: the note lives in a host-owned file under `stateDir` and the plugin
 * injects it as a `systemPrompt.section` provider evaluated at each assembly
 * (see `lib/index.js`), so an updated note shows up on the next prompt build
 * without a restart.
 *
 * Only the text between SELFNOTE_START and SELFNOTE_END is managed; anything
 * outside the markers is preserved verbatim. The full narrative record stays
 * in rsrs — this file only carries the brief (<= 300 chars by default).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FILE_MODE, ensureDir } from './state.js';

/** Managed-block markers (dafeiyu_selfnote.py:71-72). */
export const SELFNOTE_START = '<!-- dafeiyu:selfnote:start -->';
export const SELFNOTE_END = '<!-- dafeiyu:selfnote:end -->';
/** Default cap for the brief (DEFAULT_SELFNOTE.max_brief_chars = 300). */
export const MAX_BRIEF = 300;

/** Locate the managed block; returns `{start, end}` or null. */
export function findBlock(text) {
	const value = String(text ?? '');
	const start = value.indexOf(SELFNOTE_START);
	if (start < 0) return null;
	const inner = value.indexOf(SELFNOTE_END, start + SELFNOTE_START.length);
	if (inner < 0) return null;
	return { start, end: inner + SELFNOTE_END.length };
}

/**
 * Reject malformed marker nesting (dafeiyu_selfnote.py:_ensure_well_formed).
 * @throws {Error} on nested, reversed or partially open markers.
 */
export function assertWellFormed(text) {
	const value = String(text ?? '');
	const count = (needle) => value.split(needle).length - 1;
	if (count(SELFNOTE_START) > 1 || count(SELFNOTE_END) > 1) {
		throw new Error('selfnote: nested or repeated managed-block markers');
	}
	const start = value.indexOf(SELFNOTE_START);
	const end = value.indexOf(SELFNOTE_END);
	if (start >= 0 && end < 0) throw new Error('selfnote: managed block opened but never closed');
	if (end >= 0 && start < 0) throw new Error('selfnote: managed block closed but never opened');
	if (start >= 0 && end < start) throw new Error('selfnote: managed-block markers reversed');
	return value;
}

/** Inner brief of the managed block, or `''` when there is none. */
export function extractManagedBlock(text) {
	const value = assertWellFormed(text);
	const block = findBlock(value);
	if (!block) return '';
	return value.slice(block.start + SELFNOTE_START.length, block.end - SELFNOTE_END.length).trim();
}

/** Render the managed block for one brief. */
export function renderBlock(brief) {
	return `${SELFNOTE_START}\n${String(brief ?? '').trim()}\n${SELFNOTE_END}`;
}

/**
 * Replace (or append) the managed block, keeping surrounding text
 * (dafeiyu_selfnote.py:replace_managed_block).
 */
export function replaceManagedBlock(text, brief, maxBrief = MAX_BRIEF) {
	assertWellFormed(text);
	const value = String(text ?? '');
	const inner = clampBrief(brief, maxBrief);
	const block = renderBlock(inner);
	const found = findBlock(value);
	if (found) {
		return `${value.slice(0, found.start)}${block}${value.slice(found.end)}`;
	}
	if (value.trim() === '') return `${block}\n`;
	return `${value.replace(/\s*$/, '')}\n\n${block}\n`;
}

/** Remove the managed block, leaving the rest untouched. */
export function stripManagedBlock(text) {
	assertWellFormed(text);
	const value = String(text ?? '');
	const found = findBlock(value);
	if (!found) return value;
	return `${value.slice(0, found.start)}${value.slice(found.end)}`.trim();
}

/** Trim a brief to `maxBrief` characters (never truncates short notes). */
export function clampBrief(brief, maxBrief = MAX_BRIEF) {
	const text = String(brief ?? '').trim();
	const cap = Number.isFinite(maxBrief) && maxBrief > 0 ? Math.trunc(maxBrief) : MAX_BRIEF;
	return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`;
}

/** Default note file: `<stateDir>/selfnote.md`. */
export function selfnoteFile(stateDir) {
	return path.join(stateDir, 'selfnote.md');
}

/**
 * Read the managed brief from disk. Missing, empty or malformed files yield
 * `''` — a broken note must never break prompt assembly.
 */
export function readBrief(file) {
	try {
		return extractManagedBlock(readFileSync(file, 'utf8'));
	} catch {
		return '';
	}
}

/** Write a brief to disk (file 0600 inside a 0700 dir); returns the file. */
export function writeBrief(file, brief, { maxBrief = MAX_BRIEF } = {}) {
	ensureDir(path.dirname(file));
	let current = '';
	try {
		current = readFileSync(file, 'utf8');
	} catch {
		/* new file */
	}
	const next = replaceManagedBlock(current, brief, maxBrief);
	writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`, { mode: FILE_MODE });
	return file;
}

/**
 * Remove the managed block from disk (file kept, markers gone). A missing file
 * is a no-op. Returns the file.
 */
export function clearBrief(file) {
	let current = '';
	try {
		current = readFileSync(file, 'utf8');
	} catch {
		return file;
	}
	const next = stripManagedBlock(current);
	writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`, { mode: FILE_MODE });
	return file;
}

/**
 * The prompt-section payload for one brief: `''` when empty (the renderer
 * drops empty sections), otherwise the managed block marked as literal text so
 * `{{…}}` in a note never becomes a prompt variable.
 */
export function sectionText(brief, maxBrief = MAX_BRIEF) {
	const text = clampBrief(brief, maxBrief);
	if (text === '') return '';
	return `${SELFNOTE_START}\n${text}\n${SELFNOTE_END}`;
}
