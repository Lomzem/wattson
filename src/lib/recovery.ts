import { Data, Effect, Schema } from 'effect';
import { openDB, type DBSchema } from 'idb';

export const RECOVERY_VERSION = 2;

const FileHandle = Schema.declare(
	(value): value is FileSystemFileHandle =>
		typeof value === 'object' &&
		value !== null &&
		'getFile' in value &&
		typeof value.getFile === 'function'
);
const Selection = Schema.Struct({
	kind: Schema.Literal('source', 'regulator', 'rail', 'load'),
	index: Schema.Number
});
const ComponentDraft = Schema.Struct({
	selected: Selection,
	fields: Schema.Record({ key: Schema.String, value: Schema.String }),
	sourceBefore: Schema.String
});
const RawDraft = Schema.Struct({ open: Schema.Boolean, source: Schema.String });
const RecoveryDraftV1 = Schema.Struct({
	filename: Schema.String,
	source: Schema.String,
	baseSource: Schema.String,
	handle: Schema.optional(FileHandle),
	timestamp: Schema.Number,
	version: Schema.Literal(1)
});

export const RecoveryDraft = Schema.Struct({
	filename: Schema.String,
	source: Schema.String,
	baseSource: Schema.String,
	handle: Schema.optional(FileHandle),
	timestamp: Schema.Number,
	version: Schema.Literal(RECOVERY_VERSION),
	raw: Schema.optional(RawDraft),
	component: Schema.optional(ComponentDraft)
});

export type RecoveryDraft = typeof RecoveryDraft.Type;

interface RecoveryDB extends DBSchema {
	drafts: { key: 'active'; value: unknown };
}

export interface RecoveryStorage {
	load(): Promise<unknown>;
	save(draft: RecoveryDraft): Promise<void>;
	clear(): Promise<void>;
}

export class RecoveryError extends Data.TaggedError('RecoveryError')<{ message: string }> {}

export function decodeRecoveryDraft(value: unknown): RecoveryDraft | undefined {
	if (Schema.is(RecoveryDraft)(value)) return value;
	if (!Schema.is(RecoveryDraftV1)(value)) return undefined;
	return { ...value, version: RECOVERY_VERSION };
}

const database = () =>
	openDB<RecoveryDB>('wattson-recovery', 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
		}
	});

const indexedDbStorage: RecoveryStorage = {
	async load() {
		return (await database()).get('drafts', 'active');
	},
	async save(draft) {
		await (await database()).put('drafts', draft, 'active');
	},
	async clear() {
		await (await database()).delete('drafts', 'active');
	}
};

export function createRecoveryService(storage: RecoveryStorage) {
	let queue = Promise.resolve();
	const serialize = <A>(operation: () => Promise<A>) => {
		const result = queue.then(operation, operation);
		queue = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	};
	const attempt = <A>(operation: () => Promise<A>) =>
		Effect.tryPromise({
			try: () => serialize(operation),
			catch: (error) => new RecoveryError({ message: String(error) })
		});

	return {
		load: attempt(async () => {
			const stored = await storage.load();
			const draft = decodeRecoveryDraft(stored);
			if (draft && (stored as { version?: unknown })?.version !== RECOVERY_VERSION)
				await storage.save(draft);
			return draft;
		}),
		save: (draft: RecoveryDraft) => attempt(() => storage.save(draft)),
		clear: attempt(() => storage.clear())
	};
}

export const recoveryService = createRecoveryService(indexedDbStorage);
