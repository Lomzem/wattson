<script lang="ts">
	import { tick } from 'svelte';
	import { CaretDown, DotsThree, Plus, Warning } from 'phosphor-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Kbd from '$lib/components/ui/kbd';
	import { relationshipFields } from '$lib/power-fields';
	import type { Kind, PowerNode } from '$lib/power-document';
	import { buildTopology } from '$lib/topology';
	import type { EditorSession } from './editor-session.svelte';

	let { editor }: { editor: EditorSession } = $props();
	let linkCancelButton = $state<HTMLButtonElement | null>(null);
	const topology = $derived(
		editor.parsed
			? buildTopology(editor.parsed.model)
			: { conversions: [], direct: [], unlinked: [] }
	);

	type NodeMetric = { key: string; label: string; value: string; primary?: boolean };
	const compactNumber = (value: unknown) =>
		Number.isFinite(Number(value)) ? String(Number(value)) : String(value);
	function currentValue(value: unknown) {
		const number = Number(value);
		if (!Number.isFinite(number)) return `${value} A`;
		return number !== 0 && Math.abs(number) < 1
			? `${compactNumber(number * 1000)} mA`
			: `${compactNumber(number)} A`;
	}
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
		if (node.kind === 'rail')
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
		if (node.kind === 'regulator')
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

	function startLink(node: PowerNode, field: 'input' | 'output' | 'rail') {
		if (editor.startLink(node, field))
			void tick().then(() => requestAnimationFrame(() => linkCancelButton?.focus()));
	}
	async function cancelLink(restoreFocus = true) {
		const initiator = editor.linkMode;
		editor.cancelActiveLink();
		if (!initiator || !restoreFocus) return;
		await tick();
		document
			.querySelector<HTMLElement>(`[data-node-key="${initiator.kind}:${initiator.index}"]`)
			?.focus();
	}
	function handleLinkEscape(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !editor.linkMode) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		void cancelLink();
	}
</script>

<svelte:window onkeydown={handleLinkEscape} />

{#snippet topologyNode(node: PowerNode, context: string)}
	{@const metrics = nodeMetrics(node)}
	{@const linkTarget = editor.isLinkTarget(node)}
	{@const linkBlocked = Boolean(editor.linkMode && !linkTarget)}
	<div class="node-shell">
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="node topology-node"
						class:node-link-target={linkTarget}
						class:node-link-blocked={linkBlocked}
						class:node-issue={editor.parsed?.model.issues.some(
							(issue) => issue.subject === `${node.kind}:${node.index}`
						)}
						data-node-key={`${node.kind}:${node.index}`}
						data-link-target={linkTarget || undefined}
						tabindex={linkBlocked ? -1 : 0}
						disabled={linkBlocked}
						aria-label={`${node.kind} ${node.name || 'unnamed'}, ${context}${linkTarget ? ', link target' : ''}${metrics.items.length ? `, ${metrics.items.map((metric) => `${metric.label} ${metric.value}`).join(', ')}` : ''}`}
						onclick={() => (linkTarget ? editor.commitLink(node) : editor.selectNode(node))}
					>
						<span class="node-content"
							><span class="node-kind-row"
								><span class="node-kind">{node.kind}</span>{#if linkTarget}<span
										class="node-link-cue">Link here</span
									>{/if}</span
							><span class="node-name">{node.name || `Unnamed ${node.kind}`}</span>
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
						{#if editor.parsed?.model.issues.some((issue) => issue.subject === `${node.kind}:${node.index}`)}<Warning
								class="size-4 shrink-0"
							/><span class="sr-only">Has validation issues</span>{/if}
					</button>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Content>
				<ContextMenu.Item
					class="node-action-item"
					onclick={() => {
						if (editor.linkMode) void cancelLink(false);
						editor.selectNode(node);
					}}>Edit</ContextMenu.Item
				>
				{#each relationshipFields(node.kind) as field (field.key)}<ContextMenu.Item
						class="node-action-item"
						onclick={() => startLink(node, field.key)}>{field.relationship.action}</ContextMenu.Item
					>{/each}
				<ContextMenu.Item
					class="node-action-item"
					variant="destructive"
					onclick={() => {
						if (editor.linkMode) void cancelLink(false);
						editor.deleteNode(node);
					}}>Delete</ContextMenu.Item
				>
			</ContextMenu.Content>
		</ContextMenu.Root>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				>{#snippet child({ props })}<Button
						{...props}
						class="mobile-node-actions"
						variant="outline"
						size="icon-sm"
						disabled={Boolean(editor.linkMode)}
						aria-label={`Node actions: ${node.name || 'unnamed'} (${node.kind})`}
						><DotsThree /></Button
					>{/snippet}</DropdownMenu.Trigger
			>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item class="node-action-item" onclick={() => editor.selectNode(node)}
					>Edit</DropdownMenu.Item
				>
				{#each relationshipFields(node.kind) as field (field.key)}<DropdownMenu.Item
						class="node-action-item"
						onclick={() => startLink(node, field.key)}
						>{field.relationship.action}</DropdownMenu.Item
					>{/each}
				<DropdownMenu.Item
					class="node-action-item text-destructive"
					onclick={() => editor.deleteNode(node)}>Delete</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
{/snippet}

<Card.Root>
	<Card.Header class={editor.hasTopologyEntities ? 'border-b' : undefined}>
		<Card.Title><h1>Topology</h1></Card.Title>
		<Card.Action
			><DropdownMenu.Root
				><DropdownMenu.Trigger
					>{#snippet child({ props })}<Button {...props} size="sm"
							><Plus /> Add <CaretDown /></Button
						>{/snippet}</DropdownMenu.Trigger
				><DropdownMenu.Content align="end" class="min-w-40"
					>{#each ['source', 'regulator', 'rail', 'load'] as kind (kind)}<DropdownMenu.Item
							onclick={() => editor.addNode(kind as Kind)}
							><span class="whitespace-nowrap">Add {kind}</span><Kbd.Root class="ml-auto"
								>{({ source: 'S', regulator: 'E', rail: 'A', load: 'L' } as const)[kind]}</Kbd.Root
							></DropdownMenu.Item
						>{/each}</DropdownMenu.Content
				></DropdownMenu.Root
			></Card.Action
		>
	</Card.Header>
	{#if editor.linkMode || editor.visibleLinkFeedback}<div
			class="link-status-bar"
			class:link-status-error={Boolean(editor.linkError)}
			role={editor.linkError ? 'alert' : 'status'}
			aria-live={editor.linkError ? 'assertive' : 'polite'}
		>
			<div class="min-w-0">
				<p class="font-medium">
					{editor.linkMode ? editor.linkInstruction() : editor.visibleLinkFeedback?.message}
				</p>
				{#if editor.linkError}<p class="mt-1 text-sm text-destructive">{editor.linkError}</p>{/if}
			</div>
			{#if editor.linkMode}<Button
					bind:ref={linkCancelButton}
					class="link-cancel-action"
					variant="outline"
					size="sm"
					onclick={() => cancelLink()}>Cancel</Button
				>{:else if editor.visibleLinkFeedback?.undoSource}<Button
					variant="outline"
					size="sm"
					onclick={() => editor.undoLink()}>Undo</Button
				>{/if}
		</div>{/if}
	{#if editor.hasTopologyEntities}<Card.Content
			><nav aria-label="Topology" class="topology">
				{#if topology.conversions.length}<section aria-labelledby="conversion-paths">
						<div class="topology-heading">
							<h2 id="conversion-paths">Conversion paths</h2>
							<span>{topology.conversions.length}</span>
						</div>
						<ol class="power-paths">
							{#each topology.conversions as conversion (`regulator:${conversion.regulator.index}`)}<li
									class="power-path"
									data-path={conversion.regulator.name}
								>
									<div class="path-stage">
										<span class="stage-label">Input rails</span>
										<div class="branch-stack input-branches">
											{#each conversion.inputs as inputReference (inputReference.port)}<div
													class="branch-item"
												>
													<span class="port-label">{inputReference.port}</span
													>{#if inputReference.node}{@render topologyNode(
															inputReference.node,
															`${conversion.regulator.name} input`
														)}{:else}<span class="missing-reference"
															>{inputReference.name || 'Missing input'}</span
														>{/if}
												</div>{/each}
										</div>
									</div>
									<span class="path-link" aria-hidden="true"></span>
									<div class="path-stage">
										<span class="stage-label">Regulator</span>{@render topologyNode(
											conversion.regulator,
											'conversion'
										)}
									</div>
									<span class="path-link" aria-hidden="true"></span>
									<div class="path-stage">
										<span class="stage-label">Output rail</span
										>{#if conversion.output}{@render topologyNode(
												conversion.output,
												`${conversion.regulator.name} output`
											)}{:else}<span class="missing-reference"
												>{conversion.outputName || 'Missing output'}</span
											>{/if}
									</div>
									<span class="path-link" aria-hidden="true"></span>
									<div class="path-stage">
										<span class="stage-label">Connected loads</span
										>{#if conversion.loads.length}<div class="branch-stack load-branches">
												{#each conversion.loads as load (`load:${load.index}`)}<div
														class="branch-item"
													>
														{@render topologyNode(load, `${conversion.outputName} load`)}
													</div>{/each}
											</div>{:else}<span class="empty-branch">No loads</span>{/if}
									</div>
								</li>{/each}
						</ol>
					</section>{/if}
				{#if topology.direct.length}<section
						class="topology-section"
						aria-labelledby="direct-branches"
					>
						<div class="topology-heading">
							<h2 id="direct-branches">Direct rail branches</h2>
							<span>{topology.direct.length}</span>
						</div>
						<ul class="direct-paths">
							{#each topology.direct as branch (`direct:${branch.rail.kind}:${branch.rail.index}`)}<li
									class="direct-path"
								>
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
								</li>{/each}
						</ul>
					</section>{/if}
				{#if topology.unlinked.length}<section
						class="topology-section"
						aria-labelledby="unlinked-entities"
					>
						<div class="topology-heading">
							<h2 id="unlinked-entities">Unlinked entities</h2>
							<span>{topology.unlinked.length}</span>
						</div>
						<ul class="unlinked-list">
							{#each topology.unlinked as node (`${node.kind}:${node.index}`)}<li>
									{@render topologyNode(node, 'unlinked')}
								</li>{/each}
						</ul>
					</section>{/if}
			</nav></Card.Content
		>{/if}
</Card.Root>
