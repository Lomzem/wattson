import type { FieldKey, Kind, LinkField } from './power-document';

export type RelationshipTarget = 'source-or-rail' | 'rail';
export type Field = {
	key: FieldKey;
	label: string;
	type?: 'number';
	step?: string;
	min?: string;
	max?: string;
	relationship?: {
		target: RelationshipTarget;
		action: string;
	};
};

export const fields: Record<Kind, Field[]> = {
	source: [
		{ key: 'name', label: 'Name' },
		{ key: 'nominal', label: 'Nominal voltage', type: 'number', step: '0.1', min: '0' },
		{ key: 'min', label: 'Minimum voltage', type: 'number', step: '0.1', min: '0' },
		{ key: 'max', label: 'Maximum voltage', type: 'number', step: '0.1', min: '0' }
	],
	rail: [
		{ key: 'name', label: 'Name' },
		{ key: 'nominal', label: 'Nominal voltage', type: 'number', step: '0.1', min: '0' },
		{ key: 'min', label: 'Minimum voltage', type: 'number', step: '0.1', min: '0' },
		{ key: 'max', label: 'Maximum voltage', type: 'number', step: '0.1', min: '0' }
	],
	regulator: [
		{ key: 'name', label: 'Name' },
		{
			key: 'input',
			label: 'Input rail',
			relationship: { target: 'source-or-rail', action: 'Change input' }
		},
		{
			key: 'output',
			label: 'Output rail',
			relationship: { target: 'rail', action: 'Change output' }
		},
		{ key: 'efficiency', label: 'Efficiency', type: 'number', step: '0.01', min: '0', max: '1' }
	],
	load: [
		{ key: 'name', label: 'Name' },
		{
			key: 'rail',
			label: 'Rail',
			relationship: { target: 'source-or-rail', action: 'Change supply' }
		},
		{ key: 'quantity', label: 'Quantity', type: 'number', step: '1', min: '0' },
		{ key: 'typical', label: 'Typical current', type: 'number', step: '0.0001', min: '0' },
		{ key: 'maximum', label: 'Maximum current', type: 'number', step: '0.0001', min: '0' }
	]
};

export function relationshipFields(kind: Kind) {
	return fields[kind].filter(
		(
			field
		): field is Field & { key: LinkField; relationship: NonNullable<Field['relationship']> } =>
			Boolean(field.relationship)
	);
}

export function relationshipField(kind: Kind, key: LinkField) {
	return relationshipFields(kind).find((field) => field.key === key);
}
