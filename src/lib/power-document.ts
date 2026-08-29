import { Data, Effect } from 'effect';
import { isScalar, parseDocument, stringify, type Document, type Node } from 'yaml';

export type Kind = 'source' | 'regulator' | 'rail' | 'load';
export type Path = (string | number)[];

export interface PowerNode {
	kind: Kind;
	index: number;
	name: string;
	data: Record<string, unknown>;
	paths: Record<string, Path>;
}

export interface Issue {
	severity: 'error' | 'warning';
	message: string;
	subject?: string;
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

const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const subject = (kind: Kind, index: number) => `${kind}:${index}`;

function firstPath(base: Path, data: Record<string, unknown>, keys: string[]): Path {
	return [...base, keys.find((key) => key in data) ?? keys[0]];
}

function makeNode(kind: Kind, index: number, data: Record<string, unknown>, base: Path): PowerNode {
	const paths: Record<string, Path> = {
		name: firstPath(base, data, ['name', 'rail'])
	};
	if (kind === 'source') {
		const voltage = asRecord(data.voltage);
		paths.nominal =
			'nominal' in voltage
				? [...base, 'voltage', 'nominal']
				: firstPath(base, data, ['nominal_voltage']);
		paths.min = 'min' in voltage ? [...base, 'voltage', 'min'] : [...base, 'voltage', 'min'];
		paths.max = 'max' in voltage ? [...base, 'voltage', 'max'] : [...base, 'voltage', 'max'];
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

function addDuplicateIssues(nodes: PowerNode[], issues: Issue[]) {
	const seen = new Map<string, PowerNode>();
	for (const node of nodes) {
		if (!node.name) {
			issues.push({
				severity: 'error',
				message: `A ${node.kind} has no name.`,
				subject: subject(node.kind, node.index)
			});
		} else if (seen.has(node.name)) {
			issues.push({
				severity: 'error',
				message: `Duplicate ${node.kind} name: ${node.name}.`,
				subject: subject(node.kind, node.index)
			});
		} else seen.set(node.name, node);
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
	if (!finite(value) || (value as number) < 0) {
		issues.push({
			severity: 'error',
			message: `${node.name || node.kind} has an invalid ${label}.`,
			subject: subject(node.kind, node.index)
		});
	}
}

function validate(model: Omit<PowerModel, 'issues'>): Issue[] {
	const issues: Issue[] = [];
	addDuplicateIssues([...model.sources, ...model.rails], issues);
	addDuplicateIssues(model.regulators, issues);
	addDuplicateIssues(model.loads, issues);
	const railNames = new Set([...model.sources, ...model.rails].map((node) => node.name));
	const driven = new Set(model.sources.map((node) => node.name));
	for (const node of [...model.sources, ...model.rails]) {
		const voltage = node.kind === 'source' ? asRecord(node.data.voltage) : node.data;
		const nominal =
			node.kind === 'source'
				? (voltage.nominal ?? node.data.nominal_voltage)
				: (node.data.nominal_voltage ?? node.data.voltage);
		const min = node.kind === 'source' ? voltage.min : node.data.min_voltage;
		const max = node.kind === 'source' ? voltage.max : node.data.max_voltage;
		addNumberIssue(nominal, 'nominal voltage', node, issues);
		addNumberIssue(min, 'minimum voltage', node, issues, true);
		addNumberIssue(max, 'maximum voltage', node, issues, true);
		if (finite(min) && finite(nominal) && (min as number) > (nominal as number))
			issues.push({
				severity: 'error',
				message: `${node.name} minimum voltage exceeds nominal.`,
				subject: subject(node.kind, node.index)
			});
		if (finite(max) && finite(nominal) && (nominal as number) > (max as number))
			issues.push({
				severity: 'error',
				message: `${node.name} nominal voltage exceeds maximum.`,
				subject: subject(node.kind, node.index)
			});
	}
	const edges = new Map<string, string[]>();
	for (const node of model.regulators) {
		const inputs =
			'input' in node.data
				? [text(node.data.input)]
				: Object.values(asRecord(node.data.inputs)).map(text);
		const output = text(node.data.output ?? node.data.output_rail);
		for (const input of inputs) {
			if (!railNames.has(input))
				issues.push({
					severity: 'error',
					message: `${node.name} references missing input rail ${input || '(empty)'}.`,
					subject: subject(node.kind, node.index)
				});
			if (input && output) edges.set(input, [...(edges.get(input) ?? []), output]);
		}
		if (!railNames.has(output))
			issues.push({
				severity: 'error',
				message: `${node.name} references missing output rail ${output || '(empty)'}.`,
				subject: subject(node.kind, node.index)
			});
		else driven.add(output);
		const efficiency = node.data.efficiency ?? 1;
		if (!finite(efficiency) || (efficiency as number) < 0 || (efficiency as number) > 1)
			issues.push({
				severity: 'error',
				message: `${node.name} efficiency must be from 0 to 1.`,
				subject: subject(node.kind, node.index)
			});
		addNumberIssue(node.data.max_output_current, 'maximum output current', node, issues, true);
	}
	for (const node of model.loads) {
		const rail = text(node.data.rail ?? node.data.output);
		if (!railNames.has(rail))
			issues.push({
				severity: 'error',
				message: `${node.name} references missing rail ${rail || '(empty)'}.`,
				subject: subject(node.kind, node.index)
			});
		else if (!driven.has(rail))
			issues.push({
				severity: 'warning',
				message: `${node.name} is on undriven rail ${rail}.`,
				subject: subject(node.kind, node.index)
			});
		addNumberIssue(node.data.quantity ?? 1, 'quantity', node, issues);
		const current = asRecord(node.data.current);
		if (!Object.keys(current).length)
			issues.push({
				severity: 'error',
				message: `${node.name} has no load mode values.`,
				subject: subject(node.kind, node.index)
			});
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
		issues.push({ severity: 'error', message: 'The regulator topology contains a cycle.' });
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

export const parsePowerDocumentEffect = (source: string) =>
	Effect.try({
		try: () => parsePowerDocument(source),
		catch: (error) =>
			error instanceof YamlDocumentError ? error : new YamlDocumentError({ message: String(error) })
	});

function scalarText(value: string | number, node: Node): string {
	if (typeof value === 'number') return String(value);
	const type = isScalar(node) ? node.type : undefined;
	if (type === 'QUOTE_DOUBLE') return JSON.stringify(value);
	if (type === 'QUOTE_SINGLE') return `'${value.replaceAll("'", "''")}'`;
	const plain = stringify(value).trimEnd();
	return plain.includes('\n') ? JSON.stringify(value) : plain;
}

export function patchScalar(
	parsed: ParsedPowerDocument,
	path: Path,
	value: string | number
): ParsedPowerDocument {
	const node = parsed.document.getIn(path, true) as Node | undefined;
	if (!node?.range)
		throw new YamlDocumentError({ message: `Cannot edit missing YAML path ${path.join('.')}.` });
	const next =
		parsed.source.slice(0, node.range[0]) +
		scalarText(value, node) +
		parsed.source.slice(node.range[1]);
	return parsePowerDocument(next);
}

export function applyNodeField(
	parsed: ParsedPowerDocument,
	kind: Kind,
	index: number,
	key: string,
	raw: string,
	numeric = false
): ParsedPowerDocument {
	const target = {
		source: parsed.model.sources,
		regulator: parsed.model.regulators,
		rail: parsed.model.rails,
		load: parsed.model.loads
	}[kind][index];
	if (!target) throw new YamlDocumentError({ message: `Cannot edit missing ${kind} ${index}.` });
	const value = numeric ? Number(raw) : raw;
	if (numeric && (raw.trim() === '' || !Number.isFinite(value)))
		throw new YamlDocumentError({
			message: `${target.name || kind} has an invalid ${key.replaceAll('_', ' ')}.`
		});
	try {
		return patchScalar(parsed, target.paths[key], value);
	} catch {
		const section = target.kind === 'source' ? (target.paths.name[0] as string) : `${target.kind}s`;
		const content = structuredClone(sectionData(parsed, section));
		const item = (Array.isArray(content) ? content[target.index] : content) as Record<
			string,
			unknown
		>;
		if (!item) return parsed;
		const path = target.paths[key].slice(Array.isArray(content) ? 2 : 1);
		let cursor = item;
		for (const part of path.slice(0, -1)) cursor = (cursor[part] ??= {}) as Record<string, unknown>;
		cursor[path.at(-1)!] = value;
		return replaceSection(parsed, section, content);
	}
}

export function replaceSection(
	parsed: ParsedPowerDocument,
	key: string,
	value: unknown
): ParsedPowerDocument {
	const node = parsed.document.get(key, true) as Node | undefined;
	const lineBreak = parsed.source.includes('\r\n') ? '\r\n' : '\n';
	const rendered = stringify(value, { lineWidth: 0 })
		.trimEnd()
		.replaceAll('\n', lineBreak + '  ');
	if (node?.range) {
		let prefix = parsed.source.slice(0, node.range[0]);
		const suffix = parsed.source.slice(node.range[1]);
		const lineStart = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1;
		const inlineValue = /\S/.test(prefix.slice(lineStart));
		if (inlineValue) prefix = prefix.replace(/[ \t]+$/, '');
		const opening =
			inlineValue && (Array.isArray(value) || (value !== null && typeof value === 'object'))
				? lineBreak + '  '
				: '';
		const separator = suffix.startsWith('\n') || suffix.startsWith('\r') ? '' : lineBreak;
		return parsePowerDocument(prefix + opening + rendered + separator + suffix);
	}
	const prefix = parsed.source.length && !parsed.source.endsWith('\n') ? lineBreak : '';
	return parsePowerDocument(
		`${parsed.source}${prefix}${key}:${lineBreak}  ${rendered}${lineBreak}`
	);
}

export function canonicalDocument(): ParsedPowerDocument {
	return parsePowerDocument(
		'source:\n  name: VIN\n  voltage:\n    nominal: 12\n\nrails: []\nregulators: []\nloads: []\n'
	);
}

export function sectionData(parsed: ParsedPowerDocument, key: string): unknown {
	return asRecord(parsed.document.toJS() ?? {})[key];
}
