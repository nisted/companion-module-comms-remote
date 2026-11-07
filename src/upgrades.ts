/**
 * Upgrade scripts for buttons and triggers made with older versions.
 * Companion runs each script once per connection, in order.
 *
 * 0.2.0: Mute / Unmute / Toggle merged into one "mute" action with a mode, and the
 *        connection-level volume step moved onto each volume action.
 */

import type {
	CompanionMigrationAction,
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
	JsonObject,
} from '@companion-module/base'

/** An option value, whether it's stored plain or as {value, isExpression} */
const optVal = (o: unknown): unknown => (o && typeof o === 'object' && 'value' in o ? (o as { value: unknown }).value : o)

/** A new option value stored the same way as an existing one */
const wrapLike = (sample: unknown, v: string): any =>
	sample !== undefined && !(sample && typeof sample === 'object' && 'value' in sample) ? v : { isExpression: false, value: v }

function upgradeMuteActions<TConfig extends JsonObject>(
	_context: CompanionUpgradeContext<TConfig>,
	props: CompanionStaticUpgradeProps<TConfig, undefined>,
): CompanionStaticUpgradeResult<TConfig, undefined> {
	const updatedActions: CompanionMigrationAction[] = []
	for (const a of props.actions) {
		const opts = (a.options ?? {}) as Record<string, unknown>
		const sample = Object.values(opts)[0]
		if (a.actionId === 'toggle') {
			a.actionId = 'mute'
			a.options = { mode: wrapLike(sample, 'toggle') }
			updatedActions.push(a)
		} else if (a.actionId === 'unmute') {
			a.actionId = 'mute'
			a.options = { mode: wrapLike(sample, 'unmute') }
			updatedActions.push(a)
		} else if (a.actionId === 'mute' && !optVal(opts.mode)) {
			a.options = { mode: wrapLike(sample, 'mute') }
			updatedActions.push(a)
		}
	}
	let updatedConfig: TConfig | null = null
	if (props.config && 'step' in props.config) {
		const cfg = { ...props.config } as Record<string, unknown>
		delete cfg.step
		updatedConfig = cfg as TConfig
	}
	return { updatedConfig, updatedActions, updatedFeedbacks: [] }
}

export function upgradeScripts<TConfig extends JsonObject>(): CompanionStaticUpgradeScript<TConfig>[] {
	return [upgradeMuteActions<TConfig>]
}
