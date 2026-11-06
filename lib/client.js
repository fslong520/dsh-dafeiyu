// GENERATED FILE — do not edit.
// Source: client/source.js  |  Builder: client/build.mjs
// package: @fslong/dsh-dafeiyu@0.1.0  |  built: 2026-11-06T07:11:19.954Z
// @fslong/dsh-dafeiyu — browser half (T3b).
//
// Three UI pieces, all on documented public extension seats:
//   1. conversation.hero.brand.mark — 常驻大肥鱼形象（FISH_LOGO SVG 游动动画，零 wasm）
//   2. conversation.header          — ON AIR 状态条（待播/直播中指示灯＋干活内容字幕）
//   3. sidebar.right.pane.tab       — 右栏「大肥鱼·进化」面板（两段式注册，仿 dsh-cabinet-mode）
//
// Plain JavaScript, no build framework: this file is the source; client/build.mjs
// validates it and emits lib/client.js (placeholders substituted). React comes
// from the frozen browser module table; @deepseek-ai/dsh-client-ui-primitives
// (FISH_LOGO constants) is required defensively with an embedded fallback path
// extracted from the same host build (assets/fish-logo.svg).
//
// Data channels (see README §client 数据源):
//   - remote 'api-session/status' (sessionId, running:boolean) → 活动状态灯
//   - sidebar tab slot props (useSession/useSessions/useSessionStatus) → 任务时间线
//   - 记忆量/能力清单等 host 数据【未接通】— panel 明示占位，不造假数。
window.__ModuleLoader__.load({
	id: '@fslong/dsh-dafeiyu',
	factory(require) {
		'use strict';
		const React = require('react');
		const h = React.createElement;

		// ---- build placeholders (substituted by client/build.mjs) ----
		const VERSION = '0.1.0';
		const BUILD_TIME = '2026-11-06T07:11:19.953Z';
		const FISH_EMBED_PATH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z';
		const FISH_EMBED_VIEWBOX = { width: 23.16, height: 17.04 };

		// FISH_LOGO constants: runtime primitives (same release as the host) first,
		// embedded copy from this host build as fallback. Zero wasm, zero Rive.
		let FISH;
		try {
			const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
			if (primitives && primitives.FISH_LOGO_PATH && primitives.FISH_LOGO_VIEWBOX) {
				FISH = { path: primitives.FISH_LOGO_PATH, viewBox: primitives.FISH_LOGO_VIEWBOX };
			}
		} catch (error) {
			/* fall through to the embedded copy */
		}
		if (!FISH) FISH = { path: FISH_EMBED_PATH, viewBox: FISH_EMBED_VIEWBOX };

		// ---- shared activity store (remote events → ON AIR bar) ----
		const activity = {
			running: new Map(),   // sessionId -> boolean
			tasks: [],            // in-progress task subjects pushed by the panel
			listeners: new Set(),
			rev: 0,
		};
		function activityEmit() {
			activity.rev += 1;
			for (const listener of Array.from(activity.listeners)) {
				try { listener(); } catch (error) { /* one bad subscriber must not break the rest */ }
			}
		}
		function activitySubscribe(listener) {
			activity.listeners.add(listener);
			return () => activity.listeners.delete(listener);
		}
		function activityLive() {
			for (const value of activity.running.values()) if (value) return true;
			return false;
		}
		function useActivity() {
			const [, force] = React.useState(0);
			React.useEffect(() => activitySubscribe(() => force((n) => n + 1)), []);
			return { live: activityLive(), tasks: activity.tasks, rev: activity.rev };
		}
		function setSessionRunning(sessionId, running) {
			const key = String(sessionId);
			const next = running === true;
			if (activity.running.get(key) === next) return;
			activity.running.set(key, next);
			activityEmit();
		}
		function setActivityTasks(subjects) {
			const joined = subjects.join(' ');
			if (joined === activity.tasks.join(' ')) return;
			activity.tasks = subjects;
			activityEmit();
		}

		// ---- styles (mounted in apply, removed on dispose) ----
		const STYLE_ID = 'dsh-dafeiyu-ui-styles';
		const CSS = [
			// hero fish: 常驻游动（尊重 prefers-reduced-motion）
			'.dshf-fish{display:block;overflow:visible;transform-origin:50% 60%;color:inherit}',
			'@keyframes dshf-swim{0%,100%{transform:translate(0,0) rotate(0deg)}25%{transform:translate(1.6px,-1.4px) rotate(-4deg)}50%{transform:translate(3px,0) rotate(1.5deg)}75%{transform:translate(1.4px,1.2px) rotate(2.5deg)}}',
			'@media (prefers-reduced-motion:no-preference){.dshf-fish{animation:dshf-swim 3.4s ease-in-out infinite}}',
			// ON AIR 状态条
			'.dshf-onair-row{display:flex;justify-content:center;padding:2px 8px}',
			'.dshf-onair{display:inline-flex;align-items:center;gap:8px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));border-radius:999px;background:var(--dsw-alias-bg-elevated,rgba(20,20,24,.6));color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;line-height:18px;padding:2px 10px;max-width:100%;min-width:0}',
			'.dshf-onair-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#8b93a1}',
			'.dshf-onair-dot.live{background:#e5484d;box-shadow:0 0 0 0 rgba(229,72,77,.55)}',
			'@media (prefers-reduced-motion:no-preference){.dshf-onair-dot.live{animation:dshf-pulse 1.4s ease-out infinite}}',
			'@keyframes dshf-pulse{0%{box-shadow:0 0 0 0 rgba(229,72,77,.55)}70%{box-shadow:0 0 0 7px rgba(229,72,77,0)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}',
			'.dshf-onair-label{font-weight:600;letter-spacing:.06em;white-space:nowrap}',
			'.dshf-onair-label.live{color:#ff6369}',
			'.dshf-onair-sub{color:var(--dsw-alias-label-caption,#9a9aa3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
			// right panel
			'.dshf-panel{display:flex;flex-direction:column;gap:14px;padding:10px 12px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e8ea)}',
			'.dshf-panel-head{display:flex;align-items:center;gap:8px;font-weight:600}',
			'.dshf-section{border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-sunken,rgba(255,255,255,.03))}',
			'.dshf-section h4{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#c3c3ca)}',
			'.dshf-kv{display:flex;justify-content:space-between;gap:10px}',
			'.dshf-kv span:last-child{color:var(--dsw-alias-label-caption,#9a9aa3);font-family:var(--ds-font-family-code,monospace)}',
			'.dshf-muted{color:var(--dsw-alias-label-dimmed,#77777f)}',
			'.dshf-cap{color:var(--dsw-alias-label-caption,#9a9aa3);font-size:11px}',
			'.dshf-timeline{display:flex;flex-direction:column;gap:6px}',
			'.dshf-task{display:flex;gap:8px;align-items:flex-start}',
			'.dshf-task-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px;background:#8b93a1}',
			'.dshf-task-dot.done{background:#46a758}.dshf-task-dot.progress{background:#f5a524}.dshf-task-dot.blocked{background:#e5484d}',
			'.dshf-task-main{min-width:0;flex:1}',
			'.dshf-task-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshf-list{margin:0;padding-left:16px}',
			'.dshf-list li{margin:1px 0}',
		].join('\n');
		function injectStyles() {
			if (typeof document === 'undefined') return () => {};
			const existing = document.getElementById(STYLE_ID);
			if (existing) return () => {};
			const el = document.createElement('style');
			el.id = STYLE_ID;
			el.textContent = CSS;
			document.head.appendChild(el);
			return () => { try { el.remove(); } catch (error) { /* already gone */ } };
		}

		// ---- 1. hero fish mark ----
		function FishMark(props) {
			const size = Number.isFinite(props && props.size) ? props.size : 34;
			const ratio = FISH.viewbox.height / FISH.viewbox.width;
			const cls = ['dshf-fish', props && props.className].filter(Boolean).join(' ');
			return h(
				'svg',
				{
					width: size,
					height: Math.round(size * ratio * 100) / 100,
					viewBox: `0 0 ${FISH.viewbox.width} ${FISH.viewbox.height}`,
					className: cls,
					'aria-hidden': 'true',
					focusable: 'false',
				},
				h('path', { d: FISH.path, fill: 'currentColor' })
			);
		}

		// ---- 2. ON AIR bar (conversation.header) ----
		function OnAirBar() {
			const snapshot = useActivity();
			const live = snapshot.live;
			let subtitle;
			if (snapshot.tasks.length > 0) {
				subtitle = snapshot.tasks.slice(0, 2).join(' · ') + (snapshot.tasks.length > 2 ? ` ＋${snapshot.tasks.length - 2}` : '');
			} else {
				subtitle = live ? '宿主运行中（打开右栏「大肥鱼·进化」可看任务字幕）' : '空闲待播';
			}
			return h(
				'div',
				{ className: 'dshf-onair-row' },
				h(
					'div',
					{ className: 'dshf-onair', role: 'status', 'aria-live': 'polite' },
					h('span', { className: `dshf-onair-dot${live ? ' live' : ''}` }),
					h('span', { className: `dshf-onair-label${live ? ' live' : ''}` }, live ? 'ON AIR' : 'STANDBY'),
					h('span', { className: 'dshf-onair-sub', title: subtitle }, subtitle)
				)
			);
		}

		// ---- 3. right panel: 大肥鱼·进化 ----
		const identityHook = (value) => value;
		const safeHook = (fn) => (typeof fn === 'function' ? fn : identityHook);
		const KNOWN_CAPABILITIES = [
			'memory op=recall / show / chain（召回与因果链）',
			'memory op=remember / reflect（事实与假设存档）',
			'memory op=feedback / mute（重训与静音）',
			'jobs：日训 + 周编码器调度（lib/jobs.js）',
			'proactive pre-step 召回门（host 侧 lib/recall.js）',
		];
		function DafeiyuPanel(props) {
			const readSession = safeHook(props && props.useSession);
			const readSessions = safeHook(props && props.useSessions);
			const readStatus = safeHook(props && props.useSessionStatus);

			// agentTeam 投影（与 dsh-cabinet-mode 同通道）
			const parentSessionId = readSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const sessionId = props && props.sessionId;
			const leadSessionId = parentSessionId ?? sessionId;
			const list = readSessions((state) => state);
			const statusMap = readStatus((state) => state);
			const projections = list?.projectionsBySession;
			const team = projections
				? (projections[leadSessionId]?.values?.agentTeam
					|| (leadSessionId !== sessionId && projections[sessionId] ? projections[sessionId].values.agentTeam : undefined))
				: undefined;

			const tasks = (team?.tasks ?? []).filter((task) => task && task.status !== 'deleted');

			// 把进行中任务推给 ON AIR 字幕（面板打开期间）
			React.useEffect(() => {
				const subjects = tasks
					.filter((task) => task.status === 'in_progress' || task.status === 'in-progress' || task.status === 'progress')
					.map((task) => String(task.subject ?? task.id ?? '').trim())
					.filter(Boolean);
				setActivityTasks(subjects);
				return undefined;
			}, [JSON.stringify(tasks.map((task) => [task.id, task.status, task.subject]))]);

			let runningCount = 0;
			if (statusMap && typeof statusMap === 'object') {
				for (const value of Object.values(statusMap)) if (value === true) runningCount += 1;
			}

			let release = null;
			try {
				release = (typeof window !== 'undefined' && window.__DSH_BOOT__ && (window.__DSH_BOOT__.release ?? window.__DSH_BOOT__.entry?.release)) || null;
			} catch (error) { release = null; }

			const statusClass = (status) => (status === 'completed' || status === 'complete' ? 'done' : status === 'in_progress' || status === 'in-progress' ? 'progress' : status === 'blocked' ? 'blocked' : '');

			return h(
				'div',
				{ className: 'dshf-panel' },
				h('div', { className: 'dshf-panel-head' }, h(FishMark, { size: 18 }), '大肥鱼 · 进化面板'),

				// ① 版本历史
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '版本历史'),
					h('div', { className: 'dshf-kv' }, h('span', null, '插件版本'), h('span', null, VERSION)),
					h('div', { className: 'dshf-kv' }, h('span', null, 'client 构建时间'), h('span', null, BUILD_TIME)),
					release ? h('div', { className: 'dshf-kv' }, h('span', null, 'Host release'), h('span', null, String(release.version ?? release) + (release.commit ? ` @${String(release.commit).slice(0, 8)}` : ''))) : null,
					h('div', { className: 'dshf-cap', style: { marginTop: 4 } }, '插件目录非 git 仓库（实测）；变更史待建 git/CHANGELOG 后接入')
				),

				// ② 能力清单
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '能力清单'),
					h('ul', { className: 'dshf-list' }, KNOWN_CAPABILITIES.map((line) => h('li', { key: line }, line))),
					h('div', { className: 'dshf-cap' }, '静态清单；运行时以 设置 → 插件列表 为准')
				),

				// ③ 记忆量（数据源未接通——明示，不编数）
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '记忆量'),
					h('div', { className: 'dshf-muted' }, '未接通：host 尚未向浏览器暴露 memory op=status 通道'),
					h('div', { className: 'dshf-cap' }, '数据源规划：lib/memory-tool.js 的 status 输出（需 host 桥接，见 README §client 数据源）')
				),

				// ④ 任务日志时间线
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '任务日志时间线'),
					runningCount > 0 ? h('div', { className: 'dshf-cap' }, `运行中会话：${runningCount}`) : null,
					tasks.length > 0
						? h('div', { className: 'dshf-timeline' },
							tasks.map((task) =>
								h(
									'div',
									{ className: 'dshf-task', key: String(task.id ?? task.subject ?? task.status) },
									h('span', { className: `dshf-task-dot ${statusClass(task.status)}` }),
									h(
										'div',
										{ className: 'dshf-task-main' },
										h('div', { className: 'dshf-task-sub', title: String(task.subject ?? '') }, String(task.subject ?? task.id ?? '')),
										h('div', { className: 'dshf-cap' }, `${task.status ?? 'pending'}${task.owner ? ` · ${task.owner}` : ''}`)
									)
								)
							))
						: h('div', { className: 'dshf-muted' }, '暂无团队任务（agentTeam 投影为空）'),
					h('div', { className: 'dshf-cap' }, '数据源：agentTeam session 投影（设置/任务板同源）')
				)
			);
		}

		// ---- registration (two-stage pattern copied from dsh-cabinet-mode) ----
		const TAB_ID = 'dafeiyu-evolution';

		function apply(ctx) {
			ctx.effect(() => injectStyles(), 'dafeiyu-ui: styles');

			// 活动通道：api-session/status → ON AIR 指示灯（服务缺位则整体降级）
			ctx.inject(['remote'], (scope) => {
				scope.effect(() => {
					let dispose;
					try {
						dispose = scope.remote.$on('api-session/status', (sessionId, running) => {
							try { setSessionRunning(sessionId, running); } catch (error) { /* ignore */ }
						});
					} catch (error) { /* remote unavailable: bar stays STANDBY */ }
					return () => { try { if (typeof dispose === 'function') dispose(); } catch (error) { /* ignore */ } };
				}, 'dafeiyu-ui: activity');
			}, 'dafeiyu-ui: remote');

			// ① hero 常驻形象
			ctx.effect(() => ctx.slots.inject(
				'conversation.hero.brand.mark',
				() => ctx.slots.register({ name: 'conversation.hero.brand.mark', key: '@fslong/dsh-dafeiyu/fish' }, FishMark)
			), 'dafeiyu-ui: hero fish');

			// ② ON AIR 状态条
			ctx.effect(() => ctx.slots.inject(
				'conversation.header',
				() => ctx.slots.register({ name: 'conversation.header', key: '@fslong/dsh-dafeiyu/on-air' }, OnAirBar)
			), 'dafeiyu-ui: on air');

			// ③ 右栏 tab：stage one = 类型声明
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: 'dafeiyu',
				priority: 'extension',
				title: () => '大肥鱼·进化',
				guide: [{
					id: 'dafeiyu',
					order: 60,
					title: () => '大肥鱼·进化面板',
					description: () => '版本历史 / 能力清单 / 记忆量 / 任务时间线',
				}],
			}), 'dafeiyu-ui: sidebar type');

			// ③ 右栏 tab：stage two = 正文挂载
			ctx.effect(() => ctx.slots.inject(
				'sidebar.right.pane.tab',
				() => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, DafeiyuPanel)
			), 'dafeiyu-ui: sidebar body');
		}

		return { inject: ['slots', 'sidebarRightTabs'], apply };
	},
});
