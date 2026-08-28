import { Context, Data, Effect } from 'effect';
import { deleteDB, openDB, type DBSchema } from 'idb';

export const RECOVERY_VERSION = 1;

export interface RecoveryDraft {
	filename: string;
	source: string;
	baseSource: string;
	baseFingerprint: string;
	handle?: FileSystemFileHandle;
	timestamp: number;
	version: number;
}

interface RecoveryDB extends DBSchema {
	drafts: { key: 'active'; value: RecoveryDraft };
}

export class RecoveryError extends Data.TaggedError('RecoveryError')<{ message: string }> {}

export function isRecoveryDraft(value: unknown): value is RecoveryDraft {
	if (!value || typeof value !== 'object') return false;
	const draft = value as Partial<RecoveryDraft>;
	return (
		draft.version === RECOVERY_VERSION &&
		typeof draft.filename === 'string' &&
		typeof draft.source === 'string' &&
		typeof draft.baseSource === 'string' &&
		typeof draft.baseFingerprint === 'string' &&
		typeof draft.timestamp === 'number'
	);
}

const database = () =>
	openDB<RecoveryDB>('wattson-recovery', 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
		}
	});

export interface RecoveryServiceShape {
	load: Effect.Effect<RecoveryDraft | undefined, RecoveryError>;
	save: (draft: RecoveryDraft) => Effect.Effect<void, RecoveryError>;
	clear: Effect.Effect<void, RecoveryError>;
}

const attempt = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (error) => new RecoveryError({ message: String(error) })
	});

export class RecoveryService extends Context.Tag('wattson/RecoveryService')<
	RecoveryService,
	RecoveryServiceShape
>() {}

export const recoveryService: RecoveryServiceShape = {
	load: attempt(async () => {
		const value = await (await database()).get('drafts', 'active');
		return isRecoveryDraft(value) ? value : undefined;
	}),
	save: (draft) =>
		attempt(async () => {
			await (await database()).put('drafts', draft, 'active');
		}),
	clear: attempt(async () => {
		await (await database()).delete('drafts', 'active');
	})
};

export const resetRecoveryDatabase = () => deleteDB('wattson-recovery');
