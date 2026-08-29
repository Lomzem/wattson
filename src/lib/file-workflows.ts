import { Data, Effect } from 'effect';

type WritableHandle = FileSystemFileHandle & {
	createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
};

export class FileWorkflowError extends Data.TaggedError('FileWorkflowError')<{
	operation: 'read' | 'write';
	message: string;
}> {}

export const readHandle = (handle: FileSystemFileHandle) =>
	Effect.tryPromise({
		try: async () => (await handle.getFile()).text(),
		catch: (error) => new FileWorkflowError({ operation: 'read', message: String(error) })
	});

export const readFile = (file: File) =>
	Effect.tryPromise({
		try: () => file.text(),
		catch: (error) => new FileWorkflowError({ operation: 'read', message: String(error) })
	});

export const writeHandle = (handle: FileSystemFileHandle, source: string) =>
	Effect.tryPromise({
		try: async () => {
			const writable = await (handle as WritableHandle).createWritable();
			await writable.write(source);
			await writable.close();
		},
		catch: (error) => new FileWorkflowError({ operation: 'write', message: String(error) })
	});

export const compareAndWriteHandle = (
	handle: FileSystemFileHandle,
	source: string,
	baseSource: string,
	overwrite = false
) =>
	Effect.gen(function* () {
		const disk = yield* readHandle(handle);
		if (!overwrite && disk !== baseSource && source !== baseSource)
			return { action: 'conflict' } as const;
		if (!overwrite && disk !== baseSource) return { action: 'refresh', disk } as const;
		yield* writeHandle(handle, source);
		return { action: 'written' } as const;
	});
