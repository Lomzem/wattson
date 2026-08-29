import { describe, expect, it } from 'vitest';
import {
	applyNodeField,
	canonicalDocument,
	parsePowerDocument,
	patchScalar,
	replaceSection,
	sectionData
} from './power-document';

const sample = `# board power\r
source:\r
  name: 'VIN' # connector\r
  voltage:\r
    nominal: 12.0\r
  vendor_extension: keep-me\r
rails:\r
  - name: "3V3"\r
    nominal_voltage: 3.3\r
regulators:\r
  - name: U1\r
    input: VIN\r
    output_rail: 3V3\r
    efficiency: 0.9\r
loads:\r
  - name: MCU\r
    output: 3V3\r
    current: { typical: 0.1, maximum: 0.2 }\r
unknown_top: true\r
`;

describe('Powerman YAML document', () => {
	it('creates an exact empty canonical document', () => {
		const parsed = canonicalDocument();

		expect(parsed.source).toBe('');
		expect(parsed.model.sources).toEqual([]);
		expect(parsed.model.regulators).toEqual([]);
		expect(parsed.model.rails).toEqual([]);
		expect(parsed.model.loads).toEqual([]);
	});

	it('returns imported text without an edit', () => {
		expect(parsePowerDocument(sample).source).toBe(sample);
	});

	it('patches only one scalar token and keeps quote style and comments', () => {
		const parsed = parsePowerDocument(sample);
		const next = patchScalar(parsed, parsed.model.rails[0].paths.name, 'VOUT');
		expect(next.source).toBe(sample.replace('"3V3"', '"VOUT"'));
		expect(next.source).toContain("name: 'VIN' # connector");
		expect(next.source).toContain('vendor_extension: keep-me');
		expect(next.source).toContain('unknown_top: true');
		expect(next.source).toContain('\r\n');
	});

	it('imports loader aliases and nested source voltage', () => {
		const model = parsePowerDocument(sample).model;
		expect(model.sources[0].name).toBe('VIN');
		expect(model.sources[0].paths.nominal).toEqual(['source', 'voltage', 'nominal']);
		expect(model.regulators[0].paths.output).toEqual(['regulators', 0, 'output_rail']);
		expect(model.loads[0].paths.rail).toEqual(['loads', 0, 'output']);
	});

	it('regenerates only the changed structural section', () => {
		const parsed = parsePowerDocument(sample);
		const rails = structuredClone(sectionData(parsed, 'rails')) as object[];
		rails.push({ name: '1V8', nominal_voltage: 1.8 });
		const next = replaceSection(parsed, 'rails', rails);
		expect(next.model.rails).toHaveLength(2);
		expect(next.source.slice(0, next.source.indexOf('rails:'))).toBe(
			sample.slice(0, sample.indexOf('rails:'))
		);
		expect(next.source.slice(next.source.indexOf('regulators:'))).toBe(
			sample.slice(sample.indexOf('regulators:'))
		);
	});

	it('reports references, values, cycles, duplicates, and undriven loads', () => {
		const invalid = parsePowerDocument(`sources:
  - { name: VIN, voltage: { nominal: 12 } }
rails:
  - { name: A, nominal_voltage: 3.3 }
  - { name: A, nominal_voltage: -1 }
  - { name: B, nominal_voltage: 1.8 }
regulators:
  - { name: R1, input: A, output: B, efficiency: 1.2 }
  - { name: R2, input: B, output: A, efficiency: 0.9 }
loads:
  - { name: L1, rail: MISSING, current: {} }
  - { name: L2, rail: VIN, current: { typical: -0.1 } }
`);
		const messages = invalid.model.issues.map((issue) => issue.message).join(' ');
		expect(messages).toContain('Duplicate rail name');
		expect(messages).toContain('invalid nominal voltage');
		expect(messages).toContain('efficiency must be from 0 to 1');
		expect(messages).toContain('missing rail MISSING');
		expect(messages).toContain('no load mode values');
		expect(messages).toContain('contains a cycle');
		expect(messages).toContain('invalid typical current');
	});

	it('applies fields to a temporary document without changing the input document', () => {
		const parsed = parsePowerDocument(sample);
		const preview = applyNodeField(parsed, 'regulator', 0, 'efficiency', '1.2', true);

		expect(parsed.source).toBe(sample);
		expect(preview.source).toContain('efficiency: 1.2');
		expect(preview.model.issues.map((issue) => issue.message)).toContain(
			'U1 efficiency must be from 0 to 1.'
		);
		expect(() => applyNodeField(parsed, 'rail', 0, 'nominal', '', true)).toThrow(
			'3V3 has an invalid nominal.'
		);
	});
});
