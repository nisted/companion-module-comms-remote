// Checks the OSC encoder/parser against the box's message shapes. Run after 'yarn build': yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { oscMsg, oscParse } from '../dist/osc.js'

test('round trip: int, float, string', () => {
	const buf = oscMsg('/comms/volume', [
		{ type: 'i', value: 75 },
		{ type: 'f', value: 0.5 },
		{ type: 's', value: 'Pack A' },
	])
	assert.equal(buf.length % 4, 0)
	const m = oscParse(buf)
	assert.equal(m.addr, '/comms/volume')
	assert.deepEqual(m.args, [75, 0.5, 'Pack A'])
})

test('no arguments', () => {
	const m = oscParse(oscMsg('/comms/status'))
	assert.equal(m.addr, '/comms/status')
	assert.deepEqual(m.args, [])
})

test('not OSC', () => {
	assert.equal(oscParse(Buffer.from('hello')), null)
	assert.equal(oscParse(Buffer.alloc(0)), null)
})
