import test from 'node:test';
import assert from 'node:assert/strict';
import { needsLinkResolution, needsPermalink } from '../src/permalink.js';

test('selects posted rows whose permalink is missing or still a placeholder', () => {
  assert.equal(needsPermalink({ 'Posting Status': 'Posted', 'Posted URL': '' }), true);
  assert.equal(needsPermalink({ 'Posting Status': 'Posted', 'Posted URL': 'Posted — permalink not found, check manually' }), true);
  assert.equal(needsPermalink({ 'Posting Status': 'Submitted for review', 'Posted URL': 'Submitted for review — Facebook did not provide a post URL' }), true);
});

test('does not recheck rows that already have a URL or were not submitted', () => {
  assert.equal(needsPermalink({ 'Posting Status': 'Posted', 'Posted URL': 'https://www.facebook.com/groups/1/posts/2/' }), false);
  assert.equal(needsPermalink({ 'Posting Status': 'Failed', 'Posted URL': '' }), false);
});

test('resolves only posted rows with a blank post status', () => {
  assert.equal(needsLinkResolution({ 'Posting Status': 'Posted', 'status post': '' }), true);
  assert.equal(needsLinkResolution({ 'Posting Status': 'Submitted for review', 'status post': ' ' }), true);
  assert.equal(needsLinkResolution({ 'Posting Status': 'Posted', 'status post': 'เผยแพร่แล้ว' }), false);
  assert.equal(needsLinkResolution({ 'Posting Status': 'Failed', 'status post': '' }), false);
});
