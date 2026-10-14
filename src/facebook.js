import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const SECURITY_OR_RESTRICTION = /security check|confirm your identity|unusual activity|temporarily blocked|account restricted|you(?:'|’)re restricted|you can(?:'|’)t post|unable to post|suspended|login request|manual review|ตรวจสอบความปลอดภัย|ยืนยันตัวตน|กิจกรรม(?:ที่)?ผิดปกติ|ถูกจำกัด|ไม่สามารถโพสต์|โพสต์ไม่ได้|คำเตือน/i;
const GROUP_RULE_PROBLEM = /answer (?:the )?(?:membership|group) questions|required questions|agree to (?:the )?group rules|pending member|posting permission|ตอบคำถาม(?:การเข้าร่วม|ของกลุ่ม)|ยอมรับกฎของกลุ่ม|ไม่มีสิทธิ์โพสต์/i;
const PERMALINK = /https:\/\/(?:www\.)?facebook\.com\/(?:groups\/[^/?#]+\/(?:posts|permalink)\/\d+|permalink\.php\?[^#]*story_fbid=\d+[^#]*|share\/(?:p|v|r)\/[^/?#]+)/i;

function storageStatePath(config, account) {
  const profileName = path.basename(account.profileDir).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(config.dataDir, 'facebook-storage', `${profileName}.json`);
}

export async function saveFacebookStorageState(config, account, contextOrState) {
  const state = typeof contextOrState?.storageState === 'function'
    ? await contextOrState.storageState()
    : contextOrState;
  const filePath = storageStatePath(config, account);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
  return filePath;
}

function cleanText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function pageText(page) {
  return cleanText(await page.locator('body').innerText({ timeout: 15000 }).catch(() => ''));
}

async function assertNoBlockingIssue(page) {
  const url = page.url();
  if (/\/login|\/checkpoint/i.test(url) || await page.locator('input[name="email"]').isVisible().catch(() => false)) {
    throw new Error('login request: Facebook session is not signed in or requires a checkpoint');
  }
  const text = await pageText(page);
  const security = text.match(SECURITY_OR_RESTRICTION)?.[0];
  if (security) throw new Error(`Facebook security/restriction warning: ${security}`);
  const groupRule = text.match(GROUP_RULE_PROBLEM)?.[0];
  if (groupRule) throw new Error(`Facebook group-rule problem: ${groupRule}`);
}

async function verifyFacebookAccount(page, expectedDisplayName) {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded' });
  await assertNoBlockingIssue(page);
  const expected = cleanText(expectedDisplayName).trim();
  // The profile header can still be a loading skeleton right after navigation,
  // especially back-to-back with a prior post, so poll instead of checking once.
  const deadline = Date.now() + 15000;
  let text = '';
  while (Date.now() < deadline) {
    text = await pageText(page);
    if (expected && text.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Facebook account mismatch: expected "${expected}" not found on profile page`);
}

async function openComposer(page) {
  const patterns = [/write something/i, /create (?:a )?(?:public )?post/i, /เขียนอะไร/i, /สร้างโพสต์/i];
  let opener = null;
  for (const pattern of patterns) {
    const candidate = page.locator('[role="button"]').filter({ hasText: pattern }).first();
    const found = await candidate.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (found) { opener = candidate; break; }
  }
  if (!opener) throw new Error('Facebook group-rule problem: posting composer is unavailable; verify membership and posting permission');
  const namedDialog = page.getByRole('dialog', { name: /create (?:a )?(?:public )?post|สร้างโพสต์/i }).first();
  const editorDialog = page.locator('[role="dialog"]').filter({ has: page.locator('[contenteditable="true"]') }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await opener.scrollIntoViewIfNeeded().catch(() => {});
    await opener.click({ force: attempt > 0 });
    const dialog = await Promise.any([
      namedDialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => namedDialog),
      editorDialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => editorDialog)
    ]).catch(() => null);
    if (dialog) return dialog;
    await page.waitForTimeout(1000);
  }
  throw new Error('Facebook post composer did not open after 3 attempts');
}

export async function detectFacebookDisplayName(page) {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded' });
  await assertNoBlockingIssue(page);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const headings = await page.locator('h1:visible').allInnerTexts().catch(() => []);
    const name = headings.map((value) => cleanText(value).trim()).find(Boolean);
    if (name) return name;

    const metadataName = cleanText(await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => '')).trim();
    if (metadataName && metadataName.toLowerCase() !== 'facebook') return metadataName.replace(/\s*\|\s*facebook\s*$/i, '').trim();
    await page.waitForTimeout(1000);
  }
  throw new Error('Could not detect the visible Facebook profile name. Make sure the profile page has fully loaded, then try again.');
}

async function attachMedia(page, dialog, mediaPaths, timeoutMs) {
  if (!mediaPaths.length) return;
  const existingInput = dialog.locator('input[type="file"]').first();
  if (await existingInput.count()) {
    await existingInput.setInputFiles(mediaPaths, { timeout: timeoutMs });
    return;
  }
  const button = dialog.getByRole('button', { name: /photo\/video|รูปภาพ\/วิดีโอ|รูป\/วิดีโอ/i }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('Facebook media control was not found'); });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
  await button.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(mediaPaths, { timeout: timeoutMs });
}

async function addFailureScreenshot(config, page, row, error) {
  try {
    const directory = path.join(config.dataDir, 'screenshots');
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `post-${String(row['Post ID'] || row.__rowNumber).replace(/[^A-Za-z0-9_-]/g, '_')}-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    error.message = `${error.message}; screenshot: ${filePath}`;
  } catch {
    // Keep the original Facebook error if screenshot capture also fails.
  }
}

function groupIdFromUrl(url) {
  return String(url || '').match(/\/groups\/([^/?#]+)/)?.[1] || null;
}

export async function resolveGroupId(page, groupUrl) {
  const directGroupId = groupIdFromUrl(groupUrl);
  if (directGroupId) return directGroupId;

  await page.goto(String(groupUrl || ''), { waitUntil: 'domcontentloaded' });
  await assertNoBlockingIssue(page);
  const canonicalUrl = await page.locator('link[rel="canonical"]').getAttribute('href').catch(() => '');
  return groupIdFromUrl(page.url()) || groupIdFromUrl(canonicalUrl);
}

function normalizePermalink(value, groupId) {
  let absolute;
  try {
    absolute = new URL(String(value || ''), 'https://www.facebook.com/').href;
  } catch {
    return null;
  }
  const match = absolute.match(PERMALINK);
  if (!match) return null;
  const parsed = new URL(match[0]);
  if (parsed.pathname.toLowerCase().endsWith('/permalink.php')) {
    if (groupId && parsed.searchParams.get('id') !== groupId) return null;
    parsed.searchParams.set('id', parsed.searchParams.get('id') || groupId || '');
    return `https://www.facebook.com${parsed.pathname}?${parsed.searchParams.toString()}`;
  }
  const normalized = match[0].replace('://facebook.com', '://www.facebook.com').replace(/\/$/, '');
  if (/\/share\/(?:p|v|r)\//i.test(normalized)) return `${normalized}/`;
  if (groupId && /^\d+$/.test(groupId) && !new RegExp(`/groups/${groupId}/(?:posts|permalink)/\\d+`, 'i').test(normalized)) return null;
  return `${normalized}/`;
}

// Looks up a post's permalink by matching the start of its caption against articles
// currently visible on the group page. Used by resolvePostedUrl in a later, separate
// pass so permalink lookup never blocks the posting loop for the next row.
function sheetDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
}

function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function relativeDateFromText(text, timezone, now = new Date()) {
  const value = cleanText(text).toLocaleLowerCase();
  if (/เมื่อวาน|yesterday/.test(value)) return dateInTimezone(new Date(now.getTime() - 86400000), timezone);
  if (/เมื่อสักครู่|just now/.test(value)) return dateInTimezone(now, timezone);
  const units = [
    { pattern: /(\d+)\s*(?:นาที|min(?:ute)?s?\b)/i, milliseconds: 60000 },
    { pattern: /(\d+)\s*(?:ชม\.?|ชั่วโมง|h(?:ou)?rs?\b)/i, milliseconds: 3600000 },
    { pattern: /(\d+)\s*(?:วัน|days?\b)/i, milliseconds: 86400000 },
    { pattern: /(\d+)\s*(?:สัปดาห์|weeks?\b)/i, milliseconds: 604800000 }
  ];
  for (const unit of units) {
    const match = value.match(unit.pattern);
    if (match) return dateInTimezone(new Date(now.getTime() - Number(match[1]) * unit.milliseconds), timezone);
  }
  return '';
}

function searchableText(value) {
  return cleanText(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getArticleDate(article, timezone) {
  const stamps = await article.locator('time[datetime], [data-utime], [data-time]').evaluateAll((elements) => elements.map((element) => ({
    datetime: element.getAttribute('datetime'),
    epoch: element.getAttribute('data-utime') || element.getAttribute('data-time')
  }))).catch(() => []);
  for (const stamp of stamps) {
    const date = stamp.datetime ? new Date(stamp.datetime) : stamp.epoch ? new Date(Number(stamp.epoch) * 1000) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }
  return '';
}

async function copyPermalinkFromArticle(page, article, groupId) {
  const viewInGroup = article.locator('a[href*="multi_permalinks"], a[href]').filter({ hasText: /view in group|ดูในกลุ่ม/i }).first();
  if (await viewInGroup.isVisible().catch(() => false)) {
    const href = await viewInGroup.getAttribute('href').catch(() => null);
    const hrefUrl = href ? new URL(href, 'https://www.facebook.com') : null;
    const postId = hrefUrl?.searchParams.get('multi_permalinks');
    const fallbackUrl = postId ? `https://www.facebook.com/groups/${groupId}/posts/${postId}/` : normalizePermalink(href, groupId);
    const originalUrl = page.url();
    const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await viewInGroup.click().catch(() => {});
    const popup = await popupPromise;
    const targetPage = popup || page;
    await targetPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    const openedUrl = normalizePermalink(targetPage.url(), groupId);
    if (openedUrl) {
      if (popup) await popup.close().catch(() => {});
      return openedUrl;
    }

    const dialog = targetPage.locator('[role="dialog"]').last();
    if (await dialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
      // Facebook renders the modal's post menu in a portal outside role="dialog".
      // The final visible menu trigger belongs to the foreground post modal.
      const menuButton = targetPage.locator('[aria-haspopup="menu"]:visible').last();
      if (await menuButton.isVisible().catch(() => false)) {
        await menuButton.click().catch(() => {});
        const copyItem = targetPage.locator('[role="menuitem"], [role="button"]').filter({ hasText: /copy link|คัดลอกลิงก์/i }).first();
        if (await copyItem.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
          await copyItem.click();
          await targetPage.waitForTimeout(300);
          const copied = await targetPage.evaluate(() => navigator.clipboard.readText()).catch(() => '');
          const copiedUrl = normalizePermalink(copied, groupId);
          if (copiedUrl) {
            if (popup) await popup.close().catch(() => {});
            else await targetPage.keyboard.press('Escape').catch(() => {});
            return copiedUrl;
          }
        }
      }
      await targetPage.keyboard.press('Escape').catch(() => {});
    }
    if (popup) await popup.close().catch(() => {});
    else if (page.url() !== originalUrl) await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    if (fallbackUrl) return fallbackUrl;
  }
  return null;
}

async function findPostByCaption(page, caption, groupId, expectedDisplayName, postedAt, timezone, { attempts = 4, waitMs = 4000 } = {}) {
  const needle = searchableText(caption).slice(0, 48).trim();
  const expectedAuthor = cleanText(expectedDisplayName).trim();
  const expectedDate = sheetDate(postedAt);
  if (!needle) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(waitMs);
    const matchingArticles = page.locator('[role="article"]');
    let article = null;
    const candidateCount = Math.min(await matchingArticles.count(), 20);
    for (let index = 0; index < candidateCount; index += 1) {
      const candidate = matchingArticles.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const fullText = cleanText(await candidate.innerText());
      if (!searchableText(fullText).includes(needle)) continue;
      const leadingText = fullText.split('\n').slice(0, 8).join('\n');
      if (expectedAuthor && !leadingText.toLocaleLowerCase().includes(expectedAuthor.toLocaleLowerCase())) continue;
      const candidateDate = await getArticleDate(candidate, timezone) || relativeDateFromText(leadingText, timezone);
      if (expectedDate && candidateDate && candidateDate !== expectedDate) continue;
      article = candidate;
      break;
    }
    if (article) {
      const copiedUrl = await copyPermalinkFromArticle(page, article, groupId);
      if (copiedUrl) return { found: true, url: copiedUrl };
      const hrefs = await article.locator('a[href]').evaluateAll((links) => links.map((link) => link.href || link.getAttribute('href'))).catch(() => []);
      for (const href of hrefs) {
        const normalized = normalizePermalink(href, groupId);
        if (normalized) return { found: true, url: normalized };
      }
      return { found: true, url: null };
    }
    await page.mouse.wheel(0, 1400).catch(() => {});
  }
  return null;
}

export async function launchFacebookContext(config, account, { onScreen = false } = {}) {
  await fs.mkdir(account.profileDir, { recursive: true });
  const args = ['--disable-notifications'];
  if (!onScreen) args.push('--window-position=-32000,-32000');
  const context = await chromium.launchPersistentContext(account.profileDir, {
    channel: config.chromeChannel,
    headless: config.facebookHeadless,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-GB',
    timezoneId: config.timezone,
    args
  });
  context.setDefaultTimeout(config.navigationTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return context;
}

export async function checkAccountLogin(config, account) {
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    await saveFacebookStorageState(config, account, context);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    await context.close().catch(() => {});
  }
}

async function prepareFacebookPostOnPage({ config, page, row, mediaPaths, close }) {
  let submissionStarted = false;
  try {
    await page.goto(String(row['Facebook Group URL']), { waitUntil: 'domcontentloaded' });
    await assertNoBlockingIssue(page);
    const dialog = await openComposer(page);
    await assertNoBlockingIssue(page);
    await attachMedia(page, dialog, mediaPaths, config.uploadTimeoutMs);
    const editor = dialog.locator('[contenteditable="true"][role="textbox"], [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 30000 });
    const caption = cleanText(row.Caption);
    await editor.fill(caption);
    const actualCaption = cleanText(await editor.innerText());
    if (actualCaption !== caption) throw new Error('Caption verification failed: Facebook composer text differs from the Sheet');
    // Typing a hashtag/mention can leave Facebook's suggestion popover open, which visually
    // overlaps the Post button and blocks clicks on it. Facebook only closes it on a real
    // click outside the editor (blur alone isn't enough), so click empty dialog padding.
    await dialog.click({ position: { x: 16, y: 16 } }).catch(() => {});
    await page.waitForTimeout(500);

    const postButton = dialog.getByRole('button', { name: /^(post|โพสต์)$/i }).last();
    await postButton.waitFor({ state: 'visible', timeout: config.uploadTimeoutMs });

    return {
      async submit() {
        try {
          await assertNoBlockingIssue(page);
          // A transient overlay (hashtag suggestions, a hover tooltip, etc.) can sit on top of
          // the Post button and block a mouse click. Focus + Enter activates it without any
          // pointer interaction, so it can't be blocked by whatever happens to be on top.
          await postButton.focus({ timeout: config.uploadTimeoutMs });
          await postButton.press('Enter', { timeout: config.uploadTimeoutMs });
          submissionStarted = true;
          await dialog.waitFor({ state: 'hidden', timeout: config.uploadTimeoutMs }).catch(() => {});
          const body = await pageText(page);
          const submittedForReview = /submitted for review|pending post|waiting for admin approval|ส่งให้ตรวจสอบแล้ว|รอการอนุมัติ|โพสต์ที่รอดำเนินการ/i.test(body);
          // Permalink lookup happens later, in a separate pass (see resolvePostedUrl below),
          // so it never delays moving on to the next row while posting a batch.
          return { status: submittedForReview ? 'Submitted for review' : 'Posted' };
        } catch (error) {
          error.submissionStarted = submissionStarted;
          await addFailureScreenshot(config, page, row, error);
          throw error;
        }
      },
      close
    };
  } catch (error) {
    error.submissionStarted = submissionStarted;
    await addFailureScreenshot(config, page, row, error);
    throw error;
  }
}

export async function createFacebookSession({ config, account }) {
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    await saveFacebookStorageState(config, account, context);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  return {
    async preparePost({ row, mediaPaths }) {
      return prepareFacebookPostOnPage({ config, page, row, mediaPaths, close: async () => {} });
    },
    async resolvePostedUrl({ row }) {
      return resolvePostedUrlOnPage({ page, row, expectedDisplayName: account.expectedDisplayName, timezone: config.timezone });
    },
    async close() {
      await context.close();
    }
  };
}

export async function createFacebookLookupSession({ config, account }) {
  const statePath = storageStatePath(config, account);
  const deadline = Date.now() + 15000;
  while (true) {
    const exists = await fs.access(statePath).then(() => true).catch(() => false);
    if (exists) break;
    if (Date.now() >= deadline) {
      throw new Error(`Facebook session snapshot is missing for ${account.sheetAccount}. Run npm run check:facebook -- --account "${account.sheetAccount}" once before starting parallel jobs.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const browser = await chromium.launch({
    channel: config.chromeChannel,
    headless: config.facebookHeadless,
    args: ['--disable-notifications', '--window-position=-32000,-32000']
  });
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-GB',
    timezoneId: config.timezone
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.facebook.com' }).catch(() => {});
  context.setDefaultTimeout(config.navigationTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  const page = await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
  return {
    async resolvePostedUrl({ row }) {
      return resolvePostedUrlOnPage({ page, row, expectedDisplayName: account.expectedDisplayName, timezone: config.timezone });
    },
    async close() {
      await browser.close();
    }
  };
}

export async function prepareFacebookPost({ config, account, row, mediaPaths, session }) {
  if (session) return session.preparePost({ row, mediaPaths });
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    return await prepareFacebookPostOnPage({
      config,
      page,
      row,
      mediaPaths,
      close: async () => { await context.close(); }
    });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

// Revisits a group page after posting is done to look up the permalink of a post that
// was already submitted. Meant to run in a batch, after every row has been posted, so a
// slow or failed lookup for one row never holds up posting the next one.
async function resolvePostedUrlOnPage({ page, row, expectedDisplayName, timezone }) {
  try {
    const groupId = await resolveGroupId(page, row['Facebook Group URL']);
    if (!groupId) throw new Error('Could not determine Facebook group ID from the group URL.');
    const pages = [
      { status: 'published', path: 'my_posted_content' },
      { status: 'pending', path: 'my_pending_content' },
      { status: 'removed', path: 'my_removed_content' }
    ];
    for (const candidatePage of pages) {
      await page.goto(`https://www.facebook.com/groups/${encodeURIComponent(groupId)}/${candidatePage.path}`, { waitUntil: 'domcontentloaded' });
      await assertNoBlockingIssue(page);
      const match = await findPostByCaption(page, row.Caption, groupId, expectedDisplayName, row['Posted At'], timezone, { attempts: 3, waitMs: 1500 });
      if (match?.found) {
        const url = candidatePage.status === 'published'
          ? match.url
          : `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/${candidatePage.path}`;
        return { ok: true, status: candidatePage.status, url };
      }
    }
    if (String(row['Posting Status'] || '').trim().toLowerCase() === 'submitted for review') {
      return {
        ok: true,
        status: 'pending',
        url: `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/my_pending_content`
      };
    }
    return { ok: true, status: null, url: null };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function resolvePostedUrl({ config, account, row, session }) {
  if (session) return session.resolvePostedUrl({ row });
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    return await resolvePostedUrlOnPage({ page, row, expectedDisplayName: account.expectedDisplayName, timezone: config.timezone });
  } catch (error) {
    return { ok: false, error };
  } finally {
    await context.close().catch(() => {});
  }
}
