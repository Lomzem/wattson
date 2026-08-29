import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { RecoveryDraft, RECOVERY_VERSION } from './recovery';

describe('recovery codec', () => {
	it('accepts the current minimal draft and rejects stale data', () => {
		const isRecoveryDraft = Schema.is(RecoveryDraft);
		expect(
			isRecoveryDraft({
				filename: 'tree.yaml',
				source: 'rails: []\n',
				baseSource: 'rails: []\n',
				timestamp: 1,
				version: RECOVERY_VERSION
			})
		).toBe(true);
		expect(isRecoveryDraft({ version: 0 })).toBe(false);
	});
});
