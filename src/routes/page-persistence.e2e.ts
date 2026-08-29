import { expect, test } from '@playwright/test';

test.describe('persistence and responsive behavior', () => {
	test('persists the selected color mode', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await page.getByRole('button', { name: 'Switch to dark mode' }).click();
		await expect(page.locator('html')).toHaveClass(/dark/);
		await page.reload();
		await expect(page.locator('html')).toHaveClass(/dark/);
	});

	test('offers recovery after a reload and restores unsaved work', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'New YAML' }).click();
		await page.getByRole('button', { name: /^Add/ }).click();
		await page.getByRole('menuitem', { name: 'Add rail' }).click();
		await page.getByRole('dialog').getByLabel('Name').fill('RECOVERED');
		await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
		await page.waitForTimeout(800);
		await page.reload();
		await expect(page.getByRole('alertdialog', { name: 'Resume unsaved work?' })).toBeVisible();
		await page.getByRole('button', { name: 'Resume' }).click();
		await expect(page.getByRole('button', { name: /^rail RECOVERED/ })).toBeVisible();
	});

	test('writes edited YAML through a direct file handle', async ({ page }) => {
		await page.addInitScript(() => {
			let source =
				'source: { name: VIN, voltage: { nominal: 12 } }\nrails: []\nregulators: []\nloads: []\n';
			const handle = {
				name: 'direct.yaml',
				getFile: async () => new File([source], 'direct.yaml', { type: 'application/yaml' }),
				createWritable: async () => ({
					write: async (data: string) => {
						source = data;
						(window as Window & { __writtenYaml?: string }).__writtenYaml = data;
					},
					close: async () => undefined
				})
			};
			Object.defineProperty(window, 'showOpenFilePicker', {
				configurable: true,
				value: async () => [handle]
			});
		});
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Open YAML' }).click();
		await page.getByRole('button', { name: 'More file actions' }).click();
		await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
		await page
			.getByLabel('Raw YAML source')
			.fill(
				'source: { name: EDITED, voltage: { nominal: 12 } }\nrails: []\nregulators: []\nloads: []\n'
			);
		await page.getByRole('button', { name: 'Apply' }).click();
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		await expect
			.poll(() =>
				page.evaluate(() => (window as Window & { __writtenYaml?: string }).__writtenYaml ?? '')
			)
			.toContain('name: EDITED');
	});

	test('keeps long topology content within the mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.locator('input[type="file"]').setInputFiles({
			name: 'mobile.yaml',
			mimeType: 'application/yaml',
			buffer: Buffer.from(
				'source: { name: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_IDENTIFIER, voltage: { nominal: 12 } }\nrails:\n  - { name: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, nominal_voltage: 3.3 }\nregulators:\n  - { name: REGULATOR_WITH_A_VERY_LONG_IDENTIFIER, input: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_IDENTIFIER, output: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, efficiency: 0.9 }\nloads:\n  - { name: SENSOR_WITH_A_VERY_LONG_IDENTIFIER, rail: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, current: { typical: 0.1 } }\n'
			)
		});
		await expect(page.getByRole('heading', { name: 'Conversion paths' })).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			)
		).toBe(true);
	});
});
