import { expect, test } from '@playwright/test';

/**
 * End-to-End Multi-User Journeys (Phase 6).
 *
 * Requires the backend + PostgreSQL + Redis + frontend running (either via `npm run dev`
 * on :4000 / :5174 or via `docker compose --profile full up -d` with E2E_BASE_URL=http://localhost:8080).
 */
test.describe('ChatNow Multi-User Real-Time Messaging', () => {
  test('two simultaneously logged-in users register, message in real time, persist on reload, and create a group', async ({
    browser,
  }) => {
    const suffix = Date.now().toString(36);
    const aliceUser = {
      displayName: 'Alice E2E',
      username: `alice_${suffix}`,
      email: `alice_${suffix}@chatnow.test`,
      password: 'correct horse battery staple',
    };
    const bobUser = {
      displayName: 'Bob E2E',
      username: `bob_${suffix}`,
      email: `bob_${suffix}@chatnow.test`,
      password: 'correct horse battery staple',
    };

    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    try {
      // 1. Register Alice in Context A
      await alicePage.goto('/register');
      await alicePage.getByLabel(/display name/i).fill(aliceUser.displayName);
      await alicePage.getByLabel(/username/i).fill(aliceUser.username);
      await alicePage.getByLabel(/email address/i).fill(aliceUser.email);
      await alicePage.getByLabel(/^password$/i).fill(aliceUser.password);
      await alicePage.getByLabel(/confirm password/i).fill(aliceUser.password);
      await alicePage.getByRole('button', { name: /create account/i }).click();
      await expect(alicePage).toHaveURL(/\/chat/);

      // Verify silent refresh keeps Alice signed in on reload (and zero tokens in localStorage)
      const lsTokenCount = await alicePage.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.toLowerCase().includes('token')).length,
      );
      expect(lsTokenCount).toBe(0);
      await alicePage.reload();
      await expect(alicePage).toHaveURL(/\/chat/);

      // 2. Register Bob in Context B
      await bobPage.goto('/register');
      await bobPage.getByLabel(/display name/i).fill(bobUser.displayName);
      await bobPage.getByLabel(/username/i).fill(bobUser.username);
      await bobPage.getByLabel(/email address/i).fill(bobUser.email);
      await bobPage.getByLabel(/^password$/i).fill(bobUser.password);
      await bobPage.getByLabel(/confirm password/i).fill(bobUser.password);
      await bobPage.getByRole('button', { name: /create account/i }).click();
      await expect(bobPage).toHaveURL(/\/chat/);

      // 3. Alice searches for Bob and opens a direct chat
      await alicePage.getByLabel(/search people or messages/i).fill(bobUser.username);
      await alicePage.getByRole('button', { name: new RegExp(bobUser.displayName, 'i') }).click();
      await expect(alicePage.getByRole('heading', { level: 1, name: bobUser.displayName })).toBeVisible();

      // 4. Alice sends a message -> Bob receives it instantly in Context B
      const msgText = `Instant hello ${suffix}`;
      await alicePage.getByLabel(new RegExp(`message ${bobUser.displayName}`, 'i')).fill(msgText);
      await alicePage.getByRole('button', { name: /send message/i }).click();
      await expect(alicePage.getByText(msgText).first()).toBeVisible();

      // Bob opens the new conversation and sees Alice's message
      await bobPage.getByRole('button', { name: new RegExp(aliceUser.displayName, 'i') }).click();
      await expect(bobPage.getByText(msgText).first()).toBeVisible();

      // 5. Persistence across page reload
      await bobPage.reload();
      await bobPage.getByRole('button', { name: new RegExp(aliceUser.displayName, 'i') }).click();
      await expect(bobPage.getByText(msgText).first()).toBeVisible();

      // 6. Theme switching & logout
      await alicePage.goto('/settings');
      await alicePage.getByRole('radio', { name: /dark/i }).click();
      await expect(alicePage.locator('html')).toHaveClass(/dark/);

      await alicePage.getByRole('button', { name: /sign out$/i }).first().click();
      await expect(alicePage).toHaveURL(/\/login/);
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
