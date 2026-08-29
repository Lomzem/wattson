import { expect, test } from '@playwright/test';

test('creates, edits, validates raw YAML, and labels fallback download', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(message.text());
	});
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
	});
	await page.goto('/');
	const firstRunCard = page.locator('[data-slot="card"]');
	const firstRunHeader = firstRunCard.locator('[data-slot="card-header"]');
	const firstRunActions = firstRunCard.locator('[data-slot="card-content"]');
	await expect(page.getByRole('heading', { name: 'Wattson' })).toBeVisible();
	await expect(firstRunHeader.locator('svg')).toHaveCount(0);
	await expect(firstRunHeader).toHaveCSS('text-align', 'center');
	await expect(firstRunActions).toHaveCSS('justify-content', 'center');
	await expect(firstRunActions).toHaveCSS('flex-wrap', 'wrap');
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Open YAML', exact: true }).locator('svg')
	).toHaveCount(1);
	await expect(page.getByText('Powerman 5000 YAML, without the ceremony.')).toHaveCount(0);
	await expect(page.getByText('Or drop one .yaml or .yml file anywhere.')).toHaveCount(0);
	await expect(page.locator('meta[name="description"]')).toHaveCount(0);
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
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'More file actions' }).click();
	await expect(page.getByRole('menuitem')).toHaveText([
		'Open File',
		'View Raw YAML',
		'Keyboard Shortcuts',
		'New YAML'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-content"] > *')).toHaveText([
		'Open File',
		'',
		'View Raw YAML',
		'Keyboard Shortcuts',
		'',
		'New YAML'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-separator"]')).toHaveCount(2);
	await expect(page.getByRole('menuitem', { name: 'Save As' })).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'Download' })).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'Clear recovery' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	const path = page.locator('[data-path="U1"]');
	await expect(path.getByRole('button', { name: /source BENCH/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /regulator U1/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /rail CORE/ })).toBeVisible();
	await expect(path.getByRole('button', { name: /load MCU/ })).toBeVisible();
	if (!(await page.locator('html').getAttribute('class'))?.includes('dark')) {
		await page.getByRole('button', { name: 'Switch to dark mode' }).click();
	}
	const darkBackgrounds = await page.evaluate(() => ({
		page: getComputedStyle(document.querySelector('[data-testid="app-shell"]')!).backgroundColor,
		card: getComputedStyle(document.querySelector('main [data-slot="card"]')!).backgroundColor,
		node: getComputedStyle(document.querySelector('.topology-node')!).backgroundColor
	}));
	expect(darkBackgrounds.card).not.toBe(darkBackgrounds.page);
	expect(darkBackgrounds.node).not.toBe(darkBackgrounds.page);
	expect(darkBackgrounds.node).not.toBe(darkBackgrounds.card);
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	expect(browserErrors).toEqual([]);
	const importedRaw = page.getByLabel('Raw YAML source');
	await expect(importedRaw).toBeFocused();
	await expect
		.poll(() =>
			importedRaw.evaluate((element) => ({
				selectionStart: (element as HTMLTextAreaElement).selectionStart,
				scrollTop: element.scrollTop
			}))
		)
		.toEqual({ selectionStart: 0, scrollTop: 0 });
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Discard' })).toHaveCount(0);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'New YAML', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
	await expect(page.getByText('Add the first component to begin the topology.')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeVisible();

	await page.getByRole('button', { name: /^Add/ }).click();
	await page.getByRole('menuitem', { name: 'Add rail' }).click();
	await expect(page.getByRole('dialog').getByText('RAIL_1')).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Save' })).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeVisible();
	const saveButton = page.getByRole('dialog').getByRole('button', { name: 'Save' });
	const cancelButton = page.getByRole('dialog').getByRole('button', { name: 'Cancel' });
	await expect(saveButton).not.toHaveCSS(
		'background-color',
		await cancelButton.evaluate((node) => getComputedStyle(node).backgroundColor)
	);
	const overlay = page.locator('[data-slot="sheet-overlay"]');
	await expect(overlay).toHaveCSS('backdrop-filter', 'none');
	await page.getByRole('dialog').getByLabel('Maximum voltage').focus();
	await page.keyboard.press('Tab');
	await expect(saveButton).toBeFocused();
	const name = page.getByRole('dialog').getByLabel('Name');
	await name.fill('CORE');
	await expect(page.getByRole('button', { name: /rail CORE/ })).toBeVisible();
	await name.press('Escape');
	await expect(page.locator('[role="dialog"][data-state="open"]')).toHaveCount(0);
	expect(browserErrors).toEqual([]);
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await expect(page.getByLabel('Raw YAML source')).toHaveValue(/CORE/);
	await expect(page.getByText('Changes stay in this draft until you apply them.')).toHaveCount(0);
	await expect(page.getByText('YAML draft', { exact: true })).toHaveCount(0);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	await page.getByRole('button', { name: /CORE/ }).click();
	await page.getByRole('dialog').getByLabel('Nominal voltage').fill('2.5');
	await page.getByRole('dialog').getByLabel('Nominal voltage').blur();
	await page.keyboard.press('Escape');
	await expect(page.locator('[role="dialog"][data-state="open"]')).toHaveCount(0);
	expect(browserErrors).toEqual([]);
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	const sourceBeforeCancel = await page.getByLabel('Raw YAML source').inputValue();
	expect(sourceBeforeCancel).toContain('nominal_voltage: 2.5');
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: /CORE/ }).click();
	await page.locator('[role="dialog"][data-state="open"]').getByLabel('Name').fill('CANCELLED');
	await page
		.locator('[role="dialog"][data-state="open"]')
		.getByLabel('Nominal voltage')
		.fill('9.9');
	await page
		.locator('[role="dialog"][data-state="open"]')
		.getByRole('button', { name: 'Cancel', exact: true })
		.click();
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /CANCELLED/ })).toHaveCount(0);
	await expect(page.getByText('rail properties', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await expect(page.getByLabel('Raw YAML source')).toHaveValue(sourceBeforeCancel);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: /CORE/ }).click();
	await expect(page.getByRole('dialog').getByLabel('Nominal voltage')).toHaveValue('2.5');
	await page.getByRole('dialog').getByLabel('Name').fill('SAVED');
	await page.getByRole('dialog').getByLabel('Nominal voltage').fill('3.3');
	await page.getByRole('dialog').getByLabel('Nominal voltage').press('Enter');
	await expect(page.getByRole('button', { name: /SAVED/ })).toBeVisible();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	const raw = page.getByLabel('Raw YAML source');
	await expect(raw).toHaveValue(/name: SAVED/);
	await expect(raw).toHaveValue(/nominal_voltage: 3.3/);
	expect(await raw.inputValue()).not.toContain('9.9');
	await raw.fill('source: [');
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('heading', { name: 'Raw YAML' })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('button', { name: /SAVED/ })).toBeVisible();
	expect(browserErrors).toEqual([]);
});

test('previews Sheet validation without committing invalid numeric drafts', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'validation.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(`source:
  name: VIN
  voltage: { min: 5, nominal: 5.05, max: 20 }
rails:
  - { name: 3V3, nominal_voltage: 3.3 }
regulators:
  - { name: REG_3V3, input: VIN, output: 3V3, efficiency: 0.9 }
loads: []
`)
	});

	await page.getByRole('button', { name: /^regulator REG_3V3/ }).click();
	const efficiency = page.getByRole('dialog').getByLabel('Efficiency');
	await efficiency.fill('1.2');
	await expect(page.getByText('REG_3V3 efficiency must be from 0 to 1.')).toBeVisible();
	await expect(efficiency).toBeFocused();
	await efficiency.fill('0.85');
	await expect(page.getByText('REG_3V3 efficiency must be from 0 to 1.')).toHaveCount(0);
	await efficiency.fill('1.2');
	await efficiency.press('Enter');
	await expect(page.locator('[role="dialog"][data-state="open"]')).toBeVisible();
	await expect(page.getByText('REG_3V3 efficiency must be from 0 to 1.')).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('[role="dialog"][data-state="open"]')).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await expect(page.getByLabel('Raw YAML source')).toHaveValue(/efficiency: 0.9/);
	await expect(page.getByLabel('Raw YAML source')).not.toHaveValue(/efficiency: 1.2/);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	await page.getByRole('button', { name: /^source VIN/ }).click();
	const minimum = page.getByRole('dialog').getByLabel('Minimum voltage');
	await minimum.fill('6');
	await expect(page.getByText('VIN minimum voltage exceeds nominal.')).toBeVisible();
	await expect(minimum).toBeFocused();
	await minimum.fill('5');
	await expect(page.getByText('VIN minimum voltage exceeds nominal.')).toHaveCount(0);
});

test('shows field metadata and compact topology values', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'summary.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(`source:
  name: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_ENGINEERING_IDENTIFIER
  voltage: { min: 5, nominal: 5.05, max: 20 }
rails:
  - { name: 3V3, nominal_voltage: 3.3, min_voltage: 3.0, max_voltage: 3.6 }
regulators:
  - { name: REG_3V3, input: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_ENGINEERING_IDENTIFIER, output: 3V3, efficiency: 0.9, max_output_current: 3.0 }
loads:
  - name: LED_RED_WITH_A_VERY_LONG_ENGINEERING_IDENTIFIER_THAT_MUST_WRAP
    rail: 3V3
    quantity: 10
    current: { typical: 0.0046, maximum: 0.0086 }
`)
	});

	const source = page.getByRole('button', { name: /^source VIN_INPUT/ });
	const regulator = page.getByRole('button', { name: /^regulator REG_3V3/ });
	const rail = page.getByRole('button', { name: /^rail 3V3/ });
	const load = page.getByRole('button', { name: /^load LED_RED_WITH/ });
	await expect(source.locator('[data-metric="nominal"]')).toContainText('Nominal 5.05 V');
	await expect(source.locator('[data-metric="min"]')).toContainText('Min 5 V');
	await expect(source.locator('[data-metric="max"]')).toContainText('Max 20 V');
	await expect(rail.locator('[data-metric="nominal"]')).toContainText('Nominal 3.3 V');
	await expect(rail.locator('[data-metric="min"]')).toContainText('Min 3 V');
	await expect(rail.locator('[data-metric="max"]')).toContainText('Max 3.6 V');
	await expect(regulator.locator('[data-metric="efficiency"]')).toContainText('Efficiency 90%');
	await expect(regulator.locator('[data-metric="current-limit"]')).toContainText(
		'Current limit 3 A'
	);
	await expect(load.locator('[data-metric="quantity"]')).toContainText('Quantity 10');
	await expect(load.locator('[data-metric="typical"]')).toContainText('Typical 4.6 mA');
	await expect(load.locator('[data-metric="maximum"]')).toContainText('Maximum 8.6 mA');
	const topologySizing = await page.locator('.topology').evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		ellipsis: [...element.querySelectorAll('.node-name, .node-metric dd')].some(
			(node) => getComputedStyle(node).textOverflow === 'ellipsis'
		),
		wrappedNames: [...element.querySelectorAll('.node-name')].every(
			(node) => node.scrollWidth <= node.clientWidth
		)
	}));
	expect(topologySizing.scrollWidth).toBeLessThanOrEqual(topologySizing.clientWidth);
	expect(topologySizing.ellipsis).toBe(false);
	expect(topologySizing.wrappedNames).toBe(true);

	await source.click();
	for (const label of ['Nominal voltage', 'Minimum voltage', 'Maximum voltage']) {
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('step', '0.1');
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('min', '0');
		await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute('max');
	}
	for (const attribute of ['step', 'min', 'max'])
		await expect(page.getByRole('dialog').getByLabel('Name')).not.toHaveAttribute(attribute);
	await expect(page.getByRole('dialog').getByLabel('Nominal voltage')).toHaveValue('5.05');
	await page.keyboard.press('Escape');

	await regulator.click();
	await expect(page.getByRole('dialog').getByLabel('Efficiency')).toHaveAttribute('step', '0.01');
	await expect(page.getByRole('dialog').getByLabel('Efficiency')).toHaveAttribute('min', '0');
	await expect(page.getByRole('dialog').getByLabel('Efficiency')).toHaveAttribute('max', '1');
	for (const label of ['Name', 'Input rail', 'Output rail'])
		for (const attribute of ['step', 'min', 'max'])
			await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute(attribute);
	await page.keyboard.press('Escape');

	await rail.click();
	for (const label of ['Nominal voltage', 'Minimum voltage', 'Maximum voltage']) {
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('step', '0.1');
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('min', '0');
		await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute('max');
	}
	for (const attribute of ['step', 'min', 'max'])
		await expect(page.getByRole('dialog').getByLabel('Name')).not.toHaveAttribute(attribute);
	await page.keyboard.press('Escape');

	await load.click();
	await expect(page.getByRole('dialog').getByLabel('Quantity')).toHaveAttribute('step', '1');
	await expect(page.getByRole('dialog').getByLabel('Quantity')).toHaveAttribute('min', '0');
	await expect(page.getByRole('dialog').getByLabel('Quantity')).not.toHaveAttribute('max');
	for (const label of ['Typical current', 'Maximum current']) {
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('step', '0.0001');
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('min', '0');
		await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute('max');
	}
	for (const label of ['Name', 'Rail'])
		for (const attribute of ['step', 'min', 'max'])
			await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute(attribute);
	await expect(page.getByRole('dialog').getByLabel('Typical current')).toHaveValue('0.0046');
});

test('uses a semantic topology heading and keeps long Sheet titles clear of Close', async ({
	page
}) => {
	const longName = `SOURCE_${'UNBROKEN'.repeat(24)}`;

	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await page.locator('input[type="file"]').setInputFiles({
			name: 'long-title.yaml',
			mimeType: 'application/yaml',
			buffer: Buffer.from(
				`source: { name: ${longName}, voltage: { nominal: 12 } }\nrails: []\nregulators: []\nloads: []\n`
			)
		});

		await expect(page.getByRole('heading', { level: 1, name: 'Topology' })).toBeVisible();
		await page.getByRole('button', { name: new RegExp(`^source ${longName}`) }).click();

		const sheet = page.getByRole('dialog');
		const title = sheet.locator('[data-slot="sheet-title"]');
		const close = sheet.getByRole('button', { name: 'Close' });
		await expect(title).toHaveCSS('overflow-wrap', 'anywhere');
		const [titleBox, closeBox] = await Promise.all([title.boundingBox(), close.boundingBox()]);
		expect(titleBox).not.toBeNull();
		expect(closeBox).not.toBeNull();
		expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(closeBox!.x);

		const overflow = await sheet.evaluate((element) => ({
			sheet: element.scrollWidth - element.clientWidth,
			document: document.documentElement.scrollWidth - document.documentElement.clientWidth
		}));
		expect(overflow.sheet).toBeLessThanOrEqual(0);
		expect(overflow.document).toBeLessThanOrEqual(0);
	}
});

test('shows only direct file actions when a writable handle is available', async ({ page }) => {
	await page.addInitScript(() => {
		const source =
			'source: { name: VIN, voltage: { nominal: 12 } }\nrails: []\nregulators: []\nloads: []\n';
		const handle = {
			name: 'direct.yaml',
			getFile: async () => new File([source], 'direct.yaml', { type: 'application/yaml' }),
			createWritable: async () => ({ write: async () => undefined, close: async () => undefined })
		};
		Object.defineProperty(window, 'showOpenFilePicker', {
			configurable: true,
			value: async () => [handle]
		});
		Object.defineProperty(window, 'showSaveFilePicker', {
			configurable: true,
			value: async () => handle
		});
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Open YAML', exact: true }).click();

	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await expect(page.getByRole('menuitem')).toHaveText([
		'Open File',
		'Save As',
		'View Raw YAML',
		'Keyboard Shortcuts',
		'New YAML'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-content"] > *')).toHaveText([
		'Open File',
		'Save As',
		'',
		'View Raw YAML',
		'Keyboard Shortcuts',
		'',
		'New YAML'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-separator"]')).toHaveCount(2);
	await expect(page.getByRole('menuitem', { name: 'Download' })).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'Download a copy' })).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'Keyboard Shortcuts' }).click();
	await expect(
		page.getByRole('dialog', { name: 'Keyboard Shortcuts' }).getByText('Save As')
	).toBeVisible();
});

test('keeps overflow action labels on one line at desktop and mobile widths', async ({ page }) => {
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await page.getByRole('button', { name: 'New YAML', exact: true }).click();
		await page.getByRole('button', { name: 'More file actions' }).click();

		const menu = page.locator('[data-slot="dropdown-menu-content"]');
		expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(224);
		for (const name of ['View Raw YAML', 'Keyboard Shortcuts']) {
			const item = page.getByRole('menuitem', { name });
			await expect(item).toHaveCSS('white-space', 'nowrap');
			expect(await item.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
				true
			);
		}
		await page.keyboard.press('Escape');
	}
});

test('adds topology nodes with guarded shortcuts and lists all shortcut keys', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'New YAML', exact: true }).click();

	await page.keyboard.press('s');
	await expect(page.getByRole('button', { name: /^source SOURCE_2/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.keyboard.press('e');
	await expect(page.getByRole('button', { name: /^regulator REG_1/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.keyboard.press('a');
	await expect(page.getByRole('button', { name: /^rail RAIL_1/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.keyboard.press('l');
	await expect(page.getByRole('button', { name: /^load LOAD_1/ })).toBeVisible();

	const sourceCount = await page.getByRole('button', { name: /^source / }).count();
	await page.getByRole('dialog').getByLabel('Name').press('s');
	await expect(page.getByRole('button', { name: /^source / })).toHaveCount(sourceCount);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	const railCount = await page.getByRole('button', { name: /^rail / }).count();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await page.getByLabel('Raw YAML source').press('a');
	await expect(page.getByRole('button', { name: /^rail / })).toHaveCount(railCount);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	const loadCount = await page.getByRole('button', { name: /^load / }).count();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'Keyboard Shortcuts' }).click();
	const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
	await page.keyboard.press('l');
	await expect(page.getByRole('button', { name: /^load / })).toHaveCount(loadCount);
	await expect(shortcuts.locator('dl')).toHaveText(
		'Add Source SAdd Regulator EAdd Rail AAdd Load LOpen File Ctrl+OSave / Download Ctrl+SNew YAML Ctrl+NView Raw YAML Ctrl+Shift+Y'
	);
	await expect(shortcuts.getByText('Mod', { exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');

	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.getByRole('button', { name: /^Add/ }).click();
		for (const [action, key] of [
			['Add source', 'S'],
			['Add regulator', 'E'],
			['Add rail', 'A'],
			['Add load', 'L']
		] as const)
			await expect(
				page
					.getByRole('menuitem', { name: new RegExp(`^${action}`) })
					.getByText(key, { exact: true })
			).toBeVisible();

		const regulatorItem = page.getByRole('menuitem', { name: /^Add regulator/ });
		const regulatorLabel = regulatorItem.getByText('Add regulator', { exact: true });
		await expect(regulatorLabel).toHaveCSS('white-space', 'nowrap');
		expect(await regulatorItem.evaluate((item) => item.scrollHeight <= item.clientHeight)).toBe(
			true
		);
		await page.keyboard.press('Escape');
	}
	await page.getByRole('button', { name: /^Add/ }).click();
	await page.keyboard.press('s');
	await expect(page.getByRole('button', { name: /^source / })).toHaveCount(sourceCount);
});

test('edits and deletes the exact node from its context menu', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'context.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(
			'source: { name: VIN, voltage: { nominal: 12 } }\nrails:\n  - { name: RAIL_A, nominal_voltage: 3.3 }\n  - { name: RAIL_B, nominal_voltage: 1.8 }\nregulators: []\nloads: []\n'
		)
	});
	const railA = page.getByRole('button', { name: /^rail RAIL_A/ });
	await railA.click({ button: 'right' });
	await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Delete']);
	await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
	await expect(page.getByRole('dialog').getByRole('heading', { name: 'RAIL_A' })).toBeVisible();
	await page.keyboard.press('Escape');

	await railA.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
	await expect(railA).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^rail RAIL_B/ })).toBeVisible();
});

test('shows singular and plural validation issue tooltips and opens the first issue', async ({
	page
}) => {
	await page.goto('/');
	const fileInput = page.locator('input[type="file"]');
	await fileInput.setInputFiles({
		name: 'one-issue.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(
			'source: { name: VIN, voltage: { nominal: 12 } }\nrails:\n  - { name: BAD, nominal_voltage: -1 }\nregulators: []\nloads: []\n'
		)
	});
	const singular = page.getByRole('button', { name: '1 validation issue' });
	await singular.hover();
	await expect(page.getByRole('tooltip')).toHaveText('1 validation issue');
	await singular.focus();
	await expect(page.getByRole('tooltip')).toHaveText('1 validation issue');
	await singular.click();
	await expect(page.getByRole('dialog').getByRole('heading', { name: 'BAD' })).toBeVisible();
	await page.keyboard.press('Escape');

	await fileInput.setInputFiles({
		name: 'three-issues.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(
			'source: { name: VIN, voltage: { nominal: 12 } }\nrails:\n  - { name: BAD, nominal_voltage: -1 }\nregulators: []\nloads:\n  - { name: BROKEN, rail: MISSING, current: {} }\n'
		)
	});
	const plural = page.getByRole('button', { name: '3 validation issues' });
	await plural.hover();
	await expect(page.getByRole('tooltip')).toHaveText('3 validation issues');
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
			'source: { name: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_IDENTIFIER, voltage: { nominal: 12 } }\nrails:\n  - { name: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, nominal_voltage: 3.3 }\nregulators:\n  - { name: REGULATOR_WITH_A_VERY_LONG_IDENTIFIER, input: VIN_INPUT_CONNECTOR_WITH_A_VERY_LONG_IDENTIFIER, output: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, efficiency: 0.9 }\nloads:\n  - { name: SENSOR_WITH_A_VERY_LONG_IDENTIFIER, rail: 3V3_AUXILIARY_RAIL_WITH_A_VERY_LONG_IDENTIFIER, current: { typical: 0.1 } }\n'
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
	const names = await page.locator('.node-name').evaluateAll((elements) =>
		elements.map((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			textOverflow: getComputedStyle(element).textOverflow,
			whiteSpace: getComputedStyle(element).whiteSpace
		}))
	);
	for (const name of names) {
		expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
		expect(name.textOverflow).not.toBe('ellipsis');
		expect(name.whiteSpace).not.toBe('nowrap');
	}
});
