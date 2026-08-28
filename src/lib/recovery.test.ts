import { describe, expect, it } from 'vitest';
import { isRecoveryDraft, RECOVERY_VERSION } from './recovery';

describe('recovery codec', () => {
	it('accepts the current minimal draft and rejects stale data', () => {
		expect(
			isRecoveryDraft({
				filename: 'tree.yaml',
				source: 'rails: []\n',
				baseSource: 'rails: []\n',
				baseFingerprint: 'abc',
				timestamp: 1,
				version: RECOVERY_VERSION
			})
		).toBe(true);
		expect(isRecoveryDraft({ version: 0 })).toBe(false);
	});
});
