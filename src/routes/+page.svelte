<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { createHotkey } from '@tanstack/svelte-hotkeys';
	import { Effect } from 'effect';
	import { DownloadSimple, DotsThree, Moon, Sun, Warning } from 'phosphor-svelte';
	import { mode, setMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Kbd from '$lib/components/ui/kbd';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { parsePowerDocument } from '$lib/power-document';
	import { RECOVERY_VERSION, recoveryService, type RecoveryDraft } from '$lib/recovery';
	import { compareAndWriteHandle, readFile, readHandle } from '$lib/file-workflows';
	import EditorPanels from './EditorPanels.svelte';
	import { EditorSession } from './editor-session.svelte';
	import TopologyView from './TopologyView.svelte';

	type PickerWindow = Window & {
		showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
		showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
	};

	const editor = new EditorSession();
	let shortcutsOpen = $state(false);
	let conflictOpen = $state(false);
	let recovery = $state<RecoveryDraft | undefined>();
	let recoveryOpen = $state(false);
	let input: HTMLInputElement;
	const fileInput: Attachment<HTMLInputElement> = (node) => {
		input = node;
	};
	const directAccess = $derived(
		typeof window !== 'undefined' && Boolean((window as PickerWindow).showSaveFilePicker)
	);
	const validationIssueLabel = $derived(
		editor.parsed?.model.issues.length === 1
			? '1 validation issue'
			: `${editor.parsed?.model.issues.length ?? 0} validation issues`
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

	async function openFile(file: File, fileHandle?: FileSystemFileHandle) {
		if (!/\.ya?ml$/i.test(file.name)) return;
		try {
			const next = await Effect.runPromise(
				Effect.gen(function* () {
					const source = yield* readFile(file);
					const document = yield* Effect.try(() => parsePowerDocument(source));
					yield* recoveryService.clear.pipe(Effect.ignore);
					return document;
				})
			);
			editor.setDocument(next, file.name, fileHandle);
		} catch (error) {
			window.alert(`Cannot open YAML: ${error instanceof Error ? error.message : error}`);
		}
	}

	async function openCommand() {
		editor.clearLinkState();
		if (editor.dirty && !window.confirm('Discard the current unsaved changes?')) return;
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
		if (editor.dirty && !window.confirm('Discard the current unsaved changes?')) return;
		editor.newDocument();
		void Effect.runPromise(recoveryService.clear).catch(() => undefined);
	}

	function download() {
		if (!editor.parsed) return;
		const url = URL.createObjectURL(new Blob([editor.parsed.source], { type: 'application/yaml' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = editor.filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function writeDirect(target: FileSystemFileHandle, overwrite = false) {
		if (!editor.parsed) return;
		const source = editor.parsed.source;
		const result = await Effect.runPromise(
			compareAndWriteHandle(target, source, editor.baseSource, overwrite)
		);
		if (result.action === 'conflict') {
			conflictOpen = true;
			return;
		}
		if (result.action === 'refresh') {
			editor.setDocument(parsePowerDocument(result.disk), target.name, target);
			return;
		}
		await Effect.runPromise(recoveryService.clear).catch(() => undefined);
		editor.handle = target;
		editor.baseSource = source;
	}
	async function saveCommand() {
		if (!editor.parsed || (editor.handle && !editor.dirty)) return;
		if (editor.handle)
			await writeDirect(editor.handle).catch((error) => window.alert(`Save failed: ${error}`));
		else download();
	}
	async function saveAsCommand() {
		if (!editor.parsed) return;
		const picker = (window as PickerWindow).showSaveFilePicker;
		if (!picker) return download();
		try {
			const nextHandle = await picker({
				suggestedName: editor.filename,
				types: [{ description: 'YAML', accept: { 'application/yaml': ['.yaml', '.yml'] } }]
			});
			editor.filename = nextHandle.name;
			await writeDirect(nextHandle, true);
		} catch (error) {
			if ((error as DOMException).name !== 'AbortError') window.alert(String(error));
		}
	}

	function canUseTopologyShortcut() {
		if (!editor.parsed || editor.linkMode || typeof document === 'undefined') return false;
		if (
			document.activeElement?.closest(
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
	function recoveryDraft(): RecoveryDraft | undefined {
		if (!editor.parsed || !editor.dirty) return;
		return {
			filename: editor.filename,
			source: editor.parsed.source,
			baseSource: editor.baseSource,
			handle: editor.handle,
			timestamp: Date.now(),
			version: RECOVERY_VERSION
		};
	}
	async function saveRecovery(draft = recoveryDraft()) {
		if (draft) await Effect.runPromise(recoveryService.save(draft)).catch(() => undefined);
	}
	function handleVisibilityChange() {
		if (document.visibilityState === 'hidden') void saveRecovery();
	}
	async function handleWindowFocus() {
		if (!editor.handle || !editor.parsed || !editor.dirty) return;
		try {
			if ((await Effect.runPromise(readHandle(editor.handle))) !== editor.baseSource)
				conflictOpen = true;
		} catch {
			/* Permission can lapse between sessions. */
		}
	}

	createHotkey('Mod+O', openCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+S', saveCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey('Mod+Shift+S', saveAsCommand, { preventDefault: true, ignoreInputs: true });
	createHotkey(
		'Shift+N',
		() => {
			if (canUseTopologyShortcut()) newCommand();
		},
		() => ({ enabled: Boolean(editor.parsed), preventDefault: true, ignoreInputs: true })
	);
	createHotkey('Mod+Shift+Y', () => editor.openRaw(), { preventDefault: true, ignoreInputs: true });
	for (const [hotkey, kind] of [
		['S', 'source'],
		['E', 'regulator'],
		['A', 'rail'],
		['L', 'load']
	] as const)
		createHotkey(
			hotkey,
			() => {
				if (canUseTopologyShortcut()) editor.addNode(kind);
			},
			() => ({ enabled: Boolean(editor.parsed), ignoreInputs: true })
		);

	$effect(() => {
		const draft = recoveryDraft();
		if (!draft) {
			if (editor.parsed) void Effect.runPromise(recoveryService.clear).catch(() => undefined);
			return;
		}
		const timer = setTimeout(() => void saveRecovery(draft), 700);
		return () => clearTimeout(timer);
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
	});
</script>

<svelte:head><title>Wattson | Powerman YAML editor</title></svelte:head>
<svelte:window onfocus={handleWindowFocus} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<input
	class="sr-only"
	{@attach fileInput}
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

{#snippet themeToggle()}<Button
		variant="outline"
		size="icon-sm"
		aria-label={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
		onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}
		>{#if mode.current === 'dark'}<Sun />{:else}<Moon />{/if}</Button
	>{/snippet}

{#if !editor.parsed}
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
				<Button variant="outline" onclick={openCommand}>Open YAML</Button><Button
					onclick={newCommand}>New YAML</Button
				>
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
					<span class="truncate text-sm font-medium">{editor.filename}</span>{#if editor.dirty}<span
							class="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">Modified</span
						>{/if}
				</div>
			</div>
			{#if editor.parsed.model.issues.length}<Tooltip.Provider
					><Tooltip.Root
						><Tooltip.Trigger
							>{#snippet child({ props })}<Button
									{...props}
									variant="ghost"
									size="sm"
									aria-label={validationIssueLabel}
									onclick={() => editor.openFirstIssue()}
									><Warning />{editor.parsed!.model.issues.length}</Button
								>{/snippet}</Tooltip.Trigger
						><Tooltip.Content role="tooltip">{validationIssueLabel}</Tooltip.Content></Tooltip.Root
					></Tooltip.Provider
				>{/if}
			<Button size="sm" onclick={saveCommand} disabled={Boolean(editor.handle && !editor.dirty)}
				>{#if editor.handle}{editor.dirty ? 'Save' : 'Saved'}{:else}<DownloadSimple /> Download{/if}</Button
			>
			{@render themeToggle()}
			<DropdownMenu.Root
				><DropdownMenu.Trigger
					>{#snippet child({ props })}<Button
							{...props}
							variant="outline"
							size="icon-sm"
							aria-label="More file actions"><DotsThree /></Button
						>{/snippet}</DropdownMenu.Trigger
				><DropdownMenu.Content align="end" class="w-60">
					<DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={newCommand}
						><span>New YAML</span><Kbd.Group class="justify-self-end" aria-hidden="true"
							><Kbd.Root>Shift</Kbd.Root><Kbd.Root>N</Kbd.Root></Kbd.Group
						></DropdownMenu.Item
					>
					<DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={openCommand}
						><span>Open File</span><Kbd.Group class="justify-self-end" aria-hidden="true"
							><Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>O</Kbd.Root></Kbd.Group
						></DropdownMenu.Item
					>
					{#if directAccess}<DropdownMenu.Item
							class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
							onclick={saveAsCommand}
							><span>Save As</span><Kbd.Group class="justify-self-end" aria-hidden="true"
								><Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>Shift</Kbd.Root><Kbd.Root>S</Kbd.Root
								></Kbd.Group
							></DropdownMenu.Item
						>{/if}
					<DropdownMenu.Separator /><DropdownMenu.Item
						class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 whitespace-nowrap"
						onclick={() => editor.openRaw()}
						><span>View Raw YAML</span><Kbd.Group class="justify-self-end" aria-hidden="true"
							><Kbd.Root>Ctrl</Kbd.Root><Kbd.Root>Shift</Kbd.Root><Kbd.Root>Y</Kbd.Root></Kbd.Group
						></DropdownMenu.Item
					>
					<DropdownMenu.Separator /><DropdownMenu.Item
						class="whitespace-nowrap"
						onclick={() => (shortcutsOpen = true)}>Keyboard Shortcuts</DropdownMenu.Item
					>
				</DropdownMenu.Content></DropdownMenu.Root
			>
		</header>
		<main class="mx-auto max-w-[1500px] px-4 py-8 sm:px-8 sm:py-12"><TopologyView {editor} /></main>
	</div>
{/if}

<EditorPanels {editor} />

<Dialog.Root bind:open={shortcutsOpen}
	><Dialog.Content class="sm:max-w-md"
		><Dialog.Header><Dialog.Title>Keyboard Shortcuts</Dialog.Title></Dialog.Header>
		<dl class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2">
			{#each shortcutRows as shortcut (shortcut.action)}<dt>{shortcut.action}</dt>
				<dd>
					<Kbd.Group
						>{#each shortcut.keys as key, index (`${shortcut.action}:${key}:${index}`)}<Kbd.Root
								>{key}</Kbd.Root
							>{#if index < shortcut.keys.length - 1}<span aria-hidden="true">+</span
								>{/if}{/each}</Kbd.Group
					>
				</dd>{/each}
		</dl></Dialog.Content
	></Dialog.Root
>

<AlertDialog.Root bind:open={recoveryOpen}
	><AlertDialog.Content
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
						editor.setDocument(
							parsePowerDocument(recovery.source),
							recovery.filename,
							recovery.handle,
							recovery.baseSource
						);
					recoveryOpen = false;
				}}>Resume</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<AlertDialog.Root bind:open={conflictOpen}
	><AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title>File changed on disk</AlertDialog.Title><AlertDialog.Description
				>The disk file and this editor both changed. Choose which copy to keep.</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer class="flex-wrap"
			><AlertDialog.Cancel
				onclick={async () => {
					if (editor.handle) await openFile(await editor.handle.getFile(), editor.handle);
				}}>Reload disk</AlertDialog.Cancel
			><Button
				variant="outline"
				onclick={() => {
					download();
					conflictOpen = false;
				}}>Download mine</Button
			><AlertDialog.Action
				onclick={() => {
					if (editor.handle) void writeDirect(editor.handle, true);
				}}>Overwrite disk</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>
