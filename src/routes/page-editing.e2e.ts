import { expect, test, type Page } from '@playwright/test';

const documentSource = `source:
  name: VIN
  voltage: { min: 5, nominal: 12, max: 20 }
rails:
  - { name: 3V3, nominal_voltage: 3.3 }
regulators:
  - { name: REG_3V3, input: VIN, output: 3V3, efficiency: 0.9 }
loads:
  - { name: MCU, rail: 3V3, current: { typical: 0.1 } }
`;

async function openDocument(page: Page, source = documentSource) {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'power.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(source)
	});
}

async function openRawYaml(page: Page) {
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	return page.getByLabel('Raw YAML source');
}

test.describe('document editing', () => {
	test('creates, edits, validates, and preserves source on cancel', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Wattson' })).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Open YAML' })).toBeFocused();
		await page.getByRole('button', { name: 'New YAML' }).click();
		await expect(page.getByRole('heading', { name: 'Topology' })).toBeVisible();

		await page.getByRole('button', { name: /^Add/ }).click();
		await page.getByRole('menuitem', { name: 'Add rail' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name').fill('CORE');
		await dialog.getByLabel('Nominal voltage').fill('2.5');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: /^rail CORE/ })).toHaveCount(0);

		await page.getByRole('button', { name: /^Add/ }).click();
		await page.getByRole('menuitem', { name: 'Add rail' }).click();
		await dialog.getByLabel('Name').fill('CORE');
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('button', { name: /^rail CORE/ })).toBeVisible();

		const raw = await openRawYaml(page);
		await expect(raw).toHaveValue(/CORE/);
		await raw.fill('source: [');
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('button', { name: /^rail CORE/ })).toBeVisible();
	});

	test('previews invalid values without committing them', async ({ page }) => {
		await openDocument(page);
		await page.getByRole('button', { name: /^regulator REG_3V3/ }).click();
		const efficiency = page.getByRole('dialog').getByLabel('Efficiency');
		await efficiency.fill('1.2');
		await expect(page.getByText('REG_3V3 efficiency must be from 0 to 1.')).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');

		const raw = await openRawYaml(page);
		await expect(raw).toHaveValue(/efficiency: 0.9/);
		await expect(raw).not.toHaveValue(/efficiency: 1.2/);
	});

	test('edits relationship fields with the styled Select', async ({ page }) => {
		await openDocument(
			page,
			documentSource.replace(
				'source:\n  name: VIN\n  voltage: { min: 5, nominal: 12, max: 20 }',
				'source:\n  - { name: VIN, voltage: { min: 5, nominal: 12, max: 20 } }\n  - { name: USB, voltage: { nominal: 5 } }'
			)
		);
		await page.getByRole('button', { name: /^regulator REG_3V3/ }).click();
		const input = page.getByRole('dialog').getByLabel('Input rail');
		await input.click();
		await expect(page.getByRole('option', { name: 'USB' })).toBeVisible();
		await page.getByRole('option', { name: 'USB' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
		await expect(await openRawYaml(page)).toHaveValue(/input: USB/);
	});

	test('guards topology shortcuts while an editor or menu is open', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'New YAML' }).click();
		await page.keyboard.press('a');
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Shift+N');
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: /^rail RAIL_1/ })).toBeVisible();

		await page.getByRole('button', { name: 'More file actions' }).click();
		await page.keyboard.press('Shift+N');
		await expect(page.getByRole('menu')).toBeVisible();
		await page.keyboard.press('Escape');
		page.once('dialog', (dialog) => dialog.accept());
		await page.keyboard.press('Shift+N');
		await expect(page.getByRole('button', { name: /^rail RAIL_1/ })).toHaveCount(0);
	});
});
