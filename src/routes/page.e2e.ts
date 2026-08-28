import { expect, test } from '@playwright/test';

test('creates, edits, validates raw YAML, and labels fallback download', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(message.text());
	});
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Wattson' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toBeFocused();
	const longPrefix = Array.from({ length: 160 }, (_, index) => `# design note ${index}`).join('\n');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'imported.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(
			`${longPrefix}\nsource: { name: BENCH, voltage: { nominal: 5 } }\nrails:\n  - { name: CORE, nominal_voltage: 1.2 }\nregulators:\n  - { name: U1, input: BENCH, output: CORE, efficiency: 0.9 }\nloads:\n  - { name: MCU, rail: CORE, current: { typical: 0.1 } }\n`
		)
	});
	const path = page.locator('[data-path="U1"]');
	await expect(path.getByRole('button', { name: /source BENCH/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /regulator U1/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /rail CORE/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /load MCU/ })).toBeVisible();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'Raw YAML' }).click();
	expect(browserErrors).toEqual([]);
	const importedRaw = page.getByLabel('YAML draft');
	await expect(importedRaw).toBeFocused();
	await expect
		.poll(() =>
			importedRaw.evaluate((element) => ({
				selectionStart: (element as HTMLTextAreaElement).selectionStart,
				scrollTop: element.scrollTop
			}))
		)
		.toEqual({ selectionStart: 0, scrollTop: 0 });
	await page.getByRole('button', { name: 'Discard' }).click();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'New' }).click();
	await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeVisible();

	await page.getByRole('button', { name: /^Add/ }).click();
	await page.getByRole('menuitem', { name: 'Add rail' }).click();
	await expect(page.getByRole('dialog').getByText('RAIL_1')).toBeVisible();
	const name = page.getByLabel('Name');
	await name.fill('CORE');
	await name.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	expect(browserErrors).toEqual([]);
	await page.getByRole('button', { name: /RAIL_1/ }).click();
	await page.getByLabel('Name').fill('CORE');
	await page.getByLabel('Name').blur();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'Raw YAML' }).click();
	const raw = page.getByLabel('YAML draft');
	await raw.fill('source: [');
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('dialog').getByText('Raw YAML')).toBeVisible();
	await page.getByRole('button', { name: 'Discard' }).click();
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();
	expect(browserErrors).toEqual([]);
});

test('toggles and persists the color mode', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	const root = page.locator('html');
	const darkToggle = page.getByRole('button', { name: 'Switch to dark mode' });

	await expect(root).not.toHaveClass(/dark/);
	await darkToggle.click();
	await expect(root).toHaveClass(/dark/);
	await page.reload();
	await expect(root).toHaveClass(/dark/);

	await page.getByRole('button', { name: 'Switch to light mode' }).click();
	await expect(root).not.toHaveClass(/dark/);
	await page.reload();
	await expect(root).not.toHaveClass(/dark/);

	await page.evaluate(() => localStorage.clear());
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.reload();
	await expect(root).toHaveClass(/dark/);
});

test('shows connected paths without mobile horizontal overflow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'mobile.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(
			'source: { name: VIN, voltage: { nominal: 12 } }\nrails:\n  - { name: 3V3, nominal_voltage: 3.3 }\nregulators:\n  - { name: REG_3V3, input: VIN, output: 3V3, efficiency: 0.9 }\nloads:\n  - { name: SENSOR, rail: 3V3, current: { typical: 0.1 } }\n'
		)
	});
	await expect(page.getByRole('heading', { name: 'Conversion paths' })).toBeVisible();
	await expect(page.getByText('Input rails')).toBeVisible();
	await expect(page.getByText('Connected loads')).toBeVisible();
	const sizes = await page.locator('.topology').evaluate((element) => ({
		topology: [element.clientWidth, element.scrollWidth],
		document: [document.documentElement.clientWidth, document.documentElement.scrollWidth]
	}));
	expect(sizes.topology[1]).toBeLessThanOrEqual(sizes.topology[0]);
	expect(sizes.document[1]).toBeLessThanOrEqual(sizes.document[0]);
});
