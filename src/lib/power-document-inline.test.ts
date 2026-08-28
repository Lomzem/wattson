import { expect, it } from 'vitest';
import { canonicalDocument, replaceSection } from './power-document';

it('expands an inline empty section as a valid block section', () => {
	const next = replaceSection(canonicalDocument(), 'rails', [
		{ name: 'CORE', nominal_voltage: 1.2 }
	]);
	expect(next.model.rails[0].name).toBe('CORE');
	expect(next.source).toContain('rails:\n  - name: CORE');
});
