/**
 * Granite / encoder detection.
 *
 * The plugin never loads the model itself: it only checks whether the IBM
 * Granite Embedding 97M R2 checkpoint and the respire weekly encoder script are
 * present, and reports that in `status` and to the job scheduler.
 */
import { statSync } from 'node:fs';
import path from 'node:path';

/** Files/directories that must exist inside the Granite model directory. */
export const GRANITE_REQUIRED = Object.freeze(['model.safetensors', 'config.json', '1_Pooling']);

/** Path of the weekly encoder script inside the respire repo. */
export const ENCODER_SCRIPT_REL = path.join('scripts', 'encoder', 'weekly_encoder.sh');

function statOf(target) {
	try {
		return statSync(target);
	} catch {
		return undefined;
	}
}

function isFile(target) {
	const info = statOf(target);
	return Boolean(info?.isFile());
}

function isDir(target) {
	const info = statOf(target);
	return Boolean(info?.isDirectory());
}

/**
 * Detect the Granite checkpoint.
 *
 * `1_Pooling` may be a directory (the sentence-transformers layout) or a file,
 * so both are accepted.
 *
 * @returns {{modelDir: string, installed: boolean, missing: string[], found: string[]}}
 */
export function detectGranite(modelDir) {
	const dir = typeof modelDir === 'string' ? modelDir : '';
	const missing = [];
	const found = [];
	for (const entry of GRANITE_REQUIRED) {
		const target = dir === '' ? '' : path.join(dir, entry);
		const present = entry === '1_Pooling' ? isDir(target) || isFile(target) : isFile(target);
		if (present) found.push(entry);
		else missing.push(entry);
	}
	return { modelDir: dir, installed: missing.length === 0, missing, found };
}

/**
 * Detect the weekly encoder script in the respire checkout.
 * @returns {{repo: string, script: string, exists: boolean}}
 */
export function detectEncoderScript(repoDir) {
	const repo = typeof repoDir === 'string' ? repoDir : '';
	const script = repo === '' ? '' : path.join(repo, ENCODER_SCRIPT_REL);
	return { repo, script, exists: script !== '' && isFile(script) };
}

/**
 * Combined encoder readiness used by `status` and the weekly job.
 * @returns {{model: object, script: object, ready: boolean, reason?: string}}
 */
export function encoderStatus({ graniteModelDir, respireRepo } = {}) {
	const model = detectGranite(graniteModelDir);
	const script = detectEncoderScript(respireRepo);
	let reason;
	if (!model.installed) reason = `granite model incomplete (missing ${model.missing.join(', ')})`;
	else if (!script.exists) reason = 'weekly encoder script not found';
	return { model, script, ready: model.installed && script.exists, ...(reason ? { reason } : {}) };
}
