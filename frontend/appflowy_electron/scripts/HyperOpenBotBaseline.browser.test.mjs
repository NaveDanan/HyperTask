import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { waitForTranscriptMessage } from './HyperOpenBotBaseline.mjs';

// Use an existing original-client Playwright installation, as the runner does.
const require = createRequire(resolve(process.env.HYPER_OPENBOT_TEST_CLIENT_ROOT ?? process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');

test('original transcript rows preserve identity and compare rendered paragraphs', async () => {
  const browser = await chromium.launch(process.env.HYPER_OPENBOT_TEST_BROWSER ? { executablePath: process.env.HYPER_OPENBOT_TEST_BROWSER } : {});
  try {
    const page = await browser.newPage();
    const answer = 'Choose a book.\n\nRecord a title.\n\nSet a reading time.\n\nReview the list.';
    await page.setContent('<section role="region" aria-label="Messages"><div role="log"><div data-message-id="answer"><div><p>Choose a book.</p></div><div><p>Record a title.</p></div><div><p>Set a reading time.</p></div><div><p>Review the list.</p></div></div></div></section>');
    const log = page.getByRole('region', { name: 'Messages' }).getByRole('log');
    // Reproduce the old false negative before checking the corrected path.
    assert.equal(await log.getByText(answer, { exact: true }).count(), 0);
    await waitForTranscriptMessage(log, 'answer', answer, 1000);
    await assert.rejects(waitForTranscriptMessage(log, 'other', answer, 200));
    await assert.rejects(waitForTranscriptMessage(log, 'answer', answer + ' Missing text.', 200));
    await log.locator('[data-message-id="answer"]').evaluate(row => { row.hidden = true; });
    await assert.rejects(waitForTranscriptMessage(log, 'answer', answer, 200));
    await page.setContent('<section role="region" aria-label="Messages"><div role="log"><div data-message-id="answer">Choose a book.</div></div></section>');
    await page.evaluate(text => { setTimeout(() => { document.querySelector('[data-message-id="answer"]').innerText = text; }, 50); }, answer);
    await waitForTranscriptMessage(log, 'answer', answer, 1000);
  } finally { await browser.close(); }
});
