import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroupId } from '../src/facebook.js';

test('uses a group ID directly from a standard Facebook group URL', async () => {
  let navigated = false;
  const page = {
    goto: async () => { navigated = true; }
  };

  assert.equal(await resolveGroupId(page, 'https://www.facebook.com/groups/123456789/'), '123456789');
  assert.equal(navigated, false);
});

test('resolves a Facebook share group URL after its redirect', async () => {
  let currentUrl = 'https://www.facebook.com/share/g/short-code/';
  let requestedUrl = '';
  const page = {
    goto: async (url) => {
      requestedUrl = url;
      currentUrl = 'https://www.facebook.com/groups/987654321/?ref=share';
    },
    url: () => currentUrl,
    locator: (selector) => {
      if (selector === 'input[name="email"]') return { isVisible: async () => false };
      if (selector === 'body') return { innerText: async () => '' };
      if (selector === 'link[rel="canonical"]') return { getAttribute: async () => currentUrl };
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };

  assert.equal(await resolveGroupId(page, 'https://www.facebook.com/share/g/short-code/'), '987654321');
  assert.equal(requestedUrl, 'https://www.facebook.com/share/g/short-code/');
});