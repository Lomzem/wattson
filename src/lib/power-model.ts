import { Data } from 'effect';
import { parseDocument, type Document } from 'yaml';

export type Kind = 'source' | 'regulator' | 'rail' | 'load';
export type FieldKey =
	| 'name'
	| 'nominal'
	| 'min'
	| 'max'
	| 'input'
	| 'output'
	| 'efficiency'
	| 'rail'
	| 'quantity'
	| 'typical'
	| 'maximum';
export type LinkField = 'input' | 'output' | 'rail';
export type Path = (string | number)[];
export type NodeSubject = `${Kind}:${number}`;
export type IssueCode =
	| 'missing-name'
	| 'duplicate-name'
	| 'invalid-number'
	| 'minimum-above-nominal'
	| 'nominal-above-maximum'
	| 'missing-input'
	| 'missing-output'
	| 'invalid-efficiency'
	| 'missing-rail'
	| 'undriven-rail'
	| 'missing-load-values'
	| 'cycle';
export type IssueId = string & { readonly issueId: unique symbol };

export interface PowerNode {
	kind: Kind;
	index: number;
	name: string;
	data: Record<string, unknown>;
	paths: Record<FieldKey, Path>;
}

export interface Issue {
	id: IssueId;
	code: IssueCode;
	severity: 'error' | 'warning';
	message: string;
	subject?: NodeSubject;
}

export interface PowerModel {
	sources: PowerNode[];
	regulators: PowerNode[];
	rails: PowerNode[];
	loads: PowerNode[];
	issues: Issue[];
}

export interface ParsedPowerDocument {
	source: string;
	document: Document.Parsed;
	model: PowerModel;
}

export class YamlDocumentError extends Data.TaggedError('YamlDocumentError')<{
	message: string;
}> {}

export const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);
export const nodeSubject = (kind: Kind, index: number): NodeSubject => `${kind}:${index}`;

export function nodesOfKind(model: PowerModel, kind: Kind): PowerNode[] {
	return {
		source: model.sources,
		regulator: model.regulators,
		rail: model.rails,
		load: model.loads
	}[kind];
}

export function powerNodes(model: PowerModel, ...kinds: Kind[]): PowerNode[] {
	return kinds.flatMap((kind) => nodesOfKind(model, kind));
}

export function findNode(model: PowerModel, subject: NodeSubject): PowerNode | undefined {
	const [kind, index] = subject.split(':') as [Kind, `${number}`];
	return nodesOfKind(model, kind)[Number(index)];
}

export function nodeRelationship(node: PowerNode, field: LinkField): string {
	if (field === 'input')
		return text(node.data.input ?? Object.values(asRecord(node.data.inputs))[0]);
	if (field === 'output') return text(node.data.output ?? node.data.output_rail);
	return text(node.data.rail ?? node.data.output);
}

export function regulatorInputs(node: PowerNode): { port: string; name: string }[] {
	const inputs = 'input' in node.data ? { VIN: node.data.input } : asRecord(node.data.inputs);
	return Object.entries(inputs).map(([port, value]) => ({ port, name: text(value) }));
}

export function nodeFieldValue(node: PowerNode, key: FieldKey): string | number {
	const data = node.data;
	if (node.kind === 'source') {
		const voltage = asRecord(data.voltage);
		if (key === 'nominal')
			return (voltage.nominal ?? data.nominal_voltage ?? '') as string | number;
		if (key === 'min' || key === 'max') return (voltage[key] ?? '') as string | number;
	}
	if (node.kind === 'rail') {
		if (key === 'nominal') return (data.nominal_voltage ?? data.voltage ?? '') as string | number;
		if (key === 'min') return (data.min_voltage ?? '') as string | number;
		if (key === 'max') return (data.max_voltage ?? '') as string | number;
	}
	if (node.kind === 'regulator' && (key === 'input' || key === 'output'))
		return nodeRelationship(node, key);
	if (node.kind === 'load') {
		if (key === 'rail') return nodeRelationship(node, key);
		if (key === 'typical' || key === 'maximum')
			return (asRecord(data.current)[key] ?? '') as string | number;
	}
	return (data[key] ?? '') as string | number;
}

function firstPath(base: Path, data: Record<string, unknown>, keys: string[]): Path {
	return [...base, keys.find((key) => key in data) ?? keys[0]];
}

function makeNode(kind: Kind, index: number, data: Record<string, unknown>, base: Path): PowerNode {
	const paths = { name: firstPath(base, data, ['name', 'rail']) } as Record<FieldKey, Path>;
	if (kind === 'source') {
		const voltage = asRecord(data.voltage);
		paths.nominal =
			'nominal' in voltage
				? [...base, 'voltage', 'nominal']
				: firstPath(base, data, ['nominal_voltage']);
		paths.min = [...base, 'voltage', 'min'];
		paths.max = [...base, 'voltage', 'max'];
	} else if (kind === 'rail') {
		paths.nominal = firstPath(base, data, ['nominal_voltage', 'voltage']);
		paths.min = [...base, 'min_voltage'];
		paths.max = [...base, 'max_voltage'];
	} else if (kind === 'regulator') {
		paths.input =
			'input' in data
				? [...base, 'input']
				: [...base, 'inputs', Object.keys(asRecord(data.inputs))[0] ?? 'VIN'];
		paths.output = firstPath(base, data, ['output', 'output_rail']);
		paths.efficiency = [...base, 'efficiency'];
	} else {
		paths.rail = firstPath(base, data, ['rail', 'output']);
		paths.quantity = [...base, 'quantity'];
		paths.typical = [...base, 'current', 'typical'];
		paths.maximum = [...base, 'current', 'maximum'];
	}
	return { kind, index, name: text(data.name ?? data.rail), data, paths };
}

function addIssue(
	issues: Issue[],
	code: IssueCode,
	severity: Issue['severity'],
	message: string,
	subject?: NodeSubject,
	detail = ''
) {
	issues.push({
		id: `${subject ?? 'document'}:${code}:${detail}` as IssueId,
		code,
		severity,
		message,
		subject
	});
}

function addDuplicateIssues(nodes: PowerNode[], issues: Issue[]) {
	const seen = new Map<string, PowerNode>();
	for (const node of nodes) {
		const subject = nodeSubject(node.kind, node.index);
		if (!node.name)
			addIssue(issues, 'missing-name', 'error', `A ${node.kind} has no name.`, subject);
		else if (seen.has(node.name))
			addIssue(
				issues,
				'duplicate-name',
				'error',
				`Duplicate ${node.kind} name: ${node.name}.`,
				subject
			);
		else seen.set(node.name, node);
	}
}

function addNumberIssue(
	value: unknown,
	label: string,
	node: PowerNode,
	issues: Issue[],
	optional = false
) {
	if (optional && (value === undefined || value === null || value === '')) return;
	if (!finite(value) || (value as number) < 0)
		addIssue(
			issues,
			'invalid-number',
			'error',
			`${node.name || node.kind} has an invalid ${label}.`,
			nodeSubject(node.kind, node.index),
			label
		);
}

function validate(model: Omit<PowerModel, 'issues'>): Issue[] {
	const issues: Issue[] = [];
	addDuplicateIssues([...model.sources, ...model.rails], issues);
	addDuplicateIssues(model.regulators, issues);
	addDuplicateIssues(model.loads, issues);
	const railNames = new Set(
		powerNodes(model as PowerModel, 'source', 'rail').map(({ name }) => name)
	);
	const driven = new Set(model.sources.map(({ name }) => name));
	for (const node of [...model.sources, ...model.rails]) {
		const nominal = nodeFieldValue(node, 'nominal');
		const min = nodeFieldValue(node, 'min');
		const max = nodeFieldValue(node, 'max');
		addNumberIssue(nominal, 'nominal voltage', node, issues);
		addNumberIssue(min, 'minimum voltage', node, issues, true);
		addNumberIssue(max, 'maximum voltage', node, issues, true);
		const target = nodeSubject(node.kind, node.index);
		if (finite(min) && finite(nominal) && min > nominal)
			addIssue(
				issues,
				'minimum-above-nominal',
				'error',
				`${node.name} minimum voltage exceeds nominal.`,
				target
			);
		if (finite(max) && finite(nominal) && nominal > max)
			addIssue(
				issues,
				'nominal-above-maximum',
				'error',
				`${node.name} nominal voltage exceeds maximum.`,
				target
			);
	}
	const edges = new Map<string, string[]>();
	for (const node of model.regulators) {
		const target = nodeSubject(node.kind, node.index);
		const output = nodeRelationship(node, 'output');
		for (const { port, name: input } of regulatorInputs(node)) {
			if (!railNames.has(input))
				addIssue(
					issues,
					'missing-input',
					'error',
					`${node.name} references missing input rail ${input || '(empty)'}.`,
					target,
					port
				);
			if (input && output) edges.set(input, [...(edges.get(input) ?? []), output]);
		}
		if (!railNames.has(output))
			addIssue(
				issues,
				'missing-output',
				'error',
				`${node.name} references missing output rail ${output || '(empty)'}.`,
				target
			);
		else driven.add(output);
		const efficiency = node.data.efficiency ?? 1;
		if (!finite(efficiency) || efficiency < 0 || efficiency > 1)
			addIssue(
				issues,
				'invalid-efficiency',
				'error',
				`${node.name} efficiency must be from 0 to 1.`,
				target
			);
		addNumberIssue(node.data.max_output_current, 'maximum output current', node, issues, true);
	}
	for (const node of model.loads) {
		const target = nodeSubject(node.kind, node.index);
		const rail = nodeRelationship(node, 'rail');
		if (!railNames.has(rail))
			addIssue(
				issues,
				'missing-rail',
				'error',
				`${node.name} references missing rail ${rail || '(empty)'}.`,
				target
			);
		else if (!driven.has(rail))
			addIssue(
				issues,
				'undriven-rail',
				'warning',
				`${node.name} is on undriven rail ${rail}.`,
				target
			);
		addNumberIssue(node.data.quantity ?? 1, 'quantity', node, issues);
		const current = asRecord(node.data.current);
		if (!Object.keys(current).length)
			addIssue(
				issues,
				'missing-load-values',
				'error',
				`${node.name} has no load mode values.`,
				target
			);
		for (const [mode, value] of Object.entries(current))
			addNumberIssue(value, `${mode} current`, node, issues);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const walk = (rail: string): boolean => {
		if (visiting.has(rail)) return true;
		if (visited.has(rail)) return false;
		visiting.add(rail);
		for (const next of edges.get(rail) ?? []) if (walk(next)) return true;
		visiting.delete(rail);
		visited.add(rail);
		return false;
	};
	if ([...railNames].some(walk))
		addIssue(issues, 'cycle', 'error', 'The regulator topology contains a cycle.');
	return issues;
}

export function parsePowerDocument(source: string): ParsedPowerDocument {
	const document = parseDocument(source, { keepSourceTokens: true, prettyErrors: true });
	if (document.errors.length) throw new YamlDocumentError({ message: document.errors[0].message });
	const root = asRecord(document.toJS() ?? {});
	const sourceKey = 'source' in root ? 'source' : 'sources';
	const rawSources = root[sourceKey];
	const sourceItems = Array.isArray(rawSources)
		? rawSources
		: rawSources === undefined
			? []
			: [rawSources];
	const sources = sourceItems.map((item, index) => {
		const data =
			typeof item === 'string' ? { name: item, voltage: { nominal: 0 } } : asRecord(item);
		return makeNode(
			'source',
			index,
			data,
			Array.isArray(rawSources) ? [sourceKey, index] : [sourceKey]
		);
	});
	const list = (key: string, kind: Kind) =>
		(Array.isArray(root[key]) ? root[key] : []).map((item, index) =>
			makeNode(kind, index, asRecord(item), [key, index])
		);
	const bare = {
		sources,
		rails: list('rails', 'rail'),
		regulators: list('regulators', 'regulator'),
		loads: list('loads', 'load')
	};
	return { source, document, model: { ...bare, issues: validate(bare) } };
}
