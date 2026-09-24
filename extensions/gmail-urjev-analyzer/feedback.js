const STORAGE_KEY = 'gmailClassificationFeedbackV1';
const MAX_RECORDS = 500;

export function senderIdentity(from = '') {
  const address = (from.match(/<([^>]+@[^>]+)>/)?.[1] || from.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+/)?.[0] || '').toLowerCase();
  return { address, domain: address.split('@')[1] || '' };
}

export function subjectFeatures(subject = '') {
  const normalized = subject.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const features = new Set(normalized.match(/[a-z0-9]{2,}/g) ?? []);
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (sequence.length === 1) features.add(sequence);
    else for (let index = 0; index < sequence.length - 1; index++) features.add(sequence.slice(index, index + 2));
  }
  return [...features].sort();
}

export function authenticatedSender(email) {
  if (typeof email.authenticated === 'boolean') return email.authenticated;
  const domain = senderIdentity(email.from).domain;
  const results = String(email.authenticationResults ?? '').toLowerCase();
  return Boolean(domain && results.includes(domain) && /(?:dkim|dmarc)=pass/.test(results));
}

function similarity(left, right) {
  const a = new Set(left), b = new Set(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0; for (const item of a) if (b.has(item)) overlap++;
  return overlap / (a.size + b.size - overlap);
}

export function createFeedbackRecord(email, sourceCategory, correctedCategory, now = new Date()) {
  const sender = senderIdentity(email.from);
  return { id: `${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`, senderAddress: sender.address, senderDomain: sender.domain, subjectFeatures: subjectFeatures(email.subject), authenticated: authenticatedSender(email), sourceCategory, correctedCategory, correctedAt: now.toISOString() };
}

export function matchFeedback(records, email, modelCategory = '') {
  const sender = senderIdentity(email.from), features = subjectFeatures(email.subject);
  const incomingAuthenticated = authenticatedSender(email);
  const eligible = record => modelCategory !== 'possible_spam' || record.correctedCategory === 'possible_spam' || (record.authenticated && incomingAuthenticated);
  const sameSender = records.filter(record => record.senderAddress && record.senderAddress === sender.address && eligible(record));
  const similar = sameSender.map(record => ({ record, score: similarity(record.subjectFeatures ?? [], features) })).filter(item => item.score >= .3).sort((a, b) => b.score - a.score || b.record.correctedAt.localeCompare(a.record.correctedAt));
  if (similar.length) return { category: similar[0].record.correctedCategory, reason: 'same_sender_similar_subject', score: similar[0].score };

  const senderCounts = new Map();
  for (const record of sameSender) senderCounts.set(record.correctedCategory, (senderCounts.get(record.correctedCategory) ?? 0) + 1);
  const senderWinner = [...senderCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (senderWinner && senderWinner[1] >= 2 && senderWinner[1] === sameSender.length) return { category: senderWinner[0], reason: 'same_sender_consensus', score: 1 };

  const sameDomain = records.filter(record => record.senderDomain && record.senderDomain === sender.domain && eligible(record));
  const domainCounts = new Map();
  for (const record of sameDomain) domainCounts.set(record.correctedCategory, (domainCounts.get(record.correctedCategory) ?? 0) + 1);
  const domainWinner = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (domainWinner && domainWinner[1] >= 3 && domainWinner[1] / sameDomain.length >= .8) return { category: domainWinner[0], reason: 'domain_consensus', score: domainWinner[1] / sameDomain.length };
  return null;
}

export async function getFeedbackRecords() {
  return (await chrome.storage.local.get({ [STORAGE_KEY]: [] }))[STORAGE_KEY];
}

export async function saveFeedback(email, sourceCategory, correctedCategory) {
  const record = createFeedbackRecord(email, sourceCategory, correctedCategory);
  const records = await getFeedbackRecords();
  const signature = `${record.senderAddress}|${record.subjectFeatures.join(',')}|${record.correctedCategory}`;
  const next = [record, ...records.filter(item => `${item.senderAddress}|${(item.subjectFeatures ?? []).join(',')}|${item.correctedCategory}` !== signature)].slice(0, MAX_RECORDS);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return record;
}

export async function findLearnedCorrection(email, modelCategory = '') {
  return matchFeedback(await getFeedbackRecords(), email, modelCategory);
}

export async function clearFeedbackRecords() {
  await chrome.storage.local.remove(STORAGE_KEY);
}
