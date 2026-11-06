/** Scope privacy model ported from dafeiyu_policy.py:144-243. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
	botTag,
	deriveProject,
	deriveScope,
	hashedId,
	legacySessionScope,
	personHash,
	sessionRecallScopes,
} from '../lib/scope.js';

const sha = (value, length) => createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, length);

test('botTag / hashedId / personHash match the sha256 truncation of the source', () => {
	assert.equal(botTag('agent-1'), sha('agent-1', 8));
	assert.equal(hashedId('sess-42'), sha('sess-42', 16));
	assert.equal(personHash('user-7'), sha('user-7', 16));
	// person_hash (dafeiyu_state.py:48) is the same truncation as hashed_id.
	assert.equal(personHash('user-7'), hashedId('user-7'));
	// Empty input still hashes (never an empty string reaching rsrs).
	assert.equal(botTag('').length, 8);
	assert.equal(hashedId(undefined).length, 16);
});

test('deriveScope never contains a raw id', () => {
	const cases = [
		deriveScope('per_conversation', 'agent-1', 'sess-9', 'user-7'),
		deriveScope('per_user', 'agent-1', 'sess-9', 'user-7'),
		deriveScope('global', 'agent-1', 'sess-9', 'user-7'),
		deriveScope('per_conversation', 'agent-1', '', 'user-7'),
	];
	for (const scope of cases) {
		assert.equal(scope.includes('agent-1'), false, scope);
		assert.equal(scope.includes('sess-9'), false, scope);
		assert.equal(scope.includes('user-7'), false, scope);
	}
});

test('deriveScope mirrors the three documented modes', () => {
	assert.equal(deriveScope('global', 'a1'), 'dsh:global');
	assert.equal(
		deriveScope('per_user', 'a1', 's1', 'u1'),
		`dsh:${botTag('a1')}:user:${hashedId('u1')}`,
	);
	// Shared session (QQ group analogue): member segment present.
	assert.equal(
		deriveScope('per_conversation', 'a1', 's1', 'u1'),
		`dsh:${botTag('a1')}:session:${hashedId('s1')}:${hashedId('u1')}`,
	);
	// Private session: no session segment.
	assert.equal(
		deriveScope('per_conversation', 'a1', '', 'u1'),
		`dsh:${botTag('a1')}:private:${hashedId('u1')}`,
	);
	// Deterministic: same inputs, same bucket.
	assert.equal(deriveScope('per_conversation', 'a1', 's1', 'u1'), deriveScope('per_conversation', 'a1', 's1', 'u1'));
	// Different sessions with the same user never collide.
	assert.notEqual(
		deriveScope('per_conversation', 'a1', 's1', 'u1'),
		deriveScope('per_conversation', 'a1', 's2', 'u1'),
	);
});

test('legacySessionScope only exists for per_conversation', () => {
	assert.equal(
		legacySessionScope('per_conversation', 'a1', 's1'),
		`dsh:${botTag('a1')}:session:${hashedId('s1')}`,
	);
	assert.equal(legacySessionScope('per_user', 'a1', 's1'), null);
	assert.equal(legacySessionScope('global', 'a1', 's1'), null);
});

test('private / per_user / global reads stay single-scope', () => {
	const priv = {
		isShared: false,
		scope: deriveScope('per_conversation', 'a1', '', 'u1'),
		scopeMode: 'per_conversation',
		selfId: 'a1',
		sessionId: '',
		userId: 'u1',
	};
	assert.deepEqual(sessionRecallScopes(priv), [priv.scope]);

	const perUser = { ...priv, scope: deriveScope('per_user', 'a1', 's1', 'u1'), scopeMode: 'per_user', isShared: true };
	assert.deepEqual(sessionRecallScopes(perUser, ['aaaa']), [perUser.scope]);

	const global = { ...priv, scope: 'dsh:global', scopeMode: 'global', isShared: true };
	assert.deepEqual(sessionRecallScopes(global, ['aaaa']), ['dsh:global']);
});

test('shared-session reads fan out over members, own bucket first, legacy last', () => {
	const turn = {
		isShared: true,
		scopeMode: 'per_conversation',
		selfId: 'a1',
		sessionId: 's1',
		userId: 'u1',
		scope: deriveScope('per_conversation', 'a1', 's1', 'u1'),
	};
	const own = personHash('u1');
	const other = personHash('u2');
	const scopes = sessionRecallScopes(turn, [other]);

	assert.equal(scopes.length, 3);
	assert.equal(scopes[0], `dsh:${botTag('a1')}:session:${hashedId('s1')}:${own}`);
	assert.equal(scopes[1], `dsh:${botTag('a1')}:session:${hashedId('s1')}:${other}`);
	assert.equal(scopes[2], legacySessionScope('per_conversation', 'a1', 's1'));
	// The caller's own bucket is added even when the member list omits it.
	assert.equal(scopes[0].includes(own), true);
});

test('shared-session reads deduplicate members and tolerate an empty member list', () => {
	const turn = {
		isShared: true,
		scopeMode: 'per_conversation',
		selfId: 'a1',
		sessionId: 's1',
		userId: 'u1',
		scope: 'x',
	};
	const own = personHash('u1');
	const dupe = sessionRecallScopes(turn, [own, own, '']);
	assert.equal(dupe.length, 2, JSON.stringify(dupe));
	assert.equal(dupe[0], `dsh:${botTag('a1')}:session:${hashedId('s1')}:${own}`);
	assert.equal(dupe[1], legacySessionScope('per_conversation', 'a1', 's1'));

	// No member list at all: still never degrades to legacy-only.
	const solo = sessionRecallScopes(turn);
	assert.equal(solo.length, 2);
	assert.equal(solo[0].endsWith(`:${own}`), true);
});

/* ---------------- deriveProject: dafeiyu.scope.mode wiring ---------------- */

test('deriveProject legacy mode keeps the plain config.project behaviour', () => {
	assert.equal(deriveProject({ mode: 'legacy', agentId: 's1', fallbackProject: 'proj' }), 'proj');
	assert.equal(deriveProject({ mode: 'legacy', agentId: 's1', fallbackProject: '' }), undefined);
	// Default mode is legacy when unset.
	assert.equal(deriveProject({ fallbackProject: 'proj' }), 'proj');
	assert.equal(deriveProject({ mode: 'legacy', fallbackProject: 'proj' }), 'proj');
});

test('deriveProject non-legacy modes derive a hashed dsh scope from the agent id', () => {
	// DSH session id replaces the QQ group id; the sole participant shares it.
	assert.equal(
		deriveProject({ mode: 'per_conversation', agentId: 's1', fallbackProject: 'proj' }),
		deriveScope('per_conversation', 's1', 's1', 's1'),
	);
	assert.equal(
		deriveProject({ mode: 'per_user', agentId: 's1', fallbackProject: 'proj' }),
		deriveScope('per_user', 's1', 's1', 's1'),
	);
	assert.equal(deriveProject({ mode: 'global', agentId: 's1', fallbackProject: 'proj' }), 'dsh:global');
	// The derived value never contains the raw agent id.
	const derived = deriveProject({ mode: 'per_conversation', agentId: 'agent-raw-9', fallbackProject: 'proj' });
	assert.equal(derived.includes('agent-raw-9'), false);
	// Different agents never share a per_conversation bucket.
	assert.notEqual(
		deriveProject({ mode: 'per_conversation', agentId: 's1' }),
		deriveProject({ mode: 'per_conversation', agentId: 's2' }),
	);
	// ...but a global bucket is shared by design.
	assert.equal(
		deriveProject({ mode: 'global', agentId: 's1' }),
		deriveProject({ mode: 'global', agentId: 's2' }),
	);
});

test('deriveProject falls back without an agent identity or with an unknown mode', () => {
	// No runtime identity (bare call): legacy fallback, never an invented bucket.
	assert.equal(deriveProject({ mode: 'per_conversation', agentId: '', fallbackProject: 'proj' }), 'proj');
	assert.equal(deriveProject({ mode: 'per_conversation', agentId: undefined, fallbackProject: '' }), undefined);
	// Unknown mode behaves like legacy (defensive, config already validates).
	assert.equal(deriveProject({ mode: 'nonsense', agentId: 's1', fallbackProject: 'proj' }), 'proj');
});
