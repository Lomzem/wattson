import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
	createRecoveryService,
	decodeRecoveryDraft,
	RECOVERY_VERSION,
	type RecoveryDraft,
	type RecoveryStorage
} from './recovery';

const current: RecoveryDraft = {
	filename: 'tree.yaml',
	source: 'rails: []\n',
	baseSource: 'rails: []\n',
	timestamp: 1,
	version: RECOVERY_VERSION
};

describe('recovery', () => {
	it('migrates version 1 and ignores malformed or unknown data', () => {
		expect(decodeRecoveryDraft({ ...current, version: 1 })).toEqual(current);
		expect(decodeRecoveryDraft({ version: 0 })).toBeUndefined();
		expect(decodeRecoveryDraft({ ...current, source: 3 })).toBeUndefined();
	});

	it('keeps save, clear, and load ordered when storage work overlaps', async () => {
		let stored: unknown;
		const events: string[] = [];
		const storage: RecoveryStorage = {
			async save(draft) {
				events.push('save:start');
				await new Promise((resolve) => setTimeout(resolve, 10));
				stored = draft;
				events.push('save:end');
			},
			async clear() {
				events.push('clear');
				stored = undefined;
			},
			async load() {
				events.push('load');
				return stored;
			}
		};
		const service = createRecoveryService(storage);
		const results = await Promise.all([
			Effect.runPromise(service.save(current)),
			Effect.runPromise(service.clear),
			Effect.runPromise(service.load)
		]);
		const loaded = results[2];

		expect(events).toEqual(['save:start', 'save:end', 'clear', 'load']);
		expect(loaded).toBeUndefined();
	});

	it('continues queued work after a persistence failure', async () => {
		let attempts = 0;
		const service = createRecoveryService({
			async save() {
				attempts += 1;
				if (attempts === 1) throw new Error('disk full');
			},
			async load() {
				return undefined;
			},
			async clear() {}
		});

		await expect(Effect.runPromise(service.save(current))).rejects.toThrow('disk full');
		await expect(Effect.runPromise(service.save(current))).resolves.toBeUndefined();
	});
});
