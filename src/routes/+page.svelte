<script lang="ts">
	import { onMount } from 'svelte';
	import { createHotkey } from '@tanstack/svelte-hotkeys';
	import { Effect } from 'effect';
	import {
		CaretDown,
		DownloadSimple,
		FileArrowUp,
		Plus,
		Warning,
		DotsThree,
		Circuitry,
		Moon,
		Sun
	} from 'phosphor-svelte';
	import { mode, setMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import {
		canonicalDocument,
		parsePowerDocument,
		patchScalar,
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
	let rawOpen = $state(false);
	let rawDraft = $state('');
	let rawError = $state('');
	let rawRevision = $state(0);
	let conflictOpen = $state(false);
	let recovery = $state<RecoveryDraft | undefined>();
	let recoveryOpen = $state(false);
	let input: HTMLInputElement;
	let rawTextarea = $state<HTMLTextAreaElement | null>(null);
	let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

	const dirty = $derived(Boolean(parsed && parsed.source !== baseSource));
	const directAccess = $derived(
		typeof window !== 'undefined' && Boolean((window as PickerWindow).showSaveFilePicker)
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
	const currentIssues = $derived(
		parsed?.model.issues.filter(
			(issue) =>
				!currentNode ||
				!issue.subject ||
				issue.subject === `${currentNode.kind}:${currentNode.index}`
		) ?? []
	);
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

	const fields: Record<Kind, { key: string; label: string; type?: string }[]> = {
		source: [
			{ key: 'name', label: 'Name' },
			{ key: 'nominal', label: 'Nominal voltage', type: 'number' },
			{ key: 'min', label: 'Minimum voltage', type: 'number' },
			{ key: 'max', label: 'Maximum voltage', type: 'number' }
		],
		rail: [
			{ key: 'name', label: 'Name' },
			{ key: 'nominal', label: 'Nominal voltage', type: 'number' },
			{ key: 'min', label: 'Minimum voltage', type: 'number' },
			{ key: 'max', label: 'Maximum voltage', type: 'number' }
		],
		regulator: [
			{ key: 'name', label: 'Name' },
			{ key: 'input', label: 'Input rail' },
			{ key: 'output', label: 'Output rail' },
			{ key: 'efficiency', label: 'Efficiency', type: 'number' }
		],
		load: [
			{ key: 'name', label: 'Name' },
			{ key: 'rail', label: 'Rail' },
			{ key: 'quantity', label: 'Quantity', type: 'number' },
			{ key: 'typical', label: 'Typical current', type: 'number' },
			{ key: 'maximum', label: 'Maximum current', type: 'number' }
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

	function editField(node: PowerNode | undefined, key: string, raw: string, numeric: boolean) {
		if (!parsed || !node) return;
		const value = numeric ? Number(raw) : raw;
		if (nodeValue(node, key) === value || (numeric && raw === '')) return;
		try {
			parsed = patchScalar(parsed, node.paths[key], value);
		} catch {
			const section = node.kind === 'source' ? (node.paths.name[0] as string) : `${node.kind}s`;
			const content = structuredClone(sectionData(parsed, section));
			const item = (Array.isArray(content) ? content[node.index] : content) as Record<
				string,
				unknown
			>;
			if (!item) return;
			const path = node.paths[key].slice(Array.isArray(content) ? 2 : 1);
			let cursor = item;
			for (const part of path.slice(0, -1))
				cursor = (cursor[part] ??= {}) as Record<string, unknown>;
			cursor[path.at(-1)!] = value;
			parsed = replaceSection(parsed, section, content);
		}
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
		selected = { kind, index: list.length - 1 };
	}

	function deleteSelected() {
		if (!parsed || !currentNode) return;
		const node = currentNode;
		const key = node.kind === 'source' ? (node.paths.name[0] as string) : `${node.kind}s`;
		const current = structuredClone(sectionData(parsed, key));
		const next = Array.isArray(current)
			? current.filter((_, index) => index !== node.index)
			: undefined;
		parsed = replaceSection(parsed, key, next ?? []);
		selected = null;
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
		selected = { kind: node.kind, index: node.index };
	}

	createHotkey('Mod+O', openCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+S', saveCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+Shift+S', saveAsCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+N', newCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+Shift+Y', openRaw, { preventDefault: true, ignoreInputs: true });

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

<svelte:head
	><title>Wattson | Powerman YAML editor</title><meta
		name="description"
		content="A file-first Powerman 5000 YAML editor."
	/></svelte:head
>

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
	<button
		class="node topology-node"
		class:node-issue={parsed?.model.issues.some(
			(issue) => issue.subject === `${node.kind}:${node.index}`
		)}
		aria-label={`${node.kind} ${node.name || 'unnamed'}, ${context}`}
		onclick={() => selectNode(node)}
	>
		<span class="min-w-0">
			<span class="node-kind">{node.kind}</span>
			<span class="block truncate text-sm">{node.name || `Unnamed ${node.kind}`}</span>
		</span>
		{#if parsed?.model.issues.some((issue) => issue.subject === `${node.kind}:${node.index}`)}
			<Warning class="size-4 shrink-0" /><span class="sr-only">Has validation issues</span>
		{/if}
	</button>
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
		class="grid min-h-screen place-items-center p-6"
		ondragover={(event) => event.preventDefault()}
		ondrop={(event) => {
			event.preventDefault();
			const file = event.dataTransfer?.files[0];
			if (file) void openFile(file);
		}}
	>
		<section class="w-full max-w-md" aria-labelledby="product-name">
			<div class="mb-5 flex items-center gap-3">
				<Circuitry class="size-7 text-primary" />
				<div>
					<h1 id="product-name" class="text-2xl font-semibold">Wattson</h1>
					<p class="text-sm text-muted-foreground">Powerman 5000 YAML, without the ceremony.</p>
				</div>
			</div>
			<div class="flex gap-2">
				<Button onclick={openCommand}><FileArrowUp /> Open YAML</Button><Button
					variant="outline"
					onclick={newCommand}>New YAML</Button
				>
			</div>
			<p class="mt-4 text-xs text-muted-foreground">Or drop one .yaml or .yml file anywhere.</p>
		</section>
		<div class="absolute top-4 right-4 sm:top-6 sm:right-6">{@render themeToggle()}</div>
	</main>
{:else}
	<div class="min-h-screen bg-background">
		<header
			class="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5"
		>
			<div class="mr-auto min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-medium">{filename}</span>{#if dirty}<span
							class="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">Modified</span
						>{/if}
				</div>
			</div>
			{#if parsed.model.issues.length}<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						const first = parsed?.model.issues.find((issue) => issue.subject);
						if (first?.subject) {
							const [kind, index] = first.subject.split(':');
							selected = { kind: kind as Kind, index: Number(index) };
						}
					}}
					><Warning />
					{parsed.model.issues.length}<span class="sr-only">validation issues</span></Button
				>{/if}
			<Button variant="outline" size="sm" onclick={openCommand}>Open</Button>
			<Button size="sm" onclick={saveCommand}
				>{#if handle}Save{:else}<DownloadSimple /> Download{/if}</Button
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
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={saveAsCommand}
						>{directAccess ? 'Save As' : 'Download'}</DropdownMenu.Item
					>
					{#if handle}<DropdownMenu.Item onclick={download}>Download a copy</DropdownMenu.Item>{/if}
					<DropdownMenu.Item onclick={openRaw}>Raw YAML</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={newCommand}>New</DropdownMenu.Item>
					<DropdownMenu.Item onclick={clearRecovery}>Clear recovery</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</header>

		<main class="mx-auto max-w-[1500px] px-4 py-8 sm:px-8 sm:py-12">
			<div class="mb-6 flex justify-end">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} size="sm"><Plus /> Add <CaretDown /></Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end"
						>{#each ['source', 'regulator', 'rail', 'load'] as kind (kind)}<DropdownMenu.Item
								onclick={() => addNode(kind as Kind)}>Add {kind}</DropdownMenu.Item
							>{/each}</DropdownMenu.Content
					>
				</DropdownMenu.Root>
			</div>
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
											{#each branch.loads as load (`load:${load.index}`)}<div class="branch-item">
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
			{#if !parsed.model.sources.length && !parsed.model.regulators.length && !parsed.model.rails.length && !parsed.model.loads.length}<p
					class="py-16 text-center text-sm text-muted-foreground"
				>
					Add the first component to begin the topology.
				</p>{/if}
		</main>
	</div>
{/if}

<Sheet.Root
	open={Boolean(selected)}
	onOpenChange={(open) => {
		if (!open) selected = null;
	}}
>
	<Sheet.Content class="overflow-y-auto sm:max-w-md">
		{#if currentNode}
			{@const editedNode = currentNode}
			<Sheet.Header
				><Sheet.Title>{currentNode.name || `Unnamed ${currentNode.kind}`}</Sheet.Title
				><Sheet.Description class="capitalize">{currentNode.kind} properties</Sheet.Description
				></Sheet.Header
			>
			<div class="space-y-4 px-4">
				{#each fields[currentNode.kind] as field (field.key)}<div class="space-y-1.5">
						<Label for={`field-${field.key}`}>{field.label}</Label><Input
							id={`field-${field.key}`}
							type={field.type ?? 'text'}
							step="any"
							value={nodeValue(currentNode, field.key)}
							onblur={(event) =>
								editField(
									editedNode,
									field.key,
									event.currentTarget.value,
									field.type === 'number'
								)}
						/>
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
			<Sheet.Footer
				><Button variant="destructive" onclick={deleteSelected}>Delete {currentNode.kind}</Button
				></Sheet.Footer
			>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={rawOpen}>
	<Sheet.Content class="sm:max-w-2xl" onOpenAutoFocus={focusRawStart}>
		<Sheet.Header
			><Sheet.Title>Raw YAML</Sheet.Title><Sheet.Description
				>Changes stay in this draft until you apply them.</Sheet.Description
			></Sheet.Header
		>
		<div class="flex min-h-0 flex-1 flex-col gap-2 px-4">
			<Label for="raw-yaml">YAML draft</Label>
			{#key rawRevision}
				<Textarea
					id="raw-yaml"
					bind:ref={rawTextarea}
					class="min-h-80 flex-1 resize-none text-xs"
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
				}}>Discard</Button
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
					: 'A recovery draft is available.'}</AlertDialog.Description
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
