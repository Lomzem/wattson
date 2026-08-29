<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { createHotkey } from '@tanstack/svelte-hotkeys';
	import { Effect } from 'effect';
	import { CaretDown, DownloadSimple, Plus, Warning, DotsThree, Moon, Sun } from 'phosphor-svelte';
	import { mode, setMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Card from '$lib/components/ui/card';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Kbd from '$lib/components/ui/kbd';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Select from '$lib/components/ui/select';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Tooltip from '$lib/components/ui/tooltip';
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
	import { RECOVERY_VERSION, recoveryService, type RecoveryDraft } from '$lib/recovery';
	import { readHandle, writeHandle } from '$lib/file-workflows';

	type PickerWindow = Window & {
		showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
		showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
	};

	let parsed = $state<ParsedPowerDocument | null>(null);
	let filename = $state('power-tree.yaml');
	let baseSource = $state('');
	let handle = $state<FileSystemFileHandle | undefined>();
	let selected = $state<{ kind: Kind; index: number } | null>(null);
	let componentDraft = $state<Record<string, string>>({});
	let sheetSourceBefore = $state('');
	let cancelPending = $state(false);
	let rawOpen = $state(false);
	let rawDraft = $state('');
	let rawError = $state('');
	let rawRevision = $state(0);
	let shortcutsOpen = $state(false);
	let conflictOpen = $state(false);
	let recovery = $state<RecoveryDraft | undefined>();
	let recoveryOpen = $state(false);
	type LinkField = 'input' | 'output' | 'rail';
	type LinkMode = { kind: 'regulator' | 'load'; index: number; field: LinkField; name: string };
	type LinkFeedback = { message: string; undoSource?: string; linkedSource?: string };
	let linkMode = $state<LinkMode | null>(null);
	let linkError = $state('');
	let linkFeedback = $state<LinkFeedback | null>(null);
	let linkCancelButton = $state<HTMLButtonElement | null>(null);
	let input: HTMLInputElement;
	let rawTextarea = $state<HTMLTextAreaElement | null>(null);
	let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

	const dirty = $derived(Boolean(parsed && parsed.source !== baseSource));
	const directAccess = $derived(
		typeof window !== 'undefined' && Boolean((window as PickerWindow).showSaveFilePicker)
	);
	const hasTopologyEntities = $derived(
		Boolean(
			parsed &&
			(parsed.model.sources.length ||
				parsed.model.regulators.length ||
				parsed.model.rails.length ||
				parsed.model.loads.length)
		)
	);
	const currentNode = $derived.by(() => {
		if (!parsed || !selected) return undefined;
		const map = {
			source: parsed.model.sources,
			regulator: parsed.model.regulators,
			rail: parsed.model.rails,
			load: parsed.model.loads
		};
		return map[selected.kind][selected.index];
	});
	const previewState = $derived.by(() => {
		if (!parsed || !selected || !currentNode)
			return { document: parsed, error: '', hasNewError: false };
		let document = parsed;
		try {
			for (const field of fields[currentNode.kind]) {
				if (field.key === 'name') continue;
				const raw = componentDraft[field.key] ?? '';
				if (raw === String(nodeValue(currentNode, field.key))) continue;
				document = applyNodeField(
					document,
					currentNode.kind,
					currentNode.index,
					field.key,
					raw,
					field.type === 'number'
				);
			}
			const existing = new Set(parsed.model.issues.map((issue) => issue.message));
			return {
				document,
				error: '',
				hasNewError: document.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.has(issue.message)
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
	const currentIssues = $derived([
		...(previewState.document?.model.issues.filter(
			(issue) =>
				!currentNode ||
				!issue.subject ||
				issue.subject === `${currentNode.kind}:${currentNode.index}`
		) ?? []),
		...(previewState.error ? [{ severity: 'error' as const, message: previewState.error }] : [])
	]);
	const validationIssueLabel = $derived(
		parsed?.model.issues.length === 1
			? '1 validation issue'
			: `${parsed?.model.issues.length ?? 0} validation issues`
	);
	const shortcutRows = $derived([
		{ action: 'Add Source', keys: ['S'] },
		{ action: 'Add Regulator', keys: ['E'] },
		{ action: 'Add Rail', keys: ['A'] },
		{ action: 'Add Load', keys: ['L'] },
		{ action: 'Open File', keys: ['Ctrl', 'O'] },
		{ action: 'Save / Download', keys: ['Ctrl', 'S'] },
		...(directAccess ? [{ action: 'Save As', keys: ['Ctrl', 'Shift', 'S'] }] : []),
		{ action: 'New YAML', keys: ['Shift', 'N'] },
		{ action: 'View Raw YAML', keys: ['Ctrl', 'Shift', 'Y'] }
	]);
	const topology = $derived.by(() => {
		if (!parsed) return { conversions: [], direct: [], unlinked: [] };
		const model = parsed.model;
		const rails = [...model.sources, ...model.rails];
		const findRail = (name: string) => rails.find((node) => node.name === name);
		const loadRail = (node: PowerNode) => String(node.data.rail ?? node.data.output ?? '');
		const conversions = model.regulators.map((regulator) => {
			const rawInputs = regulator.data.input
				? { VIN: regulator.data.input }
				: ((regulator.data.inputs ?? {}) as Record<string, unknown>);
			const inputs = Object.entries(rawInputs).map(([port, value]) => ({
				port,
				name: String(value ?? ''),
				node: findRail(String(value ?? ''))
			}));
			const outputName = String(regulator.data.output ?? regulator.data.output_rail ?? '');
			return {
				regulator,
				inputs,
				outputName,
				output: findRail(outputName),
				loads: model.loads.filter((load) => loadRail(load) === outputName)
			};
		});
		const outputNames = new Set(conversions.map((conversion) => conversion.outputName));
		const direct = rails
			.map((rail) => ({
				rail,
				loads: model.loads.filter((load) => loadRail(load) === rail.name)
			}))
			.filter((branch) => branch.loads.length && !outputNames.has(branch.rail.name));
		const usedRailNames = new Set([
			...conversions.flatMap((conversion) => conversion.inputs.map((input) => input.name)),
			...conversions.map((conversion) => conversion.outputName),
			...direct.map((branch) => branch.rail.name)
		]);
		const representedLoads = new Set([
			...conversions.flatMap((conversion) => conversion.loads),
			...direct.flatMap((branch) => branch.loads)
		]);
		return {
			conversions,
			direct,
			unlinked: [
				...rails.filter((rail) => !usedRailNames.has(rail.name)),
				...model.loads.filter((load) => !representedLoads.has(load))
			]
		};
	});

	type Field = {
		key: string;
		label: string;
		type?: 'number';
		step?: string;
		min?: string;
		max?: string;
	};

	const fields: Record<Kind, Field[]> = {
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
			{
				key: 'efficiency',
				label: 'Efficiency',
				type: 'number',
				step: '0.01',
				min: '0',
				max: '1'
			}
		],
		load: [
			{ key: 'name', label: 'Name' },
			{ key: 'rail', label: 'Rail' },
			{ key: 'quantity', label: 'Quantity', type: 'number', step: '1', min: '0' },
			{ key: 'typical', label: 'Typical current', type: 'number', step: '0.0001', min: '0' },
			{ key: 'maximum', label: 'Maximum current', type: 'number', step: '0.0001', min: '0' }
		]
	};

	function fingerprint(source: string) {
		let hash = 2166136261;
		for (let index = 0; index < source.length; index++)
			hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
		return (hash >>> 0).toString(16);
	}

	function setDocument(
		next: ParsedPowerDocument,
		name: string,
		fileHandle?: FileSystemFileHandle,
		base = next.source
	) {
		parsed = next;
		filename = name;
		baseSource = base;
		handle = fileHandle;
		selected = null;
		rawOpen = false;
		linkMode = null;
		linkError = '';
		linkFeedback = null;
	}

	async function openFile(file: File, fileHandle?: FileSystemFileHandle) {
		if (!/\.ya?ml$/i.test(file.name)) return;
		try {
			setDocument(parsePowerDocument(await file.text()), file.name, fileHandle);
			await Effect.runPromise(recoveryService.clear).catch(() => undefined);
		} catch (error) {
			window.alert(`Cannot open YAML: ${error instanceof Error ? error.message : error}`);
		}
	}

	async function openCommand() {
		if (linkMode) void cancelLink(false);
		if (dirty && !window.confirm('Discard the current unsaved changes?')) return;
		const picker = (window as PickerWindow).showOpenFilePicker;
		if (!picker) return input.click();
		try {
			const [nextHandle] = await picker({
				multiple: false,
				types: [{ description: 'YAML', accept: { 'application/yaml': ['.yaml', '.yml'] } }]
			});
			await openFile(await nextHandle.getFile(), nextHandle);
		} catch (error) {
			if ((error as DOMException).name !== 'AbortError') window.alert(String(error));
		}
	}

	function newCommand() {
		if (dirty && !window.confirm('Discard the current unsaved changes?')) return;
		setDocument(canonicalDocument(), 'power-tree.yaml');
		void Effect.runPromise(recoveryService.clear).catch(() => undefined);
	}

	function download() {
		if (!parsed) return;
		const url = URL.createObjectURL(new Blob([parsed.source], { type: 'application/yaml' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function writeDirect(target: FileSystemFileHandle, overwrite = false) {
		if (!parsed) return;
		const disk = await Effect.runPromise(readHandle(target));
		if (!overwrite && disk !== baseSource && parsed.source !== baseSource) {
			conflictOpen = true;
			return;
		}
		if (!overwrite && disk !== baseSource) {
			setDocument(parsePowerDocument(disk), target.name, target);
			return;
		}
		await Effect.runPromise(writeHandle(target, parsed.source));
		handle = target;
		baseSource = parsed.source;
		await Effect.runPromise(recoveryService.clear).catch(() => undefined);
	}

	async function saveCommand() {
		if (!parsed) return;
		if (handle && !dirty) return;
		if (handle) await writeDirect(handle).catch((error) => window.alert(`Save failed: ${error}`));
		else download();
	}

	async function saveAsCommand() {
		if (!parsed) return;
		const picker = (window as PickerWindow).showSaveFilePicker;
		if (!picker) return download();
		try {
			const nextHandle = await picker({
				suggestedName: filename,
				types: [{ description: 'YAML', accept: { 'application/yaml': ['.yaml', '.yml'] } }]
			});
			filename = nextHandle.name;
			await writeDirect(nextHandle, true);
		} catch (error) {
			if ((error as DOMException).name !== 'AbortError') window.alert(String(error));
		}
	}

	function openRaw() {
		if (!parsed) return;
		if (linkMode) void cancelLink(false);
		selected = null;
		rawDraft = parsed.source;
		rawError = '';
		rawRevision += 1;
		rawOpen = true;
	}

	function focusRawStart(event: Event) {
		event.preventDefault();
		requestAnimationFrame(() => {
			if (!rawTextarea) return;
			rawTextarea.setSelectionRange(0, 0);
			rawTextarea.scrollTop = 0;
			rawTextarea.focus({ preventScroll: true });
		});
	}

	function applyRaw() {
		try {
			parsed = parsePowerDocument(rawDraft);
			rawOpen = false;
			rawError = '';
		} catch (error) {
			rawError = error instanceof Error ? error.message : String(error);
		}
	}

	function nodeValue(node: PowerNode, key: string): string | number {
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

	function compactNumber(value: unknown) {
		const number = Number(value);
		return Number.isFinite(number) ? String(number) : String(value);
	}

	function currentValue(value: unknown) {
		const number = Number(value);
		if (!Number.isFinite(number)) return `${value} A`;
		return number !== 0 && Math.abs(number) < 1
			? `${compactNumber(number * 1000)} mA`
			: `${compactNumber(number)} A`;
	}

	function relationshipOptions(kind: Kind, field: string) {
		if (!parsed) return [];
		const nodes =
			kind === 'regulator' && field === 'output'
				? parsed.model.rails
				: [...parsed.model.sources, ...parsed.model.rails];
		return [...new Set(nodes.map((node) => node.name).filter(Boolean))];
	}

	type NodeMetric = {
		key: string;
		label: string;
		value: string;
		primary?: boolean;
	};

	function nodeMetrics(node: PowerNode): { layout: Kind; items: NodeMetric[] } {
		const data = node.data;
		if (node.kind === 'source') {
			const voltage = (data.voltage ?? {}) as Record<string, unknown>;
			return {
				layout: node.kind,
				items: [
					{
						key: 'min',
						label: 'Min',
						value: voltage.min === undefined ? '-' : `${compactNumber(voltage.min)} V`
					},
					{
						key: 'nominal',
						label: 'Nominal',
						value:
							(voltage.nominal ?? data.nominal_voltage) === undefined
								? '-'
								: `${compactNumber(voltage.nominal ?? data.nominal_voltage)} V`,
						primary: true
					},
					{
						key: 'max',
						label: 'Max',
						value: voltage.max === undefined ? '-' : `${compactNumber(voltage.max)} V`
					}
				]
			};
		}
		if (node.kind === 'rail') {
			return {
				layout: node.kind,
				items: [
					{
						key: 'min',
						label: 'Min',
						value: data.min_voltage === undefined ? '-' : `${compactNumber(data.min_voltage)} V`
					},
					{
						key: 'nominal',
						label: 'Nominal',
						value:
							(data.nominal_voltage ?? data.voltage) === undefined
								? '-'
								: `${compactNumber(data.nominal_voltage ?? data.voltage)} V`,
						primary: true
					},
					{
						key: 'max',
						label: 'Max',
						value: data.max_voltage === undefined ? '-' : `${compactNumber(data.max_voltage)} V`
					}
				]
			};
		}
		if (node.kind === 'regulator') {
			return {
				layout: node.kind,
				items: [
					{
						key: 'efficiency',
						label: 'Efficiency',
						value:
							data.efficiency === undefined
								? undefined
								: `${compactNumber(Number(data.efficiency) * 100)}%`
					},
					{
						key: 'current-limit',
						label: 'Current limit',
						value:
							data.max_output_current === undefined
								? undefined
								: `${compactNumber(data.max_output_current)} A`
					}
				].filter((metric): metric is NodeMetric => metric.value !== undefined)
			};
		}
		const current = (data.current ?? {}) as Record<string, unknown>;
		return {
			layout: node.kind,
			items: [
				{
					key: 'quantity',
					label: 'Quantity',
					value: data.quantity === undefined ? undefined : compactNumber(data.quantity),
					primary: true
				},
				...Object.entries(current).map(([mode, value]) => ({
					key: mode,
					label: `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`,
					value: currentValue(value)
				}))
			].filter((metric): metric is NodeMetric => metric.value !== undefined)
		};
	}

	function editField(node: PowerNode | undefined, key: string, raw: string, numeric: boolean) {
		if (!parsed || !node) return;
		try {
			const existing = new Set(parsed.model.issues.map((issue) => issue.message));
			const next = applyNodeField(parsed, node.kind, node.index, key, raw, numeric);
			if (
				numeric &&
				next.model.issues.some(
					(issue) => issue.severity === 'error' && !existing.has(issue.message)
				)
			)
				return;
			parsed = next;
		} catch {
			// Keep the draft visible without replacing the valid source.
		}
	}

	function inputComponentField(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const key = input.id.startsWith('field-') ? input.id.slice(6) : '';
		if (!key) return;
		componentDraft[key] = input.value;
		if (key === 'name') editField(currentNode, key, input.value, false);
	}

	function blurComponentField(event: FocusEvent) {
		const input = event.currentTarget as HTMLInputElement;
		const key = input.id.startsWith('field-') ? input.id.slice(6) : '';
		if (
			key &&
			key !== 'name' &&
			!cancelPending &&
			!previewState.error &&
			(input.type !== 'number' || !previewState.hasNewError) &&
			previewState.document
		)
			parsed = previewState.document;
	}

	function closeComponentSheet() {
		componentDraft = {};
		selected = null;
	}

	function commitComponentDraft() {
		if (!currentNode || previewState.hasNewError || !previewState.document) return;
		parsed = previewState.document;
		closeComponentSheet();
	}

	function submitComponentEdit(event: SubmitEvent) {
		event.preventDefault();
		commitComponentDraft();
	}

	function cancelComponentEdit() {
		cancelPending = true;
		if (parsed && sheetSourceBefore) parsed = parsePowerDocument(sheetSourceBefore);
		closeComponentSheet();
		setTimeout(() => (cancelPending = false));
	}

	function escapeComponentEdit(event: KeyboardEvent) {
		event.preventDefault();
		cancelComponentEdit();
	}

	function addNode(kind: Kind) {
		if (!parsed) return;
		const rails = [...parsed.model.sources, ...parsed.model.rails].map((node) => node.name);
		const defaults: Record<Kind, Record<string, unknown>> = {
			source: { name: `SOURCE_${parsed.model.sources.length + 1}`, voltage: { nominal: 12 } },
			rail: { name: `RAIL_${parsed.model.rails.length + 1}`, nominal_voltage: 3.3 },
			regulator: {
				name: `REG_${parsed.model.regulators.length + 1}`,
				type: 'buck',
				input: rails[0] ?? 'VIN',
				output: rails.at(-1) ?? 'RAIL_1',
				efficiency: 0.9
			},
			load: {
				name: `LOAD_${parsed.model.loads.length + 1}`,
				rail: rails.at(-1) ?? 'RAIL_1',
				quantity: 1,
				current: { typical: 0.1, maximum: 0.1 }
			}
		};
		const key =
			kind === 'source'
				? ((parsed.model.sources[0]?.paths.name[0] as string) ?? 'source')
				: `${kind}s`;
		const current = structuredClone(sectionData(parsed, key));
		let next: unknown;
		if (kind === 'source')
			next =
				current === undefined
					? defaults.source
					: Array.isArray(current)
						? [...current, defaults.source]
						: [current, defaults.source];
		else next = [...(Array.isArray(current) ? current : []), defaults[kind]];
		parsed = replaceSection(parsed, key, next);
		const list =
			kind === 'source'
				? parsed.model.sources
				: kind === 'rail'
					? parsed.model.rails
					: kind === 'regulator'
						? parsed.model.regulators
						: parsed.model.loads;
		selectNode(list[list.length - 1]);
	}

	function deleteNode(node: PowerNode) {
		if (!parsed) return;
		const key = node.kind === 'source' ? (node.paths.name[0] as string) : `${node.kind}s`;
		const current = structuredClone(sectionData(parsed, key));
		const next = Array.isArray(current)
			? current.filter((_, index) => index !== node.index)
			: undefined;
		parsed = replaceSection(parsed, key, next ?? []);
		selected = null;
	}

	function openFirstIssue() {
		const first = parsed?.model.issues.find((issue) => issue.subject);
		if (!first?.subject || !parsed) return;
		const [kind, index] = first.subject.split(':');
		const node = {
			source: parsed.model.sources,
			regulator: parsed.model.regulators,
			rail: parsed.model.rails,
			load: parsed.model.loads
		}[kind as Kind][Number(index)];
		if (node) selectNode(node);
	}

	function canUseTopologyShortcut() {
		if (!parsed || linkMode || typeof document === 'undefined') return false;
		const active = document.activeElement;
		if (
			active?.closest(
				'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]'
			)
		)
			return false;
		return !document.querySelector(
			'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'
		);
	}

	async function clearRecovery() {
		await Effect.runPromise(recoveryService.clear).catch(() => undefined);
		recovery = undefined;
		recoveryOpen = false;
	}

	async function saveRecovery() {
		if (!parsed || !dirty) return;
		await Effect.runPromise(
			recoveryService.save({
				filename,
				source: parsed.source,
				baseSource,
				baseFingerprint: fingerprint(baseSource),
				handle,
				timestamp: Date.now(),
				version: RECOVERY_VERSION
			})
		).catch(() => undefined);
	}

	function selectNode(node: PowerNode) {
		rawOpen = false;
		sheetSourceBefore = parsed?.source ?? '';
		cancelPending = false;
		componentDraft = Object.fromEntries(
			fields[node.kind].map((field) => [field.key, String(nodeValue(node, field.key))])
		);
		selected = { kind: node.kind, index: node.index };
	}

	function isLinkTarget(node: PowerNode) {
		if (!linkMode || !node.name) return false;
		return linkMode.field === 'output'
			? node.kind === 'rail'
			: node.kind === 'source' || node.kind === 'rail';
	}

	function startLink(node: PowerNode, field: LinkField) {
		if (node.kind !== 'regulator' && node.kind !== 'load') return;
		selected = null;
		rawOpen = false;
		linkMode = {
			kind: node.kind,
			index: node.index,
			field,
			name: node.name || `Unnamed ${node.kind}`
		};
		linkError = '';
		linkFeedback = null;
		void tick().then(() => requestAnimationFrame(() => linkCancelButton?.focus()));
	}

	function editNodeAction(node: PowerNode) {
		if (linkMode) void cancelLink(false);
		selectNode(node);
	}

	function deleteNodeAction(node: PowerNode) {
		if (linkMode) void cancelLink(false);
		deleteNode(node);
	}

	async function cancelLink(restoreFocus = true) {
		const initiator = linkMode;
		linkMode = null;
		linkError = '';
		if (!initiator || !restoreFocus) return;
		await tick();
		document
			.querySelector<HTMLElement>(`[data-node-key="${initiator.kind}:${initiator.index}"]`)
			?.focus();
	}

	function commitLink(target: PowerNode) {
		if (!parsed || !linkMode || !isLinkTarget(target)) return;
		const before = parsed.source;
		const next = applyNodeField(parsed, linkMode.kind, linkMode.index, linkMode.field, target.name);
		if (
			next.model.issues.some(
				(issue) => issue.message === 'The regulator topology contains a cycle.'
			)
		) {
			linkError = `Cannot link ${linkMode.name} to ${target.name}: this would create a regulator cycle.`;
			return;
		}
		const relationship = linkMode.field === 'rail' ? 'supply' : linkMode.field;
		parsed = next;
		linkFeedback = {
			message: `${linkMode.name} ${relationship} changed to ${target.name}.`,
			undoSource: before,
			linkedSource: next.source
		};
		linkMode = null;
		linkError = '';
	}

	function undoLink() {
		if (!linkFeedback?.undoSource) return;
		parsed = parsePowerDocument(linkFeedback.undoSource);
		linkFeedback = { message: 'Link change undone.' };
	}

	function linkInstruction() {
		if (!linkMode) return '';
		if (linkMode.field === 'input') return `Select a source or rail for ${linkMode.name}'s input.`;
		if (linkMode.field === 'output') return `Select a rail for ${linkMode.name}'s output.`;
		return `Select a source or rail to supply ${linkMode.name}.`;
	}

	function handleLinkEscape(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !linkMode) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		void cancelLink();
	}

	createHotkey('Mod+O', openCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+S', saveCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+Shift+S', saveAsCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey(
		'Shift+N',
		() => {
			if (canUseTopologyShortcut()) newCommand();
		},
		() => ({ enabled: Boolean(parsed), preventDefault: true, ignoreInputs: true })
	);
	createHotkey('Mod+Shift+Y', openRaw, { preventDefault: true, ignoreInputs: true });
	for (const [hotkey, kind] of [
		['S', 'source'],
		['E', 'regulator'],
		['A', 'rail'],
		['L', 'load']
	] as const)
		createHotkey(
			hotkey,
			() => {
				if (canUseTopologyShortcut()) addNode(kind);
			},
			() => ({ enabled: Boolean(parsed), ignoreInputs: true })
		);

	$effect(() => {
		if (linkFeedback?.linkedSource && parsed?.source !== linkFeedback.linkedSource) {
			linkFeedback = null;
		}
	});

	$effect(() => {
		if (!dirty) {
			if (parsed) void Effect.runPromise(recoveryService.clear).catch(() => undefined);
			return;
		}
		clearTimeout(recoveryTimer);
		recoveryTimer = setTimeout(saveRecovery, 700);
		return () => clearTimeout(recoveryTimer);
	});

	onMount(() => {
		Effect.runPromise(recoveryService.load)
			.then((draft) => {
				if (draft) {
					recovery = draft;
					recoveryOpen = true;
				}
			})
			.catch(() => undefined);
		const visibility = () => {
			if (document.visibilityState === 'hidden') void saveRecovery();
		};
		const focus = async () => {
			if (!handle || !parsed || !dirty) return;
			try {
				if ((await Effect.runPromise(readHandle(handle))) !== baseSource) conflictOpen = true;
			} catch {
				/* Permission can lapse between sessions. */
			}
		};
		document.addEventListener('visibilitychange', visibility);
		window.addEventListener('focus', focus);
		return () => {
			document.removeEventListener('visibilitychange', visibility);
			window.removeEventListener('focus', focus);
		};
	});
</script>

<svelte:head><title>Wattson | Powerman YAML editor</title></svelte:head>
<svelte:window onkeydown={handleLinkEscape} />

<input
	class="sr-only"
	bind:this={input}
	type="file"
	tabindex="-1"
	aria-label="YAML file input"
	accept=".yaml,.yml,application/yaml"
	onchange={(event) => {
		const file = event.currentTarget.files?.[0];
		if (file) void openFile(file);
		event.currentTarget.value = '';
	}}
/>

{#snippet topologyNode(node: PowerNode, context: string)}
	{@const metrics = nodeMetrics(node)}
	{@const linkTarget = isLinkTarget(node)}
	{@const linkBlocked = Boolean(linkMode && !linkTarget)}
	<div class="node-shell">
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="node topology-node"
						class:node-link-target={linkTarget}
						class:node-link-blocked={linkBlocked}
						class:node-issue={parsed?.model.issues.some(
							(issue) => issue.subject === `${node.kind}:${node.index}`
						)}
						data-node-key={`${node.kind}:${node.index}`}
						data-link-target={linkTarget || undefined}
						tabindex={linkBlocked ? -1 : 0}
						disabled={linkBlocked}
						aria-label={`${node.kind} ${node.name || 'unnamed'}, ${context}${linkTarget ? ', link target' : ''}${metrics.items.length ? `, ${metrics.items.map((metric) => `${metric.label} ${metric.value}`).join(', ')}` : ''}`}
						onclick={() => (linkTarget ? commitLink(node) : selectNode(node))}
					>
						<span class="node-content">
							<span class="node-kind-row">
								<span class="node-kind">{node.kind}</span>
								{#if linkTarget}<span class="node-link-cue">Link here</span>{/if}
							</span>
							<span class="node-name">{node.name || `Unnamed ${node.kind}`}</span>
							{#if metrics.items.length}<dl class={`node-metrics node-metrics-${metrics.layout}`}>
									{#each metrics.items as metric (metric.key)}<div
											class="node-metric"
											class:node-metric-primary={metric.primary}
											data-metric={metric.key}
										>
											<dt>{metric.label}</dt>
											<dd>{metric.value}</dd>
										</div>{/each}
								</dl>{/if}
						</span>
						{#if parsed?.model.issues.some((issue) => issue.subject === `${node.kind}:${node.index}`)}
							<Warning class="size-4 shrink-0" /><span class="sr-only">Has validation issues</span>
						{/if}
					</button>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Content>
				<ContextMenu.Item class="node-action-item" onclick={() => editNodeAction(node)}
					>Edit</ContextMenu.Item
				>
				{#if node.kind === 'regulator'}
					<ContextMenu.Item class="node-action-item" onclick={() => startLink(node, 'input')}
						>Change input</ContextMenu.Item
					>
					<ContextMenu.Item class="node-action-item" onclick={() => startLink(node, 'output')}
						>Change output</ContextMenu.Item
					>
				{:else if node.kind === 'load'}
					<ContextMenu.Item class="node-action-item" onclick={() => startLink(node, 'rail')}
						>Change supply</ContextMenu.Item
					>
				{/if}
				<ContextMenu.Item
					class="node-action-item"
					variant="destructive"
					onclick={() => deleteNodeAction(node)}>Delete</ContextMenu.Item
				>
			</ContextMenu.Content>
		</ContextMenu.Root>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						class="mobile-node-actions"
						variant="outline"
						size="icon-sm"
						disabled={Boolean(linkMode)}
						aria-label={`Node actions: ${node.name || 'unnamed'} (${node.kind})`}
						><DotsThree /></Button
					>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item class="node-action-item" onclick={() => editNodeAction(node)}
					>Edit</DropdownMenu.Item
				>
				{#if node.kind === 'regulator'}
					<DropdownMenu.Item class="node-action-item" onclick={() => startLink(node, 'input')}
						>Change input</DropdownMenu.Item
					>
					<DropdownMenu.Item class="node-action-item" onclick={() => startLink(node, 'output')}
						>Change output</DropdownMenu.Item
					>
				{:else if node.kind === 'load'}
					<DropdownMenu.Item class="node-action-item" onclick={() => startLink(node, 'rail')}
						>Change supply</DropdownMenu.Item
					>
				{/if}
				<DropdownMenu.Item
					class="node-action-item text-destructive"
					onclick={() => deleteNodeAction(node)}>Delete</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
{/snippet}

{#snippet themeToggle()}
	<Button
		variant="outline"
		size="icon-sm"
		aria-label={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
		onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}
	>
		{#if mode.current === 'dark'}<Sun />{:else}<Moon />{/if}
	</Button>
{/snippet}

{#if !parsed}
	<main
		class="grid min-h-screen place-items-center bg-muted/30 p-6"
		ondragover={(event) => event.preventDefault()}
		ondrop={(event) => {
			event.preventDefault();
			const file = event.dataTransfer?.files[0];
			if (file) void openFile(file);
		}}
	>
		<div class="flex flex-col items-center gap-4 text-center">
			<h1 id="product-name" class="text-2xl font-semibold">Wattson</h1>
			<div class="flex items-center justify-center gap-2">
				<Button variant="outline" onclick={openCommand}>Open YAML</Button>
				<Button onclick={newCommand}>New YAML</Button>
			</div>
		</div>
		<div class="absolute top-4 right-4 sm:top-6 sm:right-6">{@render themeToggle()}</div>
	</main>
{:else}
	<div class="min-h-screen bg-muted/30" data-testid="app-shell">
		<header
			class="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:px-5"
		>
			<div class="mr-auto min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-medium">{filename}</span>{#if dirty}<span
							class="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">Modified</span
						>{/if}
				</div>
			</div>
			{#if parsed.model.issues.length}<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="sm"
									aria-label={validationIssueLabel}
									onclick={openFirstIssue}
									><Warning />
									{parsed!.model.issues.length}</Button
								>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content role="tooltip">{validationIssueLabel}</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>{/if}
			<Button size="sm" onclick={saveCommand} disabled={Boolean(handle && !dirty)}
				>{#if handle}{dirty ? 'Save' : 'Saved'}{:else}<DownloadSimple /> Download{/if}</Button
			>
			{@render themeToggle()}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="icon-sm" aria-label="More file actions"
							><DotsThree /></Button
						>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-60">
					<DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={newCommand}
					>
						<span>New YAML</span>
						<Kbd.Group class="justify-self-end" aria-hidden="true">
							<Kbd.Root>Shift</Kbd.Root><Kbd.Root>N</Kbd.Root>
						</Kbd.Group>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={openCommand}
					>
						<span>Open File</span>
						<Kbd.Group class="justify-self-end" aria-hidden="true">
							<Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>O</Kbd.Root>
						</Kbd.Group>
					</DropdownMenu.Item>
					{#if directAccess}<DropdownMenu.Item
							class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
							onclick={saveAsCommand}
						>
							<span>Save As</span>
							<Kbd.Group class="justify-self-end" aria-hidden="true">
								<Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>Shift</Kbd.Root><Kbd.Root>S</Kbd.Root>
							</Kbd.Group>
						</DropdownMenu.Item>{/if}
					<DropdownMenu.Separator />
					<DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={openRaw}
					>
						<span>View Raw YAML</span>
						<Kbd.Group class="justify-self-end" aria-hidden="true">
							<Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>Shift</Kbd.Root><Kbd.Root>Y</Kbd.Root>
						</Kbd.Group>
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item class="whitespace-nowrap" onclick={() => (shortcutsOpen = true)}
						>Keyboard Shortcuts</DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</header>

		<main class="mx-auto max-w-[1500px] px-4 py-8 sm:px-8 sm:py-12">
			<Card.Root>
				<Card.Header class={hasTopologyEntities ? 'border-b' : undefined}>
					<Card.Title><h1>Topology</h1></Card.Title>
					<Card.Action
						><DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} size="sm"><Plus /> Add <CaretDown /></Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="min-w-40"
								>{#each ['source', 'regulator', 'rail', 'load'] as kind (kind)}<DropdownMenu.Item
										onclick={() => addNode(kind as Kind)}
										><span class="whitespace-nowrap">Add {kind}</span><Kbd.Root class="ml-auto"
											>{({ source: 'S', regulator: 'E', rail: 'A', load: 'L' } as const)[
												kind
											]}</Kbd.Root
										></DropdownMenu.Item
									>{/each}</DropdownMenu.Content
							>
						</DropdownMenu.Root></Card.Action
					>
				</Card.Header>
				{#if linkMode || linkFeedback}
					<div
						class="link-status-bar"
						class:link-status-error={Boolean(linkError)}
						role={linkError ? 'alert' : 'status'}
						aria-live={linkError ? 'assertive' : 'polite'}
					>
						<div class="min-w-0">
							<p class="font-medium">{linkMode ? linkInstruction() : linkFeedback?.message}</p>
							{#if linkError}<p class="mt-1 text-sm text-destructive">{linkError}</p>{/if}
						</div>
						{#if linkMode}
							<Button
								bind:ref={linkCancelButton}
								class="link-cancel-action"
								variant="outline"
								size="sm"
								onclick={() => cancelLink()}>Cancel</Button
							>
						{:else if linkFeedback?.undoSource}
							<Button variant="outline" size="sm" onclick={undoLink}>Undo</Button>
						{/if}
					</div>
				{/if}
				{#if hasTopologyEntities}<Card.Content>
						<nav aria-label="Topology" class="topology">
							{#if topology.conversions.length}
								<section aria-labelledby="conversion-paths">
									<div class="topology-heading">
										<h2 id="conversion-paths">Conversion paths</h2>
										<span>{topology.conversions.length}</span>
									</div>
									<ol class="power-paths">
										{#each topology.conversions as conversion (`regulator:${conversion.regulator.index}`)}
											<li class="power-path" data-path={conversion.regulator.name}>
												<div class="path-stage">
													<span class="stage-label">Input rails</span>
													<div class="branch-stack input-branches">
														{#each conversion.inputs as inputReference (inputReference.port)}
															<div class="branch-item">
																<span class="port-label">{inputReference.port}</span>
																{#if inputReference.node}
																	{@render topologyNode(
																		inputReference.node,
																		`${conversion.regulator.name} input`
																	)}
																{:else}
																	<span class="missing-reference"
																		>{inputReference.name || 'Missing input'}</span
																	>
																{/if}
															</div>
														{/each}
													</div>
												</div>
												<span class="path-link" aria-hidden="true"></span>
												<div class="path-stage">
													<span class="stage-label">Regulator</span>
													{@render topologyNode(conversion.regulator, 'conversion')}
												</div>
												<span class="path-link" aria-hidden="true"></span>
												<div class="path-stage">
													<span class="stage-label">Output rail</span>
													{#if conversion.output}
														{@render topologyNode(
															conversion.output,
															`${conversion.regulator.name} output`
														)}
													{:else}
														<span class="missing-reference"
															>{conversion.outputName || 'Missing output'}</span
														>
													{/if}
												</div>
												<span class="path-link" aria-hidden="true"></span>
												<div class="path-stage">
													<span class="stage-label">Connected loads</span>
													{#if conversion.loads.length}
														<div class="branch-stack load-branches">
															{#each conversion.loads as load (`load:${load.index}`)}
																<div class="branch-item">
																	{@render topologyNode(load, `${conversion.outputName} load`)}
																</div>
															{/each}
														</div>
													{:else}
														<span class="empty-branch">No loads</span>
													{/if}
												</div>
											</li>
										{/each}
									</ol>
								</section>
							{/if}

							{#if topology.direct.length}
								<section class="topology-section" aria-labelledby="direct-branches">
									<div class="topology-heading">
										<h2 id="direct-branches">Direct rail branches</h2>
										<span>{topology.direct.length}</span>
									</div>
									<ul class="direct-paths">
										{#each topology.direct as branch (`direct:${branch.rail.kind}:${branch.rail.index}`)}
											<li class="direct-path">
												<div class="path-stage">
													<span class="stage-label">Source or rail</span>{@render topologyNode(
														branch.rail,
														'direct feed'
													)}
												</div>
												<span class="path-link" aria-hidden="true"></span>
												<div class="path-stage">
													<span class="stage-label">Connected loads</span>
													<div class="branch-stack load-branches">
														{#each branch.loads as load (`load:${load.index}`)}<div
																class="branch-item"
															>
																{@render topologyNode(load, `${branch.rail.name} load`)}
															</div>{/each}
													</div>
												</div>
											</li>
										{/each}
									</ul>
								</section>
							{/if}

							{#if topology.unlinked.length}
								<section class="topology-section" aria-labelledby="unlinked-entities">
									<div class="topology-heading">
										<h2 id="unlinked-entities">Unlinked entities</h2>
										<span>{topology.unlinked.length}</span>
									</div>
									<ul class="unlinked-list">
										{#each topology.unlinked as node (`${node.kind}:${node.index}`)}<li>
												{@render topologyNode(node, 'unlinked')}
											</li>{/each}
									</ul>
								</section>
							{/if}
						</nav>
					</Card.Content>{/if}
			</Card.Root>
		</main>
	</div>
{/if}

<Dialog.Root bind:open={shortcutsOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Keyboard Shortcuts</Dialog.Title>
		</Dialog.Header>
		<dl class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2">
			{#each shortcutRows as shortcut (shortcut.action)}
				<dt>{shortcut.action}</dt>
				<dd>
					<Kbd.Group>
						{#each shortcut.keys as key, index (`${shortcut.action}:${key}:${index}`)}
							<Kbd.Root>{key}</Kbd.Root>{#if index < shortcut.keys.length - 1}<span
									aria-hidden="true">+</span
								>{/if}
						{/each}
					</Kbd.Group>
				</dd>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>

<Sheet.Root
	open={Boolean(selected)}
	onOpenChange={(open) => {
		if (!open) closeComponentSheet();
	}}
>
	<Sheet.Content class="overflow-y-auto sm:max-w-md" onEscapeKeydown={escapeComponentEdit}>
		{#if currentNode}
			{@const editedNode = currentNode}
			<form class="contents" onsubmit={submitComponentEdit}>
				<Sheet.Header class="pr-14">
					<Sheet.Title class="wrap-anywhere"
						>{currentNode.name || `Unnamed ${currentNode.kind}`}</Sheet.Title
					>
				</Sheet.Header>
				<div class="space-y-4 px-4">
					{#each fields[currentNode.kind] as field (field.key)}<div class="space-y-1.5">
							<Label id={`field-${field.key}-label`} for={`field-${field.key}`}>{field.label}</Label
							>
							{#if (currentNode.kind === 'regulator' && (field.key === 'input' || field.key === 'output')) || (currentNode.kind === 'load' && field.key === 'rail')}
								<Select.Root type="single" bind:value={componentDraft[field.key]}>
									<Select.Trigger
										id={`field-${field.key}`}
										aria-labelledby={`field-${field.key}-label`}
										class="relationship-select-trigger w-full"
									>
										<span class="truncate"
											>{componentDraft[field.key] || `Select ${field.label.toLowerCase()}`}</span
										>
									</Select.Trigger>
									<Select.Content>
										{#each relationshipOptions(currentNode.kind, field.key) as option (option)}
											<Select.Item class="relationship-select-item" value={option} label={option} />
										{/each}
									</Select.Content>
								</Select.Root>
							{:else}
								<Input
									id={`field-${field.key}`}
									type={field.type ?? 'text'}
									step={field.step}
									min={field.min}
									max={field.max}
									value={componentDraft[field.key] ?? ''}
									oninput={inputComponentField}
									onblur={blurComponentField}
								/>
							{/if}
						</div>{/each}
				</div>
				{#if currentIssues.length}<div class="mx-4 border-l-2 border-destructive pl-3">
						<h3 class="text-sm font-medium">Issues</h3>
						<ul class="mt-2 space-y-2 text-sm">
							{#each currentIssues as issue (issue.message)}<li>
									<span class="font-medium capitalize">{issue.severity}:</span>
									{issue.message}
								</li>{/each}
						</ul>
					</div>{/if}
				<Sheet.Footer class="border-t sm:flex-row sm:items-center">
					<Button class="order-3" type="submit">Save</Button>
					<Button
						class="order-2"
						type="button"
						variant="outline"
						onpointerdown={() => (cancelPending = true)}
						onclick={cancelComponentEdit}>Cancel</Button
					>
					<Button
						class="order-1 mt-2 text-destructive sm:mt-0 sm:mr-auto"
						type="button"
						variant="ghost"
						onclick={() => deleteNode(editedNode)}>Delete {editedNode.kind}</Button
					>
				</Sheet.Footer>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={rawOpen}>
	<Sheet.Content class="sm:max-w-2xl" onOpenAutoFocus={focusRawStart}>
		<Sheet.Header>
			<Sheet.Title>Raw YAML</Sheet.Title>
		</Sheet.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-2 px-4">
			{#key rawRevision}
				<Textarea
					id="raw-yaml"
					aria-label="Raw YAML source"
					bind:ref={rawTextarea}
					class="min-h-80 flex-1 resize-none font-mono text-xs"
					bind:value={rawDraft}
					aria-invalid={Boolean(rawError)}
				/>
			{/key}
			{#if rawError}<p class="text-sm text-destructive" role="alert">{rawError}</p>{/if}
		</div>
		<Sheet.Footer
			><Button
				variant="outline"
				onclick={() => {
					rawOpen = false;
					rawError = '';
				}}>Cancel</Button
			><Button onclick={applyRaw}>Apply</Button></Sheet.Footer
		>
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root bind:open={recoveryOpen}>
	<AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title>Resume unsaved work?</AlertDialog.Title><AlertDialog.Description
				>{recovery
					? `${recovery.filename}, saved ${new Date(recovery.timestamp).toLocaleString()}`
					: ''}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel onclick={clearRecovery}>Discard</AlertDialog.Cancel><AlertDialog.Action
				onclick={() => {
					if (recovery)
						setDocument(
							parsePowerDocument(recovery.source),
							recovery.filename,
							recovery.handle,
							recovery.baseSource
						);
					recoveryOpen = false;
				}}>Resume</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	>
</AlertDialog.Root>

<AlertDialog.Root bind:open={conflictOpen}>
	<AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title>File changed on disk</AlertDialog.Title><AlertDialog.Description
				>The disk file and this editor both changed. Choose which copy to keep.</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer class="flex-wrap"
			><AlertDialog.Cancel
				onclick={async () => {
					if (handle) await openFile(await handle.getFile(), handle);
				}}>Reload disk</AlertDialog.Cancel
			><Button
				variant="outline"
				onclick={() => {
					download();
					conflictOpen = false;
				}}>Download mine</Button
			><AlertDialog.Action
				onclick={() => {
					if (handle) void writeDirect(handle, true);
				}}>Overwrite disk</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	>
</AlertDialog.Root>
