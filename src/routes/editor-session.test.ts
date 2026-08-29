import { describe, expect, it } from 'vitest';
import { parsePowerDocument } from '$lib/power-document';
import { EditorSession } from './editor-session.svelte';

const source = `# keep this text
rails:
  - name: 'CORE'
    nominal_voltage: 1.2 # exact
`;

function openSession() {
	const editor = new EditorSession();
	editor.setDocument(parsePowerDocument(source), 'board.yaml');
	return editor;
}

describe('EditorSession recovery', () => {
	it('restores an open component draft and keeps cancel semantics', () => {
		const editor = openSession();
		editor.selectNode(editor.parsed!.model.rails[0]);
		editor.setComponentField('name', 'DRAFT_NAME');
		const recovery = editor.recoveryDraft();
		expect(recovery).toBeDefined();

		const restored = new EditorSession();
		restored.restoreRecovery(recovery!);
		expect(restored.currentNode?.name).toBe('DRAFT_NAME');
		expect(restored.componentDraft.name).toBe('DRAFT_NAME');

		restored.cancelComponentEdit();
		expect(restored.parsed?.source).toBe(source);
		expect(restored.parsed?.model.rails[0].name).toBe('CORE');
	});

	it('restores invalid raw YAML without replacing the last valid document', () => {
		const editor = openSession();
		editor.openRaw();
		editor.setRawDraft('rails: [');
		const recovery = editor.recoveryDraft();
		expect(recovery).toBeDefined();

		const restored = new EditorSession();
		restored.restoreRecovery(recovery!);
		expect(restored.parsed?.source).toBe(source);
		expect(restored.rawOpen).toBe(true);
		expect(restored.rawDraft).toBe('rails: [');
	});
});
