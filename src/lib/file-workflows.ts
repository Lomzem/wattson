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

export const writeHandle = (handle: FileSystemFileHandle, source: string) =>
	Effect.tryPromise({
		try: async () => {
			const writable = await (handle as WritableHandle).createWritable();
			await writable.write(source);
			await writable.close();
		},
		catch: (error) => new FileWorkflowError({ operation: 'write', message: String(error) })
	});
