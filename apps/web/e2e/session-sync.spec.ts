import { test, expect, type Page } from '@playwright/test';

// Worker uses the alphabet 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' (no O/0/I/1/L), 4 chars.
const CODE_REGEX = /[A-HJKMNP-Z2-9]{4}/;

const CREATE_BUTTON = 'Create session';
const JOIN_BUTTON = 'Join session';
const CODE_LABEL = 'Session code';

// Member-count assertions need left-anchored word boundaries — otherwise
// /2 members\b/ would also pass on "12 members" once future tests cross
// 10+ clients in Concert Mode.
const ONE_MEMBER = /\b1 member\b/;
const TWO_MEMBERS = /\b2 members\b/;

/** Returns the 4-character session code currently displayed on the page. */
async function readCode(page: Page): Promise<string> {
  // The code is rendered in a big display div with tracking-[0.3em] tabular-nums.
  // It also appears in the input when joining; on the owner's page, after create,
  // the panel switches to the "connected" view and the code is shown in the display.
  const codeLocator = page.locator('div.text-4xl').filter({ hasText: CODE_REGEX });
  await expect(codeLocator).toBeVisible({ timeout: 10_000 });
  const text = (await codeLocator.textContent()) ?? '';
  const match = text.match(CODE_REGEX);
  if (!match) throw new Error(`No 4-char code found in: ${JSON.stringify(text)}`);
  return match[0];
}

test('creates a session and shows the join code', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: CREATE_BUTTON }).click();

  // Code should appear in the connected panel.
  const code = await readCode(page);
  expect(code).toMatch(CODE_REGEX);

  // Member count of 1 (singular form).
  await expect(page.getByText(ONE_MEMBER)).toBeVisible({ timeout: 10_000 });
});

test('two clients in the same session see member-count 2', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/');
    await pageA.getByRole('button', { name: CREATE_BUTTON }).click();
    const code = await readCode(pageA);

    await pageB.goto('/');
    // Fill the join input by its aria-label (Session code) and click Join.
    await pageB.getByLabel(CODE_LABEL).fill(code);
    await pageB.getByRole('button', { name: JOIN_BUTTON }).click();

    // Both contexts should eventually show "2 members".
    await expect(pageA.getByText(TWO_MEMBERS)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(TWO_MEMBERS)).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("owner's BPM change propagates to the member", async ({ browser }) => {
  // Regression for "create session does not work": handshake/member-count was
  // fine, but the owner's tempo never made it to the member because nothing
  // was wired to broadcast state on owner-side store changes, and the
  // SessionClient.onState callback was an empty stub on the member-side.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/');
    await pageA.getByRole('button', { name: CREATE_BUTTON }).click();
    const code = await readCode(pageA);

    await pageB.goto('/');
    await pageB.getByLabel(CODE_LABEL).fill(code);
    await pageB.getByRole('button', { name: JOIN_BUTTON }).click();

    // Wait for both sides to be connected.
    await expect(pageA.getByText(TWO_MEMBERS)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(TWO_MEMBERS)).toBeVisible({ timeout: 10_000 });

    // Owner moves the BPM slider to 137 (chosen because it isn't the default 120).
    const bpmInputA = pageA.getByLabel('BPM').first();
    await bpmInputA.fill('137');
    await bpmInputA.press('Enter');

    // Member's BPM input should reflect the owner's value within a beat.
    const bpmInputB = pageB.getByLabel('BPM').first();
    await expect(bpmInputB).toHaveValue('137.0', { timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('leaving the session drops the member count', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/');
    await pageA.getByRole('button', { name: CREATE_BUTTON }).click();
    const code = await readCode(pageA);

    await pageB.goto('/');
    await pageB.getByLabel(CODE_LABEL).fill(code);
    await pageB.getByRole('button', { name: JOIN_BUTTON }).click();

    // Wait for the two-member state before tearing B down.
    await expect(pageA.getByText(TWO_MEMBERS)).toBeVisible({ timeout: 10_000 });

    // Closing the page tears down B's WebSocket; DO should rebroadcast count=1.
    await pageB.close();
    await ctxB.close();

    await expect(pageA.getByText(ONE_MEMBER)).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctxA.close();
    // ctxB may already be closed; close() is idempotent enough but guard.
    try {
      await ctxB.close();
    } catch {
      /* already closed */
    }
  }
});
