// Comms Remote V2: Companion connection module. Mic mute and volume for the box, over OSC/UDP.
import {
	InstanceBase,
	InstanceStatus,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	type CompanionOptionValues,
	type CompanionPresetDefinitions,
	type CompanionPresetSection,
	type CompanionStaticUpgradeScript,
	type CompanionVariableDefinitions,
	type CompanionVariableValues,
	type InstanceTypes,
	type JsonObject,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import dgram from 'node:dgram'
import { oscMsg, oscParse, type OscArg, type OscMessage } from './osc.js'
import { upgradeScripts } from './upgrades.js'

interface Config extends JsonObject {
	host: string
	port: number
	slot1: string
	slot2: string
	slot3: string
	slot4: string
	slot5: string
	slot6: string
}

interface CommsTypes extends InstanceTypes {
	config: Config
	secrets: undefined
}

const combineRgb = (r: number, g: number, b: number): number => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
const RED = combineRgb(204, 0, 0)
const GREEN = combineRgb(0, 153, 0)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(80, 80, 80)

const SLOTS = [1, 2, 3, 4, 5, 6] as const
type SlotKey = `slot${(typeof SLOTS)[number]}`
const slotKey = (n: number): SlotKey => `slot${n}` as SlotKey

const THIS_LOCATION = '$(this:page)/$(this:row)/$(this:column)'
const LOCATION_HELP =
	'eg 1/0/0 or $(this:page)/$(this:row)/$(this:column). "this" can also be used to reference the current control'

/** An option's value as text. Companion has already filled in any variables or expression. */
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()
const numOr = (v: unknown, fallback: number): number => {
	const s = str(v)
	const n = Number(s)
	return s !== '' && Number.isFinite(n) ? n : fallback
}
const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))

export const UpgradeScripts: CompanionStaticUpgradeScript<Config>[] = upgradeScripts<Config>()

export default class CommsRemoteInstance extends InstanceBase<CommsTypes> {
	config!: Config
	state = { muted: false, volume: 100, connected: false, name: '' }
	#sock: dgram.Socket | null = null
	#lastSeen = 0
	#pollTimer: NodeJS.Timeout | null = null

	override async init(config: Config): Promise<void> {
		this.config = config
		this.setActionDefinitions(this.#actions())
		this.setFeedbackDefinitions(this.#feedbacks())
		this.setVariableDefinitions(this.#variableDefs())
		const { structure, presets } = this.#presets()
		this.setPresetDefinitions(structure, presets)
		this.#publish()
		this.#start()
	}

	override async destroy(): Promise<void> {
		this.#stop()
	}

	override async configUpdated(config: Config): Promise<void> {
		const old = this.config
		this.config = config
		// slot changes don't need a reconnect
		if (old?.host !== config.host || Number(old?.port) !== Number(config.port)) {
			this.#stop()
			this.#start()
		}
		this.#publish()
	}

	override getConfigFields(): SomeCompanionConfigField[] {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Comms Remote',
				value:
					"Enter the IP address shown on the bottom of the box's screen. Address and port can also be changed by the Set box address / Set box port actions, which accept variables and expressions.",
			},
			{ type: 'textinput', id: 'host', label: 'Box IP address', width: 8, default: '' },
			{ type: 'number', id: 'port', label: 'OSC port', width: 4, default: 9000, min: 1, max: 65535 },
			{
				type: 'static-text',
				id: 'bundle',
				label: "Psst. This one's got mates. 🍹",
				width: 12,
				value:
					'Comms Remote is part of a little crew of Companion modules: some brand new, some old favourites given a good tweak. ' +
					"Want to know who else is in the crew, or grab the freshest version of each one? It's all here: " +
					'<a href="https://github.com/nisted/companion-modules" target="_blank">github.com/nisted/companion-modules</a>',
			},
		]
	}

	// ---------- network ----------

	#start(): void {
		const host = str(this.config?.host)
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No IP address set')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		const sock = dgram.createSocket('udp4')
		this.#sock = sock
		sock.on('error', (e) => {
			this.log('error', 'UDP: ' + e.message)
			this.updateStatus(InstanceStatus.UnknownError, e.message)
		})
		sock.on('message', (msg, rinfo) => {
			if (rinfo.address !== host) return
			const m = oscParse(msg)
			if (m) this.#onOsc(m)
		})
		sock.bind(0, () => {
			this.#send('/comms/status')
			this.#pollTimer = setInterval(() => this.#poll(), 2000)
		})
	}

	#stop(): void {
		if (this.#pollTimer) clearInterval(this.#pollTimer)
		this.#pollTimer = null
		if (this.#sock) {
			try {
				this.#sock.close()
			} catch {
				/* already closed */
			}
		}
		this.#sock = null
		this.#setConnected(false)
	}

	#poll(): void {
		this.#send('/comms/status')
		if (this.state.connected && Date.now() - this.#lastSeen > 6500) this.#setConnected(false)
	}

	#send(addr: string, args?: OscArg[]): void {
		const host = str(this.config?.host)
		if (!this.#sock || !host) return
		this.#sock.send(oscMsg(addr, args), Number(this.config.port) || 9000, host)
	}

	#onOsc(m: OscMessage): void {
		this.#lastSeen = Date.now()
		if (!this.state.connected) this.#setConnected(true)
		const a = m.args[0]
		if (a === undefined) return
		if (m.addr === '/comms/mute') this.state.muted = Number(a) >= 0.5
		else if (m.addr === '/comms/volume') this.state.volume = Math.round(Number(a))
		else if (m.addr === '/comms/name') this.state.name = String(a)
		else return
		this.#publish()
	}

	#setConnected(c: boolean): void {
		this.state.connected = c
		if (c) this.updateStatus(InstanceStatus.Ok)
		else if (str(this.config?.host)) this.updateStatus(InstanceStatus.ConnectionFailure, 'No reply from box')
		this.#publish()
	}

	#publish(): void {
		const v: CompanionVariableValues = {
			muted: this.state.muted ? 1 : 0,
			state: this.state.muted ? 'MUTED' : 'LIVE',
			volume: this.state.volume,
			connected: this.state.connected ? 1 : 0,
			name: this.state.name,
		}
		for (const n of SLOTS) v[slotKey(n)] = str(this.config?.[slotKey(n)])
		this.setVariableValues(v)
		this.checkFeedbacks('muted', 'live', 'offline')
	}

	#applyConfig(changes: Partial<Config>): void {
		this.config = { ...this.config, ...changes } as Config
		this.saveConfig(this.config)
		this.#stop()
		this.#start()
	}

	// ---------- variables ----------

	#variableDefs(): CompanionVariableDefinitions {
		const defs: Record<string, { name: string }> = {
			muted: { name: 'Muted (1/0)' },
			state: { name: 'State text (MUTED / LIVE)' },
			volume: { name: 'Volume (0-100)' },
			connected: { name: 'Box reachable (1/0)' },
			name: { name: 'Pack name' },
		}
		for (const n of SLOTS) defs[slotKey(n)] = { name: `Box button ${n} target (page/row/column)` }
		return defs
	}

	// ---------- actions ----------

	#actions(): CompanionActionDefinitions {
		const txt = (id: string, label: string, def: string, description?: string) =>
			({ type: 'textinput', id, label, default: def, useVariables: true, description }) as const
		const send = (addr: string, args?: OscArg[]) => this.#send(addr, args)

		return {
			mute: {
				name: 'Mute',
				options: [
					{
						type: 'dropdown',
						id: 'mode',
						label: 'Mode',
						default: 'toggle',
						allowCustom: true,
						description: 'Or switch to an expression: mute, unmute, toggle, 1/0, on/off',
						choices: [
							{ id: 'mute', label: 'Mute' },
							{ id: 'unmute', label: 'Unmute (live)' },
							{ id: 'toggle', label: 'Toggle' },
						],
					},
				],
				callback: async ({ options }) => {
					const v = str(options.mode).toLowerCase()
					if (['toggle', 't'].includes(v)) return send('/comms/mute/toggle')
					if (['mute', '1', 'muted', 'on', 'true', 'yes'].includes(v)) return send('/comms/mute', [{ type: 'i', value: 1 }])
					if (['unmute', '0', 'live', 'off', 'false', 'no'].includes(v)) return send('/comms/mute', [{ type: 'i', value: 0 }])
					this.log('warn', `Mute: didn't understand "${v}"`)
				},
			},
			set_name: {
				name: 'Set pack name',
				options: [txt('name', 'Pack name', '', "Shown on the box's screen")],
				callback: async ({ options }) => send('/comms/name', [{ type: 's', value: str(options.name).slice(0, 24) }]),
			},
			volume_set: {
				name: 'Set volume',
				options: [txt('value', 'Volume (0-100)', '100')],
				callback: async ({ options }) => {
					const v = numOr(options.value, NaN)
					if (Number.isFinite(v)) send('/comms/volume', [{ type: 'i', value: clamp(v) }])
				},
			},
			volume_up: {
				name: 'Volume up',
				options: [txt('step', 'Step (%)', '5')],
				callback: async ({ options }) =>
					send('/comms/volume', [{ type: 'i', value: clamp(this.state.volume + numOr(options.step, 5)) }]),
			},
			volume_down: {
				name: 'Volume down',
				options: [txt('step', 'Step (%)', '5')],
				callback: async ({ options }) =>
					send('/comms/volume', [{ type: 'i', value: clamp(this.state.volume - numOr(options.step, 5)) }]),
			},
			set_slot: {
				name: 'Set box button target',
				options: [
					{
						type: 'dropdown',
						id: 'slot',
						label: 'Box button',
						default: 'none',
						allowCustom: true,
						description: 'None, or 1-6: top row 1-3, bottom row 4-6',
						choices: [{ id: 'none', label: 'None' }, ...SLOTS.map((n) => ({ id: String(n), label: `Button ${n}` }))],
					},
					txt('location', 'Location', THIS_LOCATION, LOCATION_HELP + '. Leave empty to clear. Saved with the connection'),
				],
				callback: async ({ options }) => this.#setSlot(options),
			},
			set_host: {
				name: 'Set box address',
				options: [txt('host', 'IP address', '', 'Saved to the connection')],
				callback: async ({ options }) => {
					const host = str(options.host)
					if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return this.log('warn', `Set box address: "${host}" isn't an IP address`)
					if (host !== this.config.host) this.#applyConfig({ host })
				},
			},
			set_port: {
				name: 'Set box port',
				options: [txt('port', 'OSC port', '9000', 'Saved to the connection')],
				callback: async ({ options }) => {
					const port = Math.round(numOr(options.port, NaN))
					if (!(port >= 1 && port <= 65535)) return this.log('warn', 'Set box port: invalid port')
					if (port !== Number(this.config.port)) this.#applyConfig({ port })
				},
			},
		}
	}

	#setSlot(options: CompanionOptionValues): void {
		if (['none', ''].includes(str(options.slot).toLowerCase())) return // not assigned to a box button
		const n = Math.round(numOr(options.slot, NaN))
		if (!SLOTS.includes(n as (typeof SLOTS)[number])) {
			this.log('warn', `Set box button target: "${str(options.slot)}" isn't 1-6`)
			return
		}
		const loc = str(options.location)
		if (loc && !/^\d+\/\d+\/\d+$/.test(loc)) {
			this.log('warn', `Set box button target: "${loc}" isn't page/row/column`)
			return
		}
		const key = slotKey(n)
		if (loc === str(this.config[key])) return
		this.config = { ...this.config, [key]: loc }
		this.saveConfig(this.config)
		this.#publish()
	}

	// ---------- feedbacks ----------

	#feedbacks(): CompanionFeedbackDefinitions {
		return {
			muted: {
				type: 'boolean',
				name: 'Box is muted',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [],
				callback: () => this.state.connected && this.state.muted,
			},
			live: {
				type: 'boolean',
				name: 'Box is live',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [],
				callback: () => this.state.connected && !this.state.muted,
			},
			offline: {
				type: 'boolean',
				name: 'Box not responding',
				defaultStyle: { bgcolor: GREY, color: WHITE },
				options: [],
				callback: () => !this.state.connected,
			},
		}
	}

	// ---------- presets ----------

	#presets(): { structure: CompanionPresetSection<CommsTypes>[]; presets: CompanionPresetDefinitions<CommsTypes> } {
		const id = this.label
		const fb = [
			{ feedbackId: 'live', options: {}, style: { bgcolor: GREEN, color: WHITE } },
			{ feedbackId: 'muted', options: {}, style: { bgcolor: RED, color: WHITE } },
			{ feedbackId: 'offline', options: {}, style: { bgcolor: GREY, color: WHITE } },
		]
		// choose a box button here to have this preset mirrored on the box when pressed
		const setSlot = { actionId: 'set_slot', options: { slot: 'none', location: THIS_LOCATION } }
		type Step = { actionId: string; options: CompanionOptionValues }
		const btn = (name: string, text: string, down: Step[]) => ({
			type: 'simple' as const,
			name,
			style: { text, size: 'auto' as const, color: WHITE, bgcolor: BLACK },
			steps: [{ down, up: [] }],
			feedbacks: fb,
		})

		const presets: CompanionPresetDefinitions<CommsTypes> = {
			toggle: btn('Mute toggle', `$(${id}:state)`, [{ actionId: 'mute', options: { mode: 'toggle' } }, setSlot]),
			mute: btn('Mute', 'MUTE', [{ actionId: 'mute', options: { mode: 'mute' } }, setSlot]),
			unmute: btn('Unmute', 'LIVE', [{ actionId: 'mute', options: { mode: 'unmute' } }, setSlot]),
			vol_up: btn('Volume up', `VOL +\n$(${id}:volume)%`, [{ actionId: 'volume_up', options: { step: '5' } }, setSlot]),
			vol_down: btn('Volume down', `VOL -\n$(${id}:volume)%`, [{ actionId: 'volume_down', options: { step: '5' } }, setSlot]),
			rotary: {
				type: 'simple',
				name: 'Rotary: turn = volume, press = mute',
				style: { text: `$(${id}:state)\n$(${id}:volume)%`, size: 'auto', color: WHITE, bgcolor: BLACK },
				steps: [
					{
						down: [{ actionId: 'mute', options: { mode: 'toggle' } }, setSlot],
						up: [],
						rotate_left: [{ actionId: 'volume_down', options: { step: '5' } }],
						rotate_right: [{ actionId: 'volume_up', options: { step: '5' } }],
					},
				],
				feedbacks: fb,
			},
		}
		const structure: CompanionPresetSection<CommsTypes>[] = [
			{ id: 'mute', name: 'Mute', definitions: ['toggle', 'mute', 'unmute'] },
			{ id: 'volume', name: 'Volume', definitions: ['vol_up', 'vol_down', 'rotary'] },
		]
		return { structure, presets }
	}
}
