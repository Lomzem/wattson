import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { compareAndWriteHandle } from './file-workflows';

function fileHandle(diskSource: string) {
	let disk = diskSource;
	let writes = 0;
	const handle = {
		name: 'power.yaml',
		getFile: async () => new File([disk], 'power.yaml'),
		createWritable: async () => ({
			write: async (source: string) => {
				disk = source;
				writes += 1;
			},
			close: async () => undefined
		})
	} as unknown as FileSystemFileHandle;
	return { handle, disk: () => disk, writes: () => writes };
}

describe('compareAndWriteHandle', () => {
	it('reports a conflict when disk and editor both changed', async () => {
		const file = fileHandle('disk changed');
		const result = await Effect.runPromise(
			compareAndWriteHandle(file.handle, 'editor changed', 'original')
		);

		expect(result).toEqual({ action: 'conflict' });
		expect(file.disk()).toBe('disk changed');
		expect(file.writes()).toBe(0);
	});

	it('refreshes from disk when only disk changed', async () => {
		const file = fileHandle('disk changed');
		const result = await Effect.runPromise(
			compareAndWriteHandle(file.handle, 'original', 'original')
		);

		expect(result).toEqual({ action: 'refresh', disk: 'disk changed' });
		expect(file.writes()).toBe(0);
	});

	it('writes when disk still matches the editor base', async () => {
		const file = fileHandle('original');
		const result = await Effect.runPromise(
			compareAndWriteHandle(file.handle, 'editor changed', 'original')
		);

		expect(result).toEqual({ action: 'written' });
		expect(file.disk()).toBe('editor changed');
		expect(file.writes()).toBe(1);
	});

	it('overwrites a conflicting disk copy only when requested', async () => {
		const file = fileHandle('disk changed');
		const result = await Effect.runPromise(
			compareAndWriteHandle(file.handle, 'editor changed', 'original', true)
		);

		expect(result).toEqual({ action: 'written' });
		expect(file.disk()).toBe('editor changed');
		expect(file.writes()).toBe(1);
	});
});
