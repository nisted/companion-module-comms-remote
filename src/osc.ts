/** Just enough OSC for the Comms Remote box: int, float and string arguments, no bundles. */

export type OscArg = { type: 'i'; value: number } | { type: 'f'; value: number } | { type: 's'; value: string }

export interface OscMessage {
	addr: string
	args: Array<number | string>
}

function oscStr(s: string): Buffer {
	const b = Buffer.from(s + '\0', 'utf8')
	const pad = (4 - (b.length % 4)) % 4
	return Buffer.concat([b, Buffer.alloc(pad)])
}

export function oscMsg(addr: string, args: OscArg[] = []): Buffer {
	let tags = ','
	const parts: Buffer[] = []
	for (const a of args) {
		if (a.type === 'i') {
			tags += 'i'
			const x = Buffer.alloc(4)
			x.writeInt32BE(a.value | 0)
			parts.push(x)
		} else if (a.type === 'f') {
			tags += 'f'
			const x = Buffer.alloc(4)
			x.writeFloatBE(a.value)
			parts.push(x)
		} else {
			tags += 's'
			parts.push(oscStr(String(a.value)))
		}
	}
	return Buffer.concat([oscStr(addr), oscStr(tags), ...parts])
}

function readStr(buf: Buffer, pos: number): [string, number] {
	let end = buf.indexOf(0, pos)
	if (end < 0) end = buf.length
	const s = buf.toString('utf8', pos, end)
	const next = pos + Math.ceil((end - pos + 1) / 4) * 4
	return [s, next]
}

export function oscParse(buf: Buffer): OscMessage | null {
	if (!buf.length || buf[0] !== 0x2f) return null // '/'
	const [addr, start] = readStr(buf, 0)
	let pos = start
	const args: Array<number | string> = []
	if (pos < buf.length && buf[pos] === 0x2c) {
		const [tags, afterTags] = readStr(buf, pos)
		pos = afterTags
		for (const t of tags.slice(1)) {
			if (t === 'i' && pos + 4 <= buf.length) {
				args.push(buf.readInt32BE(pos))
				pos += 4
			} else if (t === 'f' && pos + 4 <= buf.length) {
				args.push(buf.readFloatBE(pos))
				pos += 4
			} else if (t === 's') {
				const [v, next] = readStr(buf, pos)
				args.push(v)
				pos = next
			} else if (t === 'T') args.push(1)
			else if (t === 'F') args.push(0)
			else break
		}
	}
	return { addr, args }
}
