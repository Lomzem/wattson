import { Data, Effect, Schema } from 'effect';
import { openDB, type DBSchema } from 'idb';

export const RECOVERY_VERSION = 1;

const FileHandle = Schema.declare(
	(value): value is FileSystemFileHandle =>
		typeof value === 'object' &&
		value !== null &&
		'getFile' in value &&
		typeof value.getFile === 'function'
);

export const RecoveryDraft = Schema.Struct({
	filename: Schema.String,
	source: Schema.String,
	baseSource: Schema.String,
	handle: Schema.optional(FileHandle),
	timestamp: Schema.Number,
	version: Schema.Literal(RECOVERY_VERSION)
});

export type RecoveryDraft = typeof RecoveryDraft.Type;

interface RecoveryDB extends DBSchema {
	drafts: { key: 'active'; value: RecoveryDraft };
}

export class RecoveryError extends Data.TaggedError('RecoveryError')<{ message: string }> {}

const isRecoveryDraft = Schema.is(RecoveryDraft);

const database = () =>
	openDB<RecoveryDB>('wattson-recovery', 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
		}
	});

const attempt = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (error) => new RecoveryError({ message: String(error) })
	});

export const recoveryService = {
	load: attempt(async () => {
		const value = await (await database()).get('drafts', 'active');
		return isRecoveryDraft(value) ? value : undefined;
	}),
	save: (draft: RecoveryDraft) =>
		attempt(async () => {
			await (await database()).put('drafts', draft, 'active');
		}),
	clear: attempt(async () => {
		await (await database()).delete('drafts', 'active');
	})
};
