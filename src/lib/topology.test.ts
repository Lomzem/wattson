import { describe, expect, it } from 'vitest';
import { parsePowerDocument } from './power-document';
import { buildTopology } from './topology';

const model = parsePowerDocument(`source: { name: VIN, voltage: { nominal: 12 } }
rails:
  - { name: DIRECT, nominal_voltage: 5 }
  - { name: CORE, nominal_voltage: 3.3 }
  - { name: UNUSED, nominal_voltage: 1.8 }
regulators:
  - { name: REG, inputs: { primary: VIN, backup: DIRECT }, output_rail: CORE }
loads:
  - { name: MCU, output: CORE, current: { typical: 0.1 } }
  - { name: FAN, rail: DIRECT, current: { typical: 0.2 } }
  - { name: LOST, rail: MISSING, current: { typical: 0.3 } }
`).model;

describe('buildTopology', () => {
	it('groups conversion, direct, and unlinked paths across YAML aliases', () => {
		const topology = buildTopology(model);

		expect(topology.conversions[0].inputs.map(({ port, node }) => [port, node?.name])).toEqual([
			['primary', 'VIN'],
			['backup', 'DIRECT']
		]);
		expect(topology.conversions[0].output?.name).toBe('CORE');
		expect(topology.conversions[0].loads.map(({ name }) => name)).toEqual(['MCU']);
		expect(topology.direct.map(({ rail, loads }) => [rail.name, loads[0].name])).toEqual([
			['DIRECT', 'FAN']
		]);
		expect(topology.unlinked.map(({ name }) => name)).toEqual(['UNUSED', 'LOST']);
	});
});
