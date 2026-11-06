/** Managed self-note block: markers, well-formedness, file IO, section text. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
	MAX_BRIEF,
	SELFNOTE_END,
	SELFNOTE_START,
	assertWellFormed,
	clampBrief,
	extractManagedBlock,
	readBrief,
	replaceManagedBlock,
	sectionText,
	selfnoteFile,
	stripManagedBlock,
	writeBrief,
} from '../lib/selfnote.js';

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-note-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('markers match the AstrBot managed-block contract', () => {
	assert.equal(SELFNOTE_START, '<!-- dafeiyu:selfnote:start -->');
	assert.equal(SELFNOTE_END, '<!-- dafeiyu:selfnote:end -->');
	assert.equal(MAX_BRIEF, 300);
});

test('extract reads the inner brief and returns empty for a missing block', () => {
	const text = `persona line\n\n${SELFNOTE_START}\n  Prefer concise answers.  \n${SELFNOTE_END}\nfooter`;
	assert.equal(extractManagedBlock(text), 'Prefer concise answers.');
	assert.equal(extractManagedBlock('no block here'), '');
	assert.equal(extractManagedBlock(undefined), '');
});

test('well-formedness rejects nested, reversed and half-open markers', () => {
	const nested = `${SELFNOTE_START}\na\n${SELFNOTE_START}\nb\n${SELFNOTE_END}\n${SELFNOTE_END}`;
	assert.throws(() => assertWellFormed(nested), /nested or repeated/);
	assert.throws(() => assertWellFormed(`${SELFNOTE_END}\n${SELFNOTE_START}`), /reversed/);
	assert.throws(() => assertWellFormed(`${SELFNOTE_START}\nopen only`), /never closed/);
	assert.throws(() => assertWellFormed(`${SELFNOTE_END}\nclose only`), /never opened/);
	assert.doesNotThrow(() => assertWellFormed('plain text'));
});

test('replace swaps the managed block and keeps surrounding text', () => {
	const text = `head\n\n${SELFNOTE_START}\nold\n${SELFNOTE_END}\n\ntail`;
	const next = replaceManagedBlock(text, 'new brief');
	assert.equal(next.includes('new brief'), true);
	assert.equal(next.includes('old'), false);
	assert.equal(next.startsWith('head'), true);
	assert.equal(next.endsWith('tail'), true);
	assert.equal(extractManagedBlock(next), 'new brief');

	// Appends when there is no block yet, so a fresh file works.
	const fresh = replaceManagedBlock('', 'brand new');
	assert.equal(extractManagedBlock(fresh), 'brand new');
});

test('strip removes only the managed block', () => {
	const text = `head\n${SELFNOTE_START}\nnote\n${SELFNOTE_END}\ntail`;
	// The markers go; the surrounding lines stay exactly where they were.
	assert.equal(stripManagedBlock(text), 'head\n\ntail');
	assert.equal(stripManagedBlock('untouched'), 'untouched');
	assert.throws(() => stripManagedBlock(`${SELFNOTE_START}\nx`), /never closed/);
});

test('clampBrief trims to the cap and marks the cut', () => {
	assert.equal(clampBrief('  short  '), 'short');
	assert.equal(clampBrief('x'.repeat(10), 5).length, 5);
	assert.ok(clampBrief('y'.repeat(10), 5).endsWith('…'));
	assert.equal(clampBrief('', 0).length > 0, false);
	// Default cap.
	assert.equal(clampBrief('z'.repeat(400)).length, MAX_BRIEF);
});

test('file round-trip: writeBrief persists 0600 and readBrief recovers the brief', () => {
	const dir = tempDir();
	const file = selfnoteFile(dir);
	assert.equal(file, path.join(dir, 'selfnote.md'));

	assert.equal(readBrief(file), '', 'missing file yields an empty brief');
	writeBrief(file, 'Keep answers short; mention the deploy checklist.');
	assert.equal(readBrief(file), 'Keep answers short; mention the deploy checklist.');
	assert.equal(statSync(file).mode & 0o777, 0o600);

	// Rewriting replaces the block instead of stacking a second one.
	writeBrief(file, 'Revised note.');
	assert.equal(readBrief(file), 'Revised note.');
	const onDisk = readFileSync(file, 'utf8');
	assert.equal(onDisk.split(SELFNOTE_START).length - 1, 1);

	// A corrupt file never breaks the reader.
	const other = path.join(dir, 'broken.md');
	writeFileSync(other, `${SELFNOTE_START}\nunclosed`, { mode: 0o600 });
	assert.equal(readBrief(other), '');
});

test('sectionText renders literal text and drops an empty note', () => {
	assert.equal(sectionText(''), '');
	assert.equal(sectionText('   '), '');
	const text = sectionText('use {{braces}} literally');
	assert.equal(text, `${SELFNOTE_START}\nuse {{braces}} literally\n${SELFNOTE_END}`);
	assert.equal(sectionText('x'.repeat(500)).length <= MAX_BRIEF + SELFNOTE_START.length + SELFNOTE_END.length + 2, true);
});
