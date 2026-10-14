const PLACEHOLDER_PATTERN = /permalink|did not provide a post url|requires manual review|outcome\/url/i;

export function needsPermalink(row) {
  const status = String(row['Posting Status'] || '').trim().toLowerCase();
  const postedUrl = String(row['Posted URL'] || '').trim();
  if (!['posted', 'submitted for review'].includes(status)) return false;
  return !postedUrl || PLACEHOLDER_PATTERN.test(postedUrl) || /\/my_pending_content\/?$/i.test(postedUrl);
}

export function needsLinkResolution(row) {
  const postStatus = String(row['status post'] || '').trim();
  const postingStatus = String(row['Posting Status'] || '').trim().toLowerCase();
  return !postStatus && ['posted', 'submitted for review'].includes(postingStatus);
}
