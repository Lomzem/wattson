import { isScalar, stringify, type Node } from 'yaml';
import {
	parsePowerDocument,
	YamlDocumentError,
	type FieldKey,
	type Kind,
	type ParsedPowerDocument,
	type Path
} from './power-model';

export * from './power-model';

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
	key: FieldKey,
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
	return parsePowerDocument('');
}

export function sectionData(parsed: ParsedPowerDocument, key: string): unknown {
	return (parsed.document.toJS() as Record<string, unknown> | null)?.[key];
}
