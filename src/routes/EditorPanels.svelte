<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as Sheet from '$lib/components/ui/sheet';
	import { fields } from '$lib/power-fields';
	import type { FieldKey, LinkField } from '$lib/power-document';
	import type { EditorSession } from './editor-session.svelte';

	let { editor }: { editor: EditorSession } = $props();
	let rawTextarea = $state<HTMLTextAreaElement | null>(null);

	function inputComponentField(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const key = input.id.startsWith('field-') ? (input.id.slice(6) as FieldKey) : undefined;
		if (key) editor.setComponentField(key, input.value);
	}

	function blurComponentField(event: FocusEvent) {
		const input = event.currentTarget as HTMLInputElement;
		const key = input.id.startsWith('field-') ? (input.id.slice(6) as FieldKey) : undefined;
		if (key) editor.commitComponentBlur(key, input.type);
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
</script>

<Sheet.Root
	open={Boolean(editor.selected)}
	onOpenChange={(open) => {
		if (!open) editor.closeComponentSheet();
	}}
>
	<Sheet.Content
		class="overflow-y-auto sm:max-w-md"
		onEscapeKeydown={(event) => {
			event.preventDefault();
			editor.cancelComponentEdit();
		}}
	>
		{#if editor.currentNode}
			{@const editedNode = editor.currentNode}
			<form
				class="contents"
				onsubmit={(event) => {
					event.preventDefault();
					editor.commitComponentDraft();
				}}
			>
				<Sheet.Header class="pr-14">
					<Sheet.Title class="wrap-anywhere"
						>{editor.currentNode.name || `Unnamed ${editor.currentNode.kind}`}</Sheet.Title
					>
				</Sheet.Header>
				<div class="space-y-4 px-4">
					{#each fields[editor.currentNode.kind] as field (field.key)}
						<div class="space-y-1.5">
							<Label id={`field-${field.key}-label`} for={`field-${field.key}`}>{field.label}</Label
							>
							{#if (editor.currentNode.kind === 'regulator' && (field.key === 'input' || field.key === 'output')) || (editor.currentNode.kind === 'load' && field.key === 'rail')}
								<Select.Root
									type="single"
									bind:value={
										() => editor.componentDraft[field.key],
										(value) => editor.setComponentField(field.key, value ?? '')
									}
								>
									<Select.Trigger
										id={`field-${field.key}`}
										aria-labelledby={`field-${field.key}-label`}
										class="relationship-select-trigger w-full"
									>
										<span class="truncate"
											>{editor.componentDraft[field.key] ||
												`Select ${field.label.toLowerCase()}`}</span
										>
									</Select.Trigger>
									<Select.Content>
										{#each editor.relationshipOptions(editor.currentNode.kind, field.key as LinkField) as option (option)}
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
									value={editor.componentDraft[field.key] ?? ''}
									oninput={inputComponentField}
									onblur={blurComponentField}
								/>
							{/if}
						</div>
					{/each}
				</div>
				{#if editor.currentIssues.length}
					<div class="mx-4 border-l-2 border-destructive pl-3">
						<h3 class="text-sm font-medium">Issues</h3>
						<ul class="mt-2 space-y-2 text-sm">
							{#each editor.currentIssues as issue (issue.id)}<li>
									<span class="font-medium capitalize">{issue.severity}:</span>
									{issue.message}
								</li>{/each}
						</ul>
					</div>
				{/if}
				<Sheet.Footer class="border-t sm:flex-row sm:items-center">
					<Button class="order-3" type="submit">Save</Button>
					<Button
						class="order-2"
						type="button"
						variant="outline"
						onpointerdown={() => editor.beginComponentCancel()}
						onclick={() => editor.cancelComponentEdit()}>Cancel</Button
					>
					<Button
						class="order-1 mt-2 text-destructive sm:mt-0 sm:mr-auto"
						type="button"
						variant="ghost"
						onclick={() => editor.deleteNode(editedNode)}>Delete {editedNode.kind}</Button
					>
				</Sheet.Footer>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root
	open={editor.rawOpen}
	onOpenChange={(open) => {
		if (!open) editor.closeRaw();
	}}
>
	<Sheet.Content class="sm:max-w-2xl" onOpenAutoFocus={focusRawStart}>
		<Sheet.Header><Sheet.Title>Raw YAML</Sheet.Title></Sheet.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-2 px-4">
			{#key editor.rawRevision}
				<Textarea
					id="raw-yaml"
					aria-label="Raw YAML source"
					bind:ref={rawTextarea}
					class="min-h-80 flex-1 resize-none font-mono text-xs"
					bind:value={() => editor.rawDraft, (value) => editor.setRawDraft(value)}
					aria-invalid={Boolean(editor.rawError)}
				/>
			{/key}
			{#if editor.rawError}<p class="text-sm text-destructive" role="alert">
					{editor.rawError}
				</p>{/if}
		</div>
		<Sheet.Footer>
			<Button variant="outline" onclick={() => editor.closeRaw()}>Cancel</Button>
			<Button onclick={() => editor.applyRaw()}>Apply</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
