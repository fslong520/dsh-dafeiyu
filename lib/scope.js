/**
 * Privacy scopes, ported from `astrbot_plugin_dafeiyu/dafeiyu_policy.py:144-243`
 * (pure functions, zero dependencies).
 *
 * Porting notes (DSH adaptation):
 * - QQ ids become DSH ids: `selfId` -> the agent/session host id, `groupId` ->
 *   the DSH session id, `userId` -> the DSH user identity.
 * - The `qq:` prefix becomes `dsh:`; the hashing scheme (sha256 truncated to
 *   8/16 hex characters) is kept byte-for-byte so the privacy property — no raw
 *   id ever reaches rsrs — survives the port unchanged.
 * - A group conversation maps to a shared DSH session: memories are written per
 *   member inside a session bucket, and reads must fan out over every member
 *   plus the legacy member-less bucket (see `sessionRecallScopes`).
 *
 * Source anchors: dafeiyu_policy.py:148 (bot_tag), :153 (hashed_id),
 * :158 (derive_scope), :181 (legacy_group_scope), :197 (group_recall_scopes);
 * person_hash is dafeiyu_state.py:48 (sha256[:16], same as hashed_id).
 */
import { createHash } from 'node:crypto';

/** Scope modes accepted by `deriveScope`. */
export const SCOPE_MODES = Object.freeze(['per_conversation', 'per_user', 'global']);

function sha(text, length) {
	return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, length);
}

/** 8 hex characters identifying one bot/agent account (dafeiyu_policy.py:148). */
export function botTag(selfId) {
	return sha(selfId, 8);
}

/** 16 hex characters standing in for a raw id (dafeiyu_policy.py:153). */
export function hashedId(value) {
	return sha(value, 16);
}

/**
 * Stable person key: sha256(user_id)[:16] (dafeiyu_state.py:48).
 * Kept as its own name because stored member buckets reference it directly.
 */
export function personHash(userId) {
	return sha(userId, 16);
}

/**
 * Build the rsrs `--project` value for one conversation
 * (dafeiyu_policy.py:158, QQ ids replaced by DSH ids).
 *
 * The result never contains a raw id: agent accounts and conversations are
 * both hashed. `per_user` deliberately collapses private and shared-session
 * chats onto one user scope (documented privacy trade-off); `global` ignores
 * the agent account entirely.
 *
 * A session scope carries a member segment (`session:<sid>:<uid>`) so every
 * participant of a shared session gets their own bucket. The read side must
 * therefore merge the legacy member-less session bucket (`session:<sid>`) as
 * well, otherwise memories written before this change become invisible.
 */
export function deriveScope(scopeMode, selfId, sessionId = '', userId = '') {
	if (scopeMode === 'global') return 'dsh:global';
	const bot = botTag(selfId);
	if (scopeMode === 'per_user') return `dsh:${bot}:user:${hashedId(userId)}`;
	if (String(sessionId ?? '') !== '') {
		return `dsh:${bot}:session:${hashedId(sessionId)}:${hashedId(userId)}`;
	}
	return `dsh:${bot}:private:${hashedId(userId)}`;
}

/**
 * The member-less session bucket used before per-member scoping
 * (dafeiyu_policy.py:181). Only `per_conversation` ever wrote session buckets;
 * `per_user` and `global` return null.
 */
export function legacySessionScope(scopeMode, selfId, sessionId) {
	if (scopeMode !== 'per_conversation') return null;
	return `dsh:${botTag(selfId)}:session:${hashedId(sessionId)}`;
}

/**
 * Every scope a shared-session read must cover, best bucket first
 * (dafeiyu_policy.py:197).
 *
 * A read of a shared session must see every participant, not just the sender:
 * memories are written per member (`session:<sid>:<uid>`), so a read that only
 * used the caller's own bucket would hide what everybody else remembered. The
 * list holds one bucket per member plus the member-less legacy bucket for
 * history written before per-member scoping.
 *
 * `memberHashes` is the participants as `personHash` values. When it is empty
 * (a caller that has not resolved members yet) the current sender is used, so
 * the function never degrades to legacy-only. Private sessions and the
 * `per_user`/`global` modes write exactly one scope and are unchanged.
 *
 * @param {{isShared?: boolean, scope?: string, scopeMode?: string, selfId?: string,
 *          sessionId?: string, userId?: string}} turn
 * @param {string[]} [memberHashes]
 */
export function sessionRecallScopes(turn, memberHashes = null) {
	if (!turn?.isShared) return [turn?.scope ?? ''];

	const legacy = legacySessionScope(
		turn.scopeMode ?? 'per_conversation',
		turn.selfId,
		turn.sessionId,
	);
	if (!legacy) {
		// per_user / global never wrote per-member session buckets at all, so
		// there is exactly one scope to read and no fan-out to do.
		return [turn.scope];
	}

	const bot = botTag(turn.selfId);
	const sid = hashedId(turn.sessionId);
	const members = (memberHashes ?? [])
		.map((item) => String(item ?? '').trim())
		.filter((item) => item !== '');
	// The caller must always be able to read their own bucket, even when a
	// caller resolved members without listing themselves.
	const own = personHash(turn.userId);
	if (!members.includes(own)) members.unshift(own);

	const scopes = [];
	const seen = new Set();
	for (const member of members) {
		const scope = `dsh:${bot}:session:${sid}:${member}`;
		if (seen.has(scope)) continue;
		seen.add(scope);
		scopes.push(scope);
	}

	scopes.push(legacy);
	return scopes;
}

/**
 * Resolve the rsrs `--project` value for one host call (DSH wiring helper).
 *
 * - `mode='legacy'` (the default): no derivation — the historical plain
 *   `config.project` behaviour, byte-identical to before the wiring existed.
 * - any other mode: `deriveScope()` with the DSH agent/session id playing both
 *   the session (QQ group) and user seat, because DSH is a single-user desktop
 *   host — one agent id identifies the conversation and its sole participant.
 * - no `agentId` at all (a caller without runtime identity): falls back to
 *   `fallbackProject` rather than inventing a bucket.
 *
 * @param {{mode?: string, agentId?: string, fallbackProject?: string}} options
 * @returns {string|undefined} value for `--project` (`undefined` = unset)
 */
export function deriveProject({ mode = 'legacy', agentId = '', fallbackProject = '' } = {}) {
	const fallback = typeof fallbackProject === 'string' && fallbackProject.trim() !== ''
		? fallbackProject.trim()
		: undefined;
	if (mode !== 'per_conversation' && mode !== 'per_user' && mode !== 'global') return fallback;
	const id = String(agentId ?? '').trim();
	if (id === '') return fallback;
	// DSH session id replaces the QQ group id; the sole participant shares it.
	return deriveScope(mode, id, id, id) || undefined;
}
