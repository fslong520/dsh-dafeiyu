/** Granite checkpoint and weekly encoder script detection. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
	ENCODER_SCRIPT_REL,
	GRANITE_REQUIRED,
	detectEncoderScript,
	detectGranite,
	encoderStatus,
} from '../lib/granite.js';

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-granite-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function installModel(dir, { pooling = 'dir' } = {}) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, 'model.safetensors'), 'x');
	writeFileSync(path.join(dir, 'config.json'), '{}');
	if (pooling === 'dir') mkdirSync(path.join(dir, '1_Pooling'), { recursive: true });
	else if (pooling === 'file') writeFileSync(path.join(dir, '1_Pooling'), 'x');
}

function installScript(repo) {
	const script = path.join(repo, ENCODER_SCRIPT_REL);
	mkdirSync(path.dirname(script), { recursive: true });
	writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n');
	return script;
}

test('an empty directory reports every required file as missing', () => {
	const dir = tempDir();
	const result = detectGranite(dir);
	assert.equal(result.installed, false);
	assert.deepEqual(result.missing, [...GRANITE_REQUIRED]);
	assert.deepEqual(result.found, []);
	assert.equal(result.modelDir, dir);
});

test('a complete checkpoint is detected', () => {
	const dir = tempDir();
	installModel(dir);
	const result = detectGranite(dir);
	assert.equal(result.installed, true);
	assert.deepEqual(result.missing, []);
	assert.deepEqual(result.found, [...GRANITE_REQUIRED]);
});

test('1_Pooling may be a directory or a file', () => {
	const asFile = tempDir();
	installModel(asFile, { pooling: 'file' });
	assert.equal(detectGranite(asFile).installed, true);

	const missingPooling = tempDir();
	installModel(missingPooling);
	rmSync(path.join(missingPooling, '1_Pooling'), { recursive: true, force: true });
	const partial = detectGranite(missingPooling);
	assert.equal(partial.installed, false);
	assert.deepEqual(partial.missing, ['1_Pooling']);
});

test('a missing or empty model dir is not an error', () => {
	assert.equal(detectGranite('').installed, false);
	assert.equal(detectGranite('/definitely/not/here').installed, false);
});

test('the weekly encoder script is detected in the respire checkout', () => {
	const repo = tempDir();
	assert.equal(detectEncoderScript(repo).exists, false);
	const script = installScript(repo);
	const found = detectEncoderScript(repo);
	assert.equal(found.exists, true);
	assert.equal(found.script, script);
	assert.equal(detectEncoderScript('').exists, false);
});

test('encoderStatus requires both the model and the script', () => {
	const repo = tempDir();
	const model = tempDir();
	installModel(model);

	const withoutScript = encoderStatus({ graniteModelDir: model, respireRepo: repo });
	assert.equal(withoutScript.ready, false);
	assert.match(withoutScript.reason, /encoder script/);

	installScript(repo);
	const ready = encoderStatus({ graniteModelDir: model, respireRepo: repo });
	assert.equal(ready.ready, true);
	assert.equal(ready.reason, undefined);

	const noModel = encoderStatus({ graniteModelDir: tempDir(), respireRepo: repo });
	assert.equal(noModel.ready, false);
	assert.match(noModel.reason, /granite model incomplete/);
});
