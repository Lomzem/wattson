import { expect, test, type Page } from '@playwright/test';

const source = `source:
  - { name: VIN, voltage: { nominal: 12 } }
  - { name: USB, voltage: { nominal: 5 } }
rails:
  - { name: 5V, nominal_voltage: 5 }
  - { name: 3V3, nominal_voltage: 3.3 }
regulators:
  - { name: REG_5V, input: VIN, output: 5V, efficiency: 0.9 }
  - { name: REG_3V3, input: 5V, output: 3V3, efficiency: 0.9 }
loads:
  - { name: MCU, rail: 3V3, current: { typical: 0.1 } }
`;

async function openDocument(page: Page) {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'linking.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(source)
	});
}

test.describe('topology linking', () => {
	test('links by pointer and supports undo', async ({ page }) => {
		await openDocument(page);
		const regulator = page.getByRole('button', { name: /^regulator REG_3V3/ }).first();
		await regulator.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Change input' }).click();
		await expect(page.getByText("Select a source or rail for REG_3V3's input.")).toBeVisible();
		await page
			.getByRole('button', { name: /^source USB.*link target/ })
			.first()
			.click();
		await expect(page.getByText('REG_3V3 input changed to USB.')).toBeVisible();
		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(page.getByText('Link change undone.')).toBeVisible();
	});

	test('supports keyboard linking and blocks regulator cycles', async ({ page }) => {
		await openDocument(page);
		const regulator = page.getByRole('button', { name: /^regulator REG_5V/ }).first();
		await regulator.focus();
		await regulator.press('Shift+F10');
		await page.getByRole('menuitem', { name: 'Change input' }).press('Enter');
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

		const target = page.getByRole('button', { name: /^rail 3V3.*link target/ }).first();
		await target.focus();
		await target.press('Enter');
		await expect(page.getByRole('alert')).toContainText('would create a regulator cycle');
		await page.keyboard.press('Escape');
		await expect(regulator).toBeFocused();
	});

	test('clears active linking when raw YAML opens', async ({ page }) => {
		await openDocument(page);
		await page
			.getByRole('button', { name: /^regulator REG_3V3/ })
			.first()
			.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Change input' }).click();
		await page.getByRole('button', { name: 'More file actions' }).click();
		await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
		await expect(page.getByLabel('Raw YAML source')).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByText("Select a source or rail for REG_3V3's input.")).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^regulator REG_3V3/ }).first()).toBeEnabled();
	});
});
