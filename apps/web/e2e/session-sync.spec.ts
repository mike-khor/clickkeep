import { test, expect, type Page } from '@playwright/test';

// Worker uses the alphabet 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' (no O/0/I/1/L), 4 chars.
const CODE_REGEX = /[A-HJKMNP-Z2-9]{4}/;

const SESSION_TRIGGER = 'Session';
const CREATE_BUTTON = 'Create session';
const JOIN_BUTTON = 'Join session';
const CODE_LABEL = 'Session code';

// Member-count assertions need left-anchored word boundaries — otherwise
// /2 members\b/ would also pass on "12 members" once future tests cross
// 10+ clients in Concert Mode.
const ONE_MEMBER = /\b1 member\b/;
const TWO_MEMBERS = /\b2 members\b/;

/**
 * Open the session sheet from the header trigger. After connection, the
 * trigger swaps to a pill showing the live code+members and still opens
 * the sheet on click — `getByRole('button', { name: /Session/ })` matches
 * both forms because the connected pill's aria-label is "Session ABCD…".
 */
async function openSessionSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${SESSION_TRIGGER}`) }).first().click();
}

/**
 * Returns the 4-character session code currently displayed on the page.
 * Reads from the big display inside the connected view of the sheet.
 */
async function readCode(page: Page): Promise<string> {
  const codeLocator = page.locator('div.text-5xl').filter({ hasText: CODE_REGEX });
  await expect(codeLocator).toBeVisible({ timeout: 10_000 });
  const text = (await codeLocator.textContent()) ?? '';
  const match = text.match(CODE_REGEX);
  if (!match) throw new Error(`No 4-char code found in: ${JSON.stringify(text)}`);
  return match[0];
}

test('creates a session and shows the join code', async ({ page }) => {
  await page.goto('/');
  await openSessionSheet(page);
  await page.getByRole('button', { name: CREATE_BUTTON }).click();

  // Code should appear in the connected panel.
  const code = await readCode(page);
  expect(code).toMatch(CODE_REGEX);

  // Member count of 1 (singular form). The count is now shown in two places:
  // the toolbar trigger pill (always visible) and the open sheet's connected
  // view. Either is a valid pass signal; .first() picks whichever resolves.
  await expect(page.getByText(ONE_MEMBER).first()).toBeVisible({ timeout: 10_000 });
});

test('two clients in the same session see member-count 2', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/');
    await openSessionSheet(pageA);
    await pageA.getByRole('button', { name: CREATE_BUTTON }).click();
    const code = await readCode(pageA);

    await pageB.goto('/');
    await openSessionSheet(pageB);
    // Fill the join input by its aria-label (Session code) and click Join.
    // The hidden full-string input still carries that aria-label so old
    // form-fill semantics keep working.
    await pageB.getByLabel(CODE_LABEL, { exact: true }).fill(code);
    await pageB.getByRole('button', { name: JOIN_BUTTON }).click();

    // Both contexts should eventually show "2 members". Count appears in
    // both the trigger pill and (if open) the sheet — .first() suffices.
    await expect(pageA.getByText(TWO_MEMBERS).first()).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(TWO_MEMBERS).first()).toBeVisible({ timeout: 10_000 });
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
    await openSessionSheet(pageA);
    await pageA.getByRole('button', { name: CREATE_BUTTON }).click();
    const code = await readCode(pageA);

    await pageB.goto('/');
    await openSessionSheet(pageB);
    await pageB.getByLabel(CODE_LABEL, { exact: true }).fill(code);
    await pageB.getByRole('button', { name: JOIN_BUTTON }).click();

    // Wait for the two-member state before tearing B down.
    await expect(pageA.getByText(TWO_MEMBERS).first()).toBeVisible({ timeout: 10_000 });

    // Closing the page tears down B's WebSocket; DO should rebroadcast count=1.
    await pageB.close();
    await ctxB.close();

    await expect(pageA.getByText(ONE_MEMBER).first()).toBeVisible({ timeout: 10_000 });
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
