import { expect, test, type Locator, type Page } from '@playwright/test';

type ContrastResult = { background: string; foreground: string; ratio: number };

async function semanticContrasts(
	page: Page,
	pairs: Record<string, [background: string, foreground: string]>
): Promise<Record<string, ContrastResult>> {
	return page.evaluate((semanticPairs) => {
		const toSrgb = (color: string) => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 1;
			const context = canvas.getContext('2d', { colorSpace: 'srgb' });
			if (!context) throw new Error('Cannot create color conversion context');
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
			return `rgb(${red}, ${green}, ${blue})`;
		};
		const luminance = (color: string) => {
			const channels = color
				.match(/[\d.]+/g)
				?.slice(0, 3)
				.map(Number);
			if (!channels || channels.length !== 3) throw new Error(`Cannot parse ${color}`);
			return channels
				.map((channel) => channel / 255)
				.map((channel) =>
					channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
				)
				.reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
		};
		const contrast = (foreground: string, background: string) => {
			const lighter = Math.max(luminance(foreground), luminance(background));
			const darker = Math.min(luminance(foreground), luminance(background));
			return (lighter + 0.05) / (darker + 0.05);
		};

		return Object.fromEntries(
			Object.entries(semanticPairs).map(([name, [backgroundToken, foregroundToken]]) => {
				const probe = document.createElement('span');
				probe.style.backgroundColor = `var(${backgroundToken})`;
				probe.style.color = `var(${foregroundToken})`;
				document.body.append(probe);
				const styles = getComputedStyle(probe);
				const background = toSrgb(styles.backgroundColor);
				const foreground = toSrgb(styles.color);
				probe.remove();
				return [name, { background, foreground, ratio: contrast(foreground, background) }];
			})
		);
	}, pairs);
}

async function elementContrast(locator: Locator): Promise<ContrastResult> {
	return locator.evaluate((element) => {
		const toSrgb = (color: string) => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 1;
			const context = canvas.getContext('2d', { colorSpace: 'srgb' });
			if (!context) throw new Error('Cannot create color conversion context');
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
			return `rgb(${red}, ${green}, ${blue})`;
		};
		const luminance = (color: string) => {
			const channels = color
				.match(/[\d.]+/g)
				?.slice(0, 3)
				.map(Number);
			if (!channels || channels.length !== 3) throw new Error(`Cannot parse ${color}`);
			return channels
				.map((channel) => channel / 255)
				.map((channel) =>
					channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
				)
				.reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
		};
		const styles = getComputedStyle(element);
		const background = toSrgb(styles.backgroundColor);
		const foreground = toSrgb(styles.color);
		const lighter = Math.max(luminance(foreground), luminance(background));
		const darker = Math.min(luminance(foreground), luminance(background));
		return { background, foreground, ratio: (lighter + 0.05) / (darker + 0.05) };
	});
}

test('uses the requested semantic theme and Geist fonts', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('mode-watcher-mode', 'light'));
	await page.goto('/');

	const root = page.locator('html');
	const body = page.locator('body');
	const firstRun = page.getByRole('main');
	const newYaml = page.getByRole('button', { name: 'New YAML', exact: true });
	const lightTokens = await root.evaluate((element) => {
		const styles = getComputedStyle(element);
		return Object.fromEntries(
			['--background', '--foreground', '--primary', '--border', '--destructive-foreground'].map(
				(name) => [name, styles.getPropertyValue(name).trim()]
			)
		);
	});
	expect(lightTokens).toEqual({
		'--background': 'oklch(100% 0 0)',
		'--foreground': 'oklch(24.79% .0058 271.176)',
		'--primary': 'oklch(57.37% .1946 257.858)',
		'--border': 'oklch(89.41% .0059 264.53)',
		'--destructive-foreground': 'oklch(100% 0 0)'
	});
	const lightContrast = await semanticContrasts(page, {
		accent: ['--accent', '--accent-foreground'],
		'sidebar-accent': ['--sidebar-accent', '--sidebar-accent-foreground']
	});
	for (const result of Object.values(lightContrast))
		expect(result.ratio).toBeGreaterThanOrEqual(4.5);
	await expect(root).toHaveCSS('--radius', '.45rem');
	await expect(firstRun).toHaveClass('grid min-h-screen place-items-center bg-muted/30 p-6');
	await expect(body).toHaveCSS('font-family', /Geist Variable/);
	await expect(newYaml).toHaveCSS('font-family', /Geist Variable/);
	await expect(body).not.toHaveCSS('font-family', /Inter/);
	await expect(newYaml).not.toHaveCSS('font-family', /Inter/);
	await newYaml.focus();
	await expect(newYaml).toBeFocused();
	expect((await elementContrast(newYaml)).ratio).toBeGreaterThanOrEqual(4.5);

	await newYaml.click();
	const card = page.locator('main [data-slot="card"]').first();
	await expect(page.locator('header')).toHaveClass(
		'sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:px-5'
	);
	await expect(page.getByRole('main')).toHaveClass(
		'mx-auto max-w-[1500px] px-4 py-8 sm:px-8 sm:py-12'
	);
	const lightColors = await page.evaluate(() => {
		const rootStyles = getComputedStyle(document.documentElement);
		return {
			background: rootStyles.getPropertyValue('--background').trim(),
			foreground: rootStyles.getPropertyValue('--foreground').trim(),
			card: rootStyles.getPropertyValue('--card').trim(),
			border: rootStyles.getPropertyValue('--border').trim()
		};
	});
	expect(lightColors.foreground).not.toBe(lightColors.background);
	expect(lightColors.border).not.toBe(lightColors.background);
	await expect(card).toHaveCSS('font-family', /Geist Variable/);

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	const rawYaml = page.getByLabel('Raw YAML source');
	await expect(rawYaml).toHaveCSS('font-family', /Geist Mono Variable/);
	await expect(rawYaml).not.toHaveCSS('font-family', /Inter/);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	await page.getByRole('button', { name: 'Switch to dark mode' }).click();
	const darkTokens = await root.evaluate((element) => {
		const styles = getComputedStyle(element);
		return Object.fromEntries(
			['--background', '--card', '--border', '--chart-5', '--sidebar'].map((name) => [
				name,
				styles.getPropertyValue(name).trim()
			])
		);
	});
	expect(darkTokens).toEqual({
		'--background': 'oklch(24.79% .0058 271.176)',
		'--card': 'oklch(28.52% .0056 271.216)',
		'--border': 'oklch(36.88% .0074 240.019)',
		'--chart-5': 'oklch(100% 0 0)',
		'--sidebar': 'oklch(20.5% 0 0)'
	});
	expect(
		new Set([darkTokens['--background'], darkTokens['--card'], darkTokens['--border']]).size
	).toBe(3);
	const darkContrast = await semanticContrasts(page, {
		primary: ['--primary', '--primary-foreground'],
		accent: ['--accent', '--accent-foreground'],
		destructive: ['--destructive', '--destructive-foreground']
	});
	for (const result of Object.values(darkContrast))
		expect(result.ratio).toBeGreaterThanOrEqual(4.5);

	await page.evaluate(() => {
		const control = document.createElement('button');
		control.dataset.testid = 'destructive-contrast-control';
		control.style.backgroundColor = 'var(--destructive)';
		control.style.color = 'var(--destructive-foreground)';
		control.textContent = 'Delete';
		document.body.append(control);
	});
	const destructiveControl = page.getByTestId('destructive-contrast-control');
	expect((await elementContrast(destructiveControl)).ratio).toBeGreaterThanOrEqual(4.5);
	await destructiveControl.focus();
	await expect(destructiveControl).toBeFocused();
	expect((await elementContrast(destructiveControl)).ratio).toBeGreaterThanOrEqual(4.5);
});

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
	const firstRun = page.getByRole('main');
	const firstRunActions = firstRun.locator('h1 + div');
	await expect(page.getByRole('heading', { name: 'Wattson' })).toBeVisible();
	await expect(firstRun.locator('[data-slot="card"]')).toHaveCount(0);
	await expect(firstRunActions.locator('svg')).toHaveCount(0);
	await expect(firstRunActions).toHaveCSS('justify-content', 'center');
	await expect(firstRunActions).toHaveCSS('flex-direction', 'row');
	await expect(firstRunActions.getByRole('button')).toHaveText(['Open YAML', 'New YAML']);
	await expect(page.getByRole('button', { name: 'New YAML', exact: true })).toHaveClass(
		/bg-primary/
	);
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toHaveClass(
		/border-border/
	);
	await expect(page.getByRole('button', { name: 'Open YAML', exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Open YAML', exact: true }).locator('svg')
	).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	const actionBoxes = await firstRunActions.getByRole('button').evaluateAll((buttons) =>
		buttons.map((button) => ({
			top: button.getBoundingClientRect().top,
			height: button.clientHeight
		}))
	);
	expect(actionBoxes[0].top).toBe(actionBoxes[1].top);
	expect(actionBoxes[0].height).toBe(actionBoxes[1].height);
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
		'New YAML ShiftN',
		'Open File CtrlO',
		'View Raw YAML CtrlShiftY',
		'Keyboard Shortcuts'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-content"] > *')).toHaveText([
		'New YAML ShiftN',
		'Open File CtrlO',
		'',
		'View Raw YAML CtrlShiftY',
		'',
		'Keyboard Shortcuts'
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
	await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
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
	await name.press('Enter');
	await expect(page.locator('[role="dialog"][data-state="open"]')).toHaveCount(0);
	expect(browserErrors).toEqual([]);
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	const sourceBeforeEscape = await page.getByLabel('Raw YAML source').inputValue();
	expect(sourceBeforeEscape).toContain('CORE');
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
	await expect(page.getByLabel('Raw YAML source')).toHaveValue(sourceBeforeEscape);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: /CORE/ }).click();
	await page.locator('[role="dialog"][data-state="open"]').getByLabel('Name').fill('CANCELLED');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: /CORE/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /CANCELLED/ })).toHaveCount(0);
	await expect(page.getByText('rail properties', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await expect(page.getByLabel('Raw YAML source')).toHaveValue(sourceBeforeEscape);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: /CORE/ }).click();
	await expect(page.getByRole('dialog').getByLabel('Nominal voltage')).toHaveValue('3.3');
	await page.getByRole('dialog').getByLabel('Name').fill('SAVED');
	await page.getByRole('dialog').getByLabel('Nominal voltage').fill('3.3');
	await page.getByRole('dialog').getByLabel('Nominal voltage').press('Enter');
	await expect(page.getByRole('button', { name: /SAVED/ })).toBeVisible();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	const raw = page.getByLabel('Raw YAML source');
	await expect(raw).toHaveValue(/name: SAVED/);
	await expect(raw).toHaveValue(/nominal_voltage: 3.3/);
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
  voltage: { min: 5, nominal: 123456789.12345, max: 20 }
rails:
  - { name: 3V3, nominal_voltage: 3.3, max_voltage: 3.6 }
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
	await expect(source.locator('[data-metric="min"]')).toContainText('Min 5 V');
	await expect(source.locator('[data-metric="nominal"]')).toContainText(
		'Nominal 123456789.12345 V'
	);
	await expect(source.locator('[data-metric="max"]')).toContainText('Max 20 V');
	await expect(rail.locator('[data-metric="min"]')).toContainText('Min -');
	await expect(rail.locator('[data-metric="nominal"]')).toContainText('Nominal 3.3 V');
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
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		for (const node of [source, rail]) {
			const metricLayout = await node.locator('.node-metrics').evaluate((metrics) => {
				const items = [...metrics.querySelectorAll<HTMLElement>('.node-metric')];
				return {
					order: items.map((item) => item.dataset.metric),
					tops: items.map((item) => item.getBoundingClientRect().top),
					heights: items.map((item) => item.getBoundingClientRect().height),
					labelTops: items.map((item) => item.querySelector('dt')!.getBoundingClientRect().top),
					valueTops: items.map((item) => item.querySelector('dd')!.getBoundingClientRect().top),
					lefts: items.map((item) => item.getBoundingClientRect().left),
					fits:
						metrics.scrollWidth <= metrics.clientWidth &&
						items.every((item) => item.scrollWidth <= item.clientWidth)
				};
			});
			expect(metricLayout.order).toEqual(['min', 'nominal', 'max']);
			expect(new Set(metricLayout.tops).size).toBe(1);
			expect(new Set(metricLayout.heights).size).toBe(1);
			expect(new Set(metricLayout.labelTops).size).toBe(1);
			expect(new Set(metricLayout.valueTops).size).toBe(1);
			expect(metricLayout.lefts[0]).toBeLessThan(metricLayout.lefts[1]);
			expect(metricLayout.lefts[1]).toBeLessThan(metricLayout.lefts[2]);
			expect(metricLayout.fits).toBe(true);
		}
	}

	await source.click();
	for (const label of ['Nominal voltage', 'Minimum voltage', 'Maximum voltage']) {
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('step', '0.1');
		await expect(page.getByRole('dialog').getByLabel(label)).toHaveAttribute('min', '0');
		await expect(page.getByRole('dialog').getByLabel(label)).not.toHaveAttribute('max');
	}
	for (const attribute of ['step', 'min', 'max'])
		await expect(page.getByRole('dialog').getByLabel('Name')).not.toHaveAttribute(attribute);
	await expect(page.getByRole('dialog').getByLabel('Nominal voltage')).toHaveValue(
		'123456789.12345'
	);
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

	const savedButton = page.getByRole('button', { name: 'Saved', exact: true });
	await expect(savedButton).toBeVisible();
	await expect(savedButton).toBeDisabled();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await page
		.getByLabel('Raw YAML source')
		.fill(
			'source: { name: EDITED, voltage: { nominal: 12 } }\nrails: []\nregulators: []\nloads: []\n'
		);
	await page.getByRole('button', { name: 'Apply' }).click();
	const saveButton = page.getByRole('button', { name: 'Save', exact: true });
	await expect(saveButton).toBeEnabled();
	await expect(saveButton).toHaveClass(/bg-primary/);
	await saveButton.click();
	await expect(savedButton).toBeDisabled();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await expect(page.getByRole('menuitem')).toHaveText([
		'New YAML ShiftN',
		'Open File CtrlO',
		'Save As CtrlShiftS',
		'View Raw YAML CtrlShiftY',
		'Keyboard Shortcuts'
	]);
	await expect(page.locator('[data-slot="dropdown-menu-content"] > *')).toHaveText([
		'New YAML ShiftN',
		'Open File CtrlO',
		'Save As CtrlShiftS',
		'',
		'View Raw YAML CtrlShiftY',
		'',
		'Keyboard Shortcuts'
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
		expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(240);
		for (const name of ['New YAML', 'Open File', 'View Raw YAML', 'Keyboard Shortcuts']) {
			const item = page.getByRole('menuitem', { name });
			await expect(item).toHaveCSS('white-space', 'nowrap');
			expect(
				await item.evaluate(
					(element) =>
						element.scrollHeight <= element.clientHeight &&
						element.scrollWidth <= element.clientWidth
				)
			).toBe(true);
		}
		for (const hint of await menu.locator('[data-slot="kbd-group"]').all()) {
			await expect(hint).toHaveCSS('white-space', 'nowrap');
			expect(await hint.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
				true
			);
		}
		const hintedRows = await menu
			.locator('[data-slot="dropdown-menu-item"]:has([data-slot="kbd-group"])')
			.evaluateAll((items) =>
				items.map((item) => {
					const label = item.querySelector('span')!.getBoundingClientRect();
					const hint = item.querySelector('[data-slot="kbd-group"]')!.getBoundingClientRect();
					return { gap: hint.left - label.right, hintRight: hint.right };
				})
			);
		expect(Math.max(...hintedRows.map(({ hintRight }) => hintRight))).toBeCloseTo(
			Math.min(...hintedRows.map(({ hintRight }) => hintRight)),
			0
		);
		expect(Math.min(...hintedRows.map(({ gap }) => gap))).toBeGreaterThanOrEqual(16);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			)
		).toBe(true);
		await page.keyboard.press('Escape');
	}
});

test('starts with an empty topology and adds every entity type', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'New YAML', exact: true }).click();

	const topologyCard = page.locator('main [data-slot="card"]');
	const topologyHeader = topologyCard.locator('[data-slot="card-header"]');
	await expect(topologyCard.locator('[data-slot="card-content"]')).toHaveCount(0);
	expect(await topologyHeader.evaluate((header) => header.classList.contains('border-b'))).toBe(
		false
	);
	await expect(page.getByRole('button', { name: /source VIN/ })).toHaveCount(0);
	const [cardBox, headerBox] = await Promise.all([
		topologyCard.boundingBox(),
		topologyHeader.boundingBox()
	]);
	expect(cardBox).not.toBeNull();
	expect(headerBox).not.toBeNull();
	const verticalPadding = headerBox!.y - cardBox!.y;
	expect(cardBox!.height).toBe(headerBox!.height + verticalPadding * 2);

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await expect(page.getByLabel('Raw YAML source')).toHaveValue('');
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	for (const [kind, nodeName] of [
		['source', 'SOURCE_1'],
		['rail', 'RAIL_1'],
		['regulator', 'REG_1'],
		['load', 'LOAD_1']
	] as const) {
		await page.getByRole('button', { name: /^Add/ }).click();
		await page.getByRole('menuitem', { name: `Add ${kind}` }).click();
		await expect(topologyCard.locator('[data-slot="card-content"]')).toBeVisible();
		await expect(
			page.getByRole('button', { name: new RegExp(`^${kind} ${nodeName}`) })
		).toBeVisible();
		await page.keyboard.press('Escape');

		if (kind !== 'load') {
			page.once('dialog', (dialog) => dialog.accept());
			await page.keyboard.press('Shift+N');
			await expect(topologyCard.locator('[data-slot="card-content"]')).toHaveCount(0);
		}
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
	await expect(page.getByRole('button', { name: /^source SOURCE_1/ })).toBeVisible();
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
		'Add Source SAdd Regulator EAdd Rail AAdd Load LOpen File Ctrl+OSave / Download Ctrl+SNew YAML Shift+NView Raw YAML Ctrl+Shift+Y'
	);
	await expect(shortcuts.getByText('Mod', { exact: true })).toHaveCount(0);
	await expect(shortcuts.getByText('Ctrl+N', { exact: true })).toHaveCount(0);
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

test('uses Shift+N only on the unblocked topology', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'New YAML', exact: true }).click();

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

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'View Raw YAML' }).click();
	await page.getByLabel('Raw YAML source').press('Shift+N');
	await expect(page.getByRole('dialog', { name: 'Raw YAML' })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

	await page.getByRole('button', { name: 'More file actions' }).click();
	await page.getByRole('menuitem', { name: 'Keyboard Shortcuts' }).click();
	await page.keyboard.press('Shift+N');
	await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
	await page.keyboard.press('Escape');

	await page.keyboard.press('Control+N');
	await expect(page.getByRole('button', { name: /^rail RAIL_1/ })).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await page.keyboard.press('Shift+N');
	await expect(page.getByRole('button', { name: /^rail RAIL_1/ })).toHaveCount(0);
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
