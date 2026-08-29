import {
	applyNodeField,
	canonicalDocument,
	parsePowerDocument,
	replaceSection,
	sectionData,
	type Kind,
	type ParsedPowerDocument,
	type PowerNode
} from '$lib/power-document';

export type Field = {
	key: string;
	label: string;
	type?: 'number';
	step?: string;
	min?: string;
	max?: string;
};

export type LinkField = 'input' | 'output' | 'rail';
export type LinkMode = {
	kind: 'regulator' | 'load';
	index: number;
	field: LinkField;
	name: string;
};
export type LinkFeedback = { message: string; undoSource?: string; linkedSource?: string };

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
		{ key: 'input', label: 'Input rail' },
		{ key: 'output', label: 'Output rail' },
		{ key: 'efficiency', label: 'Efficiency', type: 'number', step: '0.01', min: '0', max: '1' }
	],
	load: [
		{ key: 'name', label: 'Name' },
		{ key: 'rail', label: 'Rail' },
		{ key: 'quantity', label: 'Quantity', type: 'number', step: '1', min: '0' },
		{ key: 'typical', label: 'Typical current', type: 'number', step: '0.0001', min: '0' },
		{ key: 'maximum', label: 'Maximum current', type: 'number', step: '0.0001', min: '0' }
	]
};

export function nodeValue(node: PowerNode, key: string): string | number {
	const data = node.data;
	if (node.kind === 'source') {
		const voltage = (data.voltage ?? {}) as Record<string, unknown>;
		if (key === 'nominal')
			return (voltage.nominal ?? data.nominal_voltage ?? '') as string | number;
		if (key === 'min' || key === 'max') return (voltage[key] ?? '') as string | number;
	}
	if (node.kind === 'rail') {
		if (key === 'nominal') return (data.nominal_voltage ?? data.voltage ?? '') as string | number;
		if (key === 'min') return (data.min_voltage ?? '') as string | number;
		if (key === 'max') return (data.max_voltage ?? '') as string | number;
	}
	if (node.kind === 'regulator') {
		if (key === 'input')
			return (data.input ?? Object.values((data.inputs ?? {}) as object)[0] ?? '') as
				string | number;
		if (key === 'output') return (data.output ?? data.output_rail ?? '') as string | number;
	}
	if (node.kind === 'load') {
		if (key === 'rail') return (data.rail ?? data.output ?? '') as string | number;
		if (key === 'typical' || key === 'maximum')
			return (((data.current ?? {}) as Record<string, unknown>)[key] ?? '') as string | number;
	}
	return (data[key] ?? '') as string | number;
}

export class EditorSession {
	parsed = $state.raw<ParsedPowerDocument | null>(null);
	filename = $state('power-tree.yaml');
	baseSource = $state('');
	handle = $state<FileSystemFileHandle | undefined>();
	selected = $state<{ kind: Kind; index: number } | null>(null);
	componentDraft = $state<Record<string, string>>({});
	sheetSourceBefore = $state('');
	cancelPending = $state(false);
	rawOpen = $state(false);
	rawDraft = $state('');
	rawError = $state('');
	rawRevision = $state(0);
	linkMode = $state<LinkMode | null>(null);
	linkError = $state('');
	linkFeedback = $state<LinkFeedback | null>(null);

	dirty = $derived(Boolean(this.parsed && this.parsed.source !== this.baseSource));
	hasTopologyEntities = $derived(
		Boolean(
			this.parsed &&
			(this.parsed.model.sources.length ||
				this.parsed.model.regulators.length ||
				this.parsed.model.rails.length ||
				this.parsed.model.loads.length)
		)
	);
	currentNode = $derived.by(() => {
		if (!this.parsed || !this.selected) return undefined;
		return {
			source: this.parsed.model.sources,
			regulator: this.parsed.model.regulators,
			rail: this.parsed.model.rails,
			load: this.parsed.model.loads
		}[this.selected.kind][this.selected.index];
	});
	previewState = $derived.by(() => {
		if (!this.parsed || !this.selected || !this.currentNode)
			return { document: this.parsed, error: '', hasNewError: false };
		let document = this.parsed;
		try {
			for (const field of fields[this.currentNode.kind]) {
				if (field.key === 'name') continue;
				const raw = this.componentDraft[field.key] ?? '';
				if (raw === String(nodeValue(this.currentNode, field.key))) continue;
				document = applyNodeField(
					document,
					this.currentNode.kind,
					this.currentNode.index,
					field.key,
					raw,
					field.type === 'number'
				);
			}
			const existing = this.parsed.model.issues.map((issue) => issue.message);
			return {
				document,
				error: '',
				hasNewError: document.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.includes(issue.message)
				)
			};
		} catch (error) {
			return {
				document,
				error: error instanceof Error ? error.message : String(error),
				hasNewError: true
			};
		}
	});
	currentIssues = $derived([
		...(this.previewState.document?.model.issues.filter(
			(issue) =>
				!this.currentNode ||
				!issue.subject ||
				issue.subject === `${this.currentNode.kind}:${this.currentNode.index}`
		) ?? []),
		...(this.previewState.error
			? [{ severity: 'error' as const, message: this.previewState.error }]
			: [])
	]);

	setDocument(
		next: ParsedPowerDocument,
		name: string,
		fileHandle?: FileSystemFileHandle,
		base = next.source
	) {
		this.parsed = next;
		this.filename = name;
		this.baseSource = base;
		this.handle = fileHandle;
		this.selected = null;
		this.rawOpen = false;
		this.clearLinkState();
	}

	clearLinkState() {
		this.linkMode = null;
		this.linkError = '';
		this.linkFeedback = null;
	}

	cancelActiveLink() {
		this.linkMode = null;
		this.linkError = '';
	}

	newDocument() {
		this.setDocument(canonicalDocument(), 'power-tree.yaml');
	}

	selectNode(node: PowerNode) {
		this.rawOpen = false;
		this.sheetSourceBefore = this.parsed?.source ?? '';
		this.cancelPending = false;
		this.componentDraft = Object.fromEntries(
			fields[node.kind].map((field) => [field.key, String(nodeValue(node, field.key))])
		);
		this.selected = { kind: node.kind, index: node.index };
	}

	closeComponentSheet() {
		this.componentDraft = {};
		this.selected = null;
	}
	cancelComponentEdit() {
		this.cancelPending = true;
		if (this.parsed && this.sheetSourceBefore)
			this.parsed = parsePowerDocument(this.sheetSourceBefore);
		this.closeComponentSheet();
		setTimeout(() => (this.cancelPending = false));
	}
	commitComponentDraft() {
		if (!this.currentNode || this.previewState.hasNewError || !this.previewState.document) return;
		this.parsed = this.previewState.document;
		this.closeComponentSheet();
	}

	editField(node: PowerNode | undefined, key: string, raw: string, numeric: boolean) {
		if (!this.parsed || !node) return;
		try {
			const existing = this.parsed.model.issues.map((issue) => issue.message);
			const next = applyNodeField(this.parsed, node.kind, node.index, key, raw, numeric);
			if (
				numeric &&
				next.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.includes(issue.message)
				)
			)
				return;
			this.parsed = next;
		} catch {
			/* Keep the draft visible without replacing the valid source. */
		}
	}

	openRaw() {
		if (!this.parsed) return;
		this.cancelActiveLink();
		this.selected = null;
		this.rawDraft = this.parsed.source;
		this.rawError = '';
		this.rawRevision += 1;
		this.rawOpen = true;
	}
	applyRaw() {
		try {
			this.parsed = parsePowerDocument(this.rawDraft);
			this.rawOpen = false;
			this.rawError = '';
		} catch (error) {
			this.rawError = error instanceof Error ? error.message : String(error);
		}
	}

	relationshipOptions(kind: Kind, field: string) {
		if (!this.parsed) return [];
		const nodes =
			kind === 'regulator' && field === 'output'
				? this.parsed.model.rails
				: [...this.parsed.model.sources, ...this.parsed.model.rails];
		return nodes
			.map((node) => node.name)
			.filter((name, index, names) => Boolean(name) && names.indexOf(name) === index);
	}

	addNode(kind: Kind) {
		if (!this.parsed) return;
		const rails = [...this.parsed.model.sources, ...this.parsed.model.rails].map(
			(node) => node.name
		);
		const defaults: Record<Kind, Record<string, unknown>> = {
			source: { name: `SOURCE_${this.parsed.model.sources.length + 1}`, voltage: { nominal: 12 } },
			rail: { name: `RAIL_${this.parsed.model.rails.length + 1}`, nominal_voltage: 3.3 },
			regulator: {
				name: `REG_${this.parsed.model.regulators.length + 1}`,
				type: 'buck',
				input: rails[0] ?? 'VIN',
				output: rails.at(-1) ?? 'RAIL_1',
				efficiency: 0.9
			},
			load: {
				name: `LOAD_${this.parsed.model.loads.length + 1}`,
				rail: rails.at(-1) ?? 'RAIL_1',
				quantity: 1,
				current: { typical: 0.1, maximum: 0.1 }
			}
		};
		const key =
			kind === 'source'
				? ((this.parsed.model.sources[0]?.paths.name[0] as string) ?? 'source')
				: `${kind}s`;
		const current = structuredClone(sectionData(this.parsed, key));
		const next =
			kind === 'source'
				? current === undefined
					? defaults.source
					: Array.isArray(current)
						? [...current, defaults.source]
						: [current, defaults.source]
				: [...(Array.isArray(current) ? current : []), defaults[kind]];
		this.parsed = replaceSection(this.parsed, key, next);
		const list = {
			source: this.parsed.model.sources,
			rail: this.parsed.model.rails,
			regulator: this.parsed.model.regulators,
			load: this.parsed.model.loads
		}[kind];
		this.selectNode(list[list.length - 1]);
	}

	deleteNode(node: PowerNode) {
		if (!this.parsed) return;
		const key = node.kind === 'source' ? (node.paths.name[0] as string) : `${node.kind}s`;
		const current = structuredClone(sectionData(this.parsed, key));
		const next = Array.isArray(current)
			? current.filter((_, index) => index !== node.index)
			: undefined;
		this.parsed = replaceSection(this.parsed, key, next ?? []);
		this.selected = null;
	}

	openFirstIssue() {
		const first = this.parsed?.model.issues.find((issue) => issue.subject);
		if (!first?.subject || !this.parsed) return;
		const [kind, index] = first.subject.split(':');
		const node = {
			source: this.parsed.model.sources,
			regulator: this.parsed.model.regulators,
			rail: this.parsed.model.rails,
			load: this.parsed.model.loads
		}[kind as Kind][Number(index)];
		if (node) this.selectNode(node);
	}
}
