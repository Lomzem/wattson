import { fields, relationshipField } from '$lib/power-fields';
import {
	applyNodeField,
	canonicalDocument,
	findNode,
	nodeFieldValue,
	nodesOfKind,
	nodeSubject,
	parsePowerDocument,
	powerNodes,
	replaceSection,
	sectionData,
	type FieldKey,
	type IssueId,
	type Kind,
	type LinkField,
	type ParsedPowerDocument,
	type PowerNode
} from '$lib/power-document';
import { RECOVERY_VERSION, type RecoveryDraft } from '$lib/recovery';

export type LinkMode = {
	kind: 'regulator' | 'load';
	index: number;
	field: LinkField;
	name: string;
};
export type LinkFeedback = { message: string; undoSource?: string; linkedSource?: string };

export class EditorSession {
	parsed = $state.raw<ParsedPowerDocument | null>(null);
	filename = $state('power-tree.yaml');
	baseSource = $state('');
	handle = $state<FileSystemFileHandle | undefined>();
	selected = $state<{ kind: Kind; index: number } | null>(null);
	componentDraft = $state<Partial<Record<FieldKey, string>>>({});
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
	hasUnsavedWork = $derived.by(() => {
		if (!this.parsed) return false;
		if (this.dirty || (this.rawOpen && this.rawDraft !== this.parsed.source)) return true;
		return Boolean(
			this.currentNode &&
			fields[this.currentNode.kind].some(
				({ key }) => this.componentDraft[key] !== String(nodeFieldValue(this.currentNode!, key))
			)
		);
	});
	hasTopologyEntities = $derived(
		Boolean(
			this.parsed && powerNodes(this.parsed.model, 'source', 'regulator', 'rail', 'load').length
		)
	);
	currentNode = $derived.by(() =>
		this.parsed && this.selected
			? findNode(this.parsed.model, nodeSubject(this.selected.kind, this.selected.index))
			: undefined
	);
	previewState = $derived.by(() => {
		if (!this.parsed || !this.selected || !this.currentNode)
			return { document: this.parsed, error: '', hasNewError: false };
		let document = this.parsed;
		try {
			for (const field of fields[this.currentNode.kind]) {
				if (field.key === 'name') continue;
				const raw = this.componentDraft[field.key] ?? '';
				if (raw === String(nodeFieldValue(this.currentNode, field.key))) continue;
				document = applyNodeField(
					document,
					this.currentNode.kind,
					this.currentNode.index,
					field.key,
					raw,
					field.type === 'number'
				);
			}
			const existing = this.parsed.model.issues.map(({ id }) => id);
			return {
				document,
				error: '',
				hasNewError: document.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.includes(issue.id)
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
				issue.subject === nodeSubject(this.currentNode.kind, this.currentNode.index)
		) ?? []),
		...(this.previewState.error
			? [
					{
						id: `preview:error` as IssueId,
						code: 'invalid-number' as const,
						severity: 'error' as const,
						message: this.previewState.error
					}
				]
			: [])
	]);
	visibleLinkFeedback = $derived(
		this.linkFeedback?.linkedSource && this.parsed?.source !== this.linkFeedback.linkedSource
			? null
			: this.linkFeedback
	);

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
		this.componentDraft = {};
		this.sheetSourceBefore = '';
		this.rawOpen = false;
		this.rawDraft = '';
		this.rawError = '';
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
			fields[node.kind].map((field) => [field.key, String(nodeFieldValue(node, field.key))])
		);
		this.selected = { kind: node.kind, index: node.index };
	}

	closeComponentSheet() {
		this.componentDraft = {};
		this.selected = null;
	}

	beginComponentCancel() {
		this.cancelPending = true;
	}

	cancelComponentEdit() {
		this.beginComponentCancel();
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

	setComponentField(key: FieldKey, raw: string) {
		this.componentDraft[key] = raw;
		if (key === 'name') this.editField(this.currentNode, key, raw, false);
	}

	commitComponentBlur(key: FieldKey, inputType: string) {
		if (
			key !== 'name' &&
			!this.cancelPending &&
			!this.previewState.error &&
			(inputType !== 'number' || !this.previewState.hasNewError) &&
			this.previewState.document
		)
			this.parsed = this.previewState.document;
	}

	editField(node: PowerNode | undefined, key: FieldKey, raw: string, numeric: boolean) {
		if (!this.parsed || !node) return;
		try {
			const existing = this.parsed.model.issues.map(({ id }) => id);
			const next = applyNodeField(this.parsed, node.kind, node.index, key, raw, numeric);
			if (
				numeric &&
				next.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.includes(issue.id)
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

	setRawDraft(source: string) {
		this.rawDraft = source;
	}

	closeRaw() {
		this.rawOpen = false;
		this.rawError = '';
	}

	applyRaw() {
		try {
			this.parsed = parsePowerDocument(this.rawDraft);
			this.closeRaw();
		} catch (error) {
			this.rawError = error instanceof Error ? error.message : String(error);
		}
	}

	relationshipOptions(kind: Kind, field: LinkField) {
		if (!this.parsed) return [];
		const target = relationshipField(kind, field)?.relationship.target;
		const nodes =
			target === 'rail' ? this.parsed.model.rails : powerNodes(this.parsed.model, 'source', 'rail');
		return nodes
			.map(({ name }) => name)
			.filter((name, index, names) => Boolean(name) && names.indexOf(name) === index);
	}

	addNode(kind: Kind) {
		if (!this.parsed) return;
		const rails = powerNodes(this.parsed.model, 'source', 'rail').map(({ name }) => name);
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
		const list = nodesOfKind(this.parsed.model, kind);
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
		const first = this.parsed?.model.issues.find(({ subject }) => subject);
		if (!first?.subject || !this.parsed) return;
		const node = findNode(this.parsed.model, first.subject);
		if (node) this.selectNode(node);
	}

	startLink(node: PowerNode, field: LinkField) {
		if ((node.kind !== 'regulator' && node.kind !== 'load') || !relationshipField(node.kind, field))
			return false;
		this.selected = null;
		this.rawOpen = false;
		this.linkMode = {
			kind: node.kind,
			index: node.index,
			field,
			name: node.name || `Unnamed ${node.kind}`
		};
		this.linkError = '';
		this.linkFeedback = null;
		return true;
	}

	isLinkTarget(node: PowerNode) {
		if (!this.linkMode || !node.name) return false;
		const target = relationshipField(this.linkMode.kind, this.linkMode.field)?.relationship.target;
		return target === 'rail'
			? node.kind === 'rail'
			: node.kind === 'source' || node.kind === 'rail';
	}

	commitLink(target: PowerNode) {
		if (!this.parsed || !this.linkMode || !this.isLinkTarget(target)) return;
		const before = this.parsed.source;
		const next = applyNodeField(
			this.parsed,
			this.linkMode.kind,
			this.linkMode.index,
			this.linkMode.field,
			target.name
		);
		if (next.model.issues.some(({ code }) => code === 'cycle')) {
			this.linkError = `Cannot link ${this.linkMode.name} to ${target.name}: this would create a regulator cycle.`;
			return;
		}
		const relationship = this.linkMode.field === 'rail' ? 'supply' : this.linkMode.field;
		this.parsed = next;
		this.linkFeedback = {
			message: `${this.linkMode.name} ${relationship} changed to ${target.name}.`,
			undoSource: before,
			linkedSource: next.source
		};
		this.linkMode = null;
		this.linkError = '';
	}

	undoLink() {
		if (!this.linkFeedback?.undoSource) return;
		this.parsed = parsePowerDocument(this.linkFeedback.undoSource);
		this.linkFeedback = { message: 'Link change undone.' };
	}

	linkInstruction() {
		if (!this.linkMode) return '';
		if (this.linkMode.field === 'input')
			return `Select a source or rail for ${this.linkMode.name}'s input.`;
		if (this.linkMode.field === 'output')
			return `Select a rail for ${this.linkMode.name}'s output.`;
		return `Select a source or rail to supply ${this.linkMode.name}.`;
	}

	recoveryDraft(): RecoveryDraft | undefined {
		if (!this.parsed) return;
		if (!this.hasUnsavedWork) return;
		return {
			filename: this.filename,
			source: this.parsed.source,
			baseSource: this.baseSource,
			handle: this.handle,
			timestamp: Date.now(),
			version: RECOVERY_VERSION,
			raw: this.rawOpen ? { open: true, source: this.rawDraft } : undefined,
			component:
				this.selected && this.currentNode
					? {
							selected: { ...this.selected },
							fields: { ...this.componentDraft } as Record<string, string>,
							sourceBefore: this.sheetSourceBefore
						}
					: undefined
		};
	}

	restoreRecovery(draft: RecoveryDraft) {
		this.setDocument(
			parsePowerDocument(draft.source),
			draft.filename,
			draft.handle,
			draft.baseSource
		);
		if (draft.component) {
			const node = findNode(
				this.parsed!.model,
				nodeSubject(draft.component.selected.kind, draft.component.selected.index)
			);
			if (node) {
				this.selected = draft.component.selected;
				this.componentDraft = draft.component.fields;
				this.sheetSourceBefore = draft.component.sourceBefore;
			}
		}
		if (draft.raw?.open) {
			this.selected = null;
			this.rawDraft = draft.raw.source;
			this.rawOpen = true;
			this.rawRevision += 1;
		}
	}
}
