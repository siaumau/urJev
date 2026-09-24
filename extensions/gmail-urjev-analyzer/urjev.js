import { findClaimedOrganizations, hostnameMatchesDomain } from './trusted-organizations.js';

export const EMAIL_PROBLEM = Object.freeze({
  fraud_likelihood: {
    type: 'choice',
    instructions: '判斷是否很可能為詐騙或冒充郵件。綜合 sender_domain、sender_authenticated、sender_alignment、From、Reply-To、Return-Path、recipient_match、claimed_organizations、organization_sender_alignment、link_alignment、link_domains 與正文。若內容自稱某機構，必須比較已驗證寄件網域及實際連結目的網域是否屬於該機構公布的 official_domains；按鈕顯示文字不能取代實際網址。link_alignment=mismatch 且 organization_sender_alignment=mismatch 是強烈冒充訊號。電子報常由合法代寄服務寄送，使 Reply-To 或 Return-Path 與 From 不同；若 From 已通過 DKIM／DMARC、寄件網域符合品牌、內容是一般月報或行銷，且沒有索取帳密、驗證碼、付款、轉帳或敏感資料，sender_alignment=mismatch 不能單獨判成詐騙。recipient_match=mismatch 表示標頭明確是其他收件者；recipient_match=not_visible 可能只是 BCC 或郵件群組，不能單獨視為詐騙。若 sender_authenticated=true、recipient_match=matched，機構及連結合理吻合，且內容只是官方通知或行銷，應選 not_fraud。合法網域驗證通過只能證明寄件者控制該網域，若仍索取敏感資料或付款則不能因此排除詐騙。',
    criteria: {
      likely_fraud: '身分或網域明顯不一致並伴隨金錢、帳密、敏感資料或惡意操作誘導，或有其他明確冒充與詐騙證據',
      not_fraud: '寄件來源與聲稱身分合理一致，內容屬正常通知、帳戶安全警示、往來或推廣，沒有索取密碼、驗證碼、付款、轉帳等明確欺騙與敏感操作誘導',
      unclear: '驗證或內容證據不足，無法可靠排除或確認詐騙'
    }
  },
  spam_likelihood: {
    type: 'choice',
    instructions: '根據 email.subject、email.from、email.authentication_results、email.return_path、email.snippet 與 email.body，判斷郵件是否很可能是垃圾郵件、詐騙或未經請求的大量濫發。若 authentication_results 顯示 SPF、DKIM 或 DMARC 通過且與寄件網域對齊，這是來源真實的重要證據；官方帳戶安全通知不要只因出現警示文字就判成釣魚。正常品牌促銷、優惠、活動導購、交易通知、帳戶安全通知、收據、直接往來與使用者可能訂閱的電子報，不要僅因含行銷內容、追蹤連結、退訂連結或代寄服務的 Return-Path 就判成垃圾郵件。像品牌月報、產業趨勢摘要及產品電子報應依 content_purpose 分到 marketing 或 knowledge。驗證失敗、品牌與網域不一致、索取密碼或付款資料及可疑連結仍是強烈風險訊號。',
    criteria: {
      likely_spam: '有明確大量濫發、欺騙、釣魚、可疑獎金、惡意連結誘導、假冒身分或與收件者無合理關係的強訊號',
      not_spam: '看起來是正常往來、帳戶或交易通知、合理訂閱內容，沒有明確垃圾或詐騙訊號',
      unclear: '現有內容不足，無法可靠判斷是否為垃圾郵件'
    }
  },
  content_purpose: {
    type: 'choice',
    instructions: '判斷郵件的主要內容目的。以促成購買、註冊、點擊、領取優惠或參加商業活動為主要目的時選 marketing；以分享可學習、可參考的知識內容為主要目的時選 knowledge；交易、帳戶、工作往來、私人通信、系統通知或資訊不足時選 other。電子報要依主要內容判斷，不要看到「電子報」三字就固定分類。',
    criteria: {
      marketing: '主要是產品或服務推廣、折扣優惠、促銷活動、導購、品牌宣傳、商業邀約或以轉換為目的的內容',
      knowledge: '主要是教學、研究摘要、產業趨勢、技術文章、專業觀點、案例解析、知識整理或非導購型資訊分享',
      other: '主要是交易或帳戶通知、工作與私人往來、系統訊息，或沒有足夠訊號判定為行銷或新知'
    }
  },
  importance: {
    type: 'choice',
    instructions: '判斷郵件對收件者的實際重要性。重要表示與本人、帳戶安全、金錢、訂單、工作、學習義務、法律義務或直接人際往來有明確關係；次要表示可稍後閱讀的更新、一般通知、電子報、知識分享或促銷。教學、研究或產業資訊本身不代表需要本人處理，不要只因內容有學習價值就選 important；無法歸類時選 uncategorized。',
    criteria: {
      important: '需要本人留意、回覆、決策或採取行動，忽略可能造成實際影響',
      secondary: '有內容價值但優先度低，可延後處理或不需採取明確行動',
      uncategorized: '資訊不足、純系統雜訊，或不符合重要與次要的定義'
    }
  },
  urgency: {
    type: 'choice',
    instructions: '判斷收件者是否需要近期立即處理。只有明確期限、即將發生的行程、帳戶或付款風險、必須迅速回覆等行動壓力才算 urgent；行銷文案自稱限時或緊急不能單獨當成真正緊急，「最新」「本週摘要」「近期趨勢」「每日更新」等內容時間也不算需要收件者處理的期限。',
    criteria: {
      urgent: '需要立即或在明確短期限內處理，延誤會造成具體損失或錯過事件',
      not_urgent: '沒有明確近期時間壓力，可以稍後處理'
    }
  },
  mentions_time: {
    type: 'noul',
    instructions: 'email.subject、email.snippet 或 email.body 是否明確提到日期、時間、期限、會議時段、行程或到期日？忽略 email.received_at、郵件標頭日期與頁尾版權年份。'
  }
});

const encoder = new TextEncoder();
// Keep room for fraud_likelihood, the largest fixed instruction, inside the
// server's 7,000-byte per-question guard even when every field is populated.
const PROMPT_STATE_BUDGET = 3300;
const clipBytes = (text, budget, fromEnd = false) => {
  const characters = Array.from(String(text ?? '')); let used = 0, output = '';
  const source = fromEnd ? characters.reverse() : characters;
  for (const character of source) {
    const size = encoder.encode(character).length;
    if (used + size > budget) break;
    output = fromEnd ? character + output : output + character; used += size;
  }
  return output;
};

export function clipUtf8Middle(text, maxBytes) {
  const value = String(text ?? '');
  if (encoder.encode(value).length <= maxBytes) return value;
  const marker = '\n[內容已截短]\n', markerBytes = encoder.encode(marker).length;
  const available = Math.max(0, maxBytes - markerBytes), front = Math.floor(available * .72);
  return `${clipBytes(value, front)}${marker}${clipBytes(value, available - front, true)}`;
}

export function clipUtf8Prefix(text, maxBytes) {
  const value = String(text ?? '');
  if (encoder.encode(value).length <= maxBytes) return value;
  const marker = '\n[內容已截短]', markerBytes = encoder.encode(marker).length;
  return `${clipBytes(value, Math.max(0, maxBytes - markerBytes))}${marker}`;
}

const addresses = value => [...String(value ?? '').toLowerCase().matchAll(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+/g)].map(match => match[0]);
const domainOf = value => addresses(value)[0]?.split('@')[1] ?? '';
const domainsAlign = (left, right) => Boolean(left && right && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)));

export function deriveIdentitySignals(email) {
  const account = String(email.recipientAccount ?? '').trim().toLowerCase();
  const fromDomain = domainOf(email.from), replyDomain = domainOf(email.replyTo), returnDomain = domainOf(email.returnPath);
  const authentication = String(email.authenticationResults ?? '').toLowerCase();
  const authenticatedDomains = [
    ...[...authentication.matchAll(/dkim=pass[^;]*?header\.i=@?([^\s;]+)/g)].map(match => match[1]),
    ...[...authentication.matchAll(/dmarc=pass[^;]*?header\.from=([^\s;]+)/g)].map(match => match[1])
  ];
  const senderAuthenticated = Boolean(fromDomain && authenticatedDomains.some(domain => domainsAlign(fromDomain, domain)));
  const routeMismatch = Boolean((replyDomain && !domainsAlign(fromDomain, replyDomain)) || (returnDomain && !domainsAlign(fromDomain, returnDomain)));
  const visibleRecipients = [email.to, email.cc, email.deliveredTo, email.originalTo].flatMap(addresses);
  const recipientMatch = !account ? 'unknown' : visibleRecipients.includes(account) ? 'matched' : visibleRecipients.length ? 'mismatch' : 'not_visible';
  return { recipientAccount: account, recipientMatch, senderDomain: fromDomain, senderAuthenticated, senderAlignment: routeMismatch ? 'mismatch' : senderAuthenticated ? 'aligned' : 'unverified' };
}

const parseHttpUrl = value => {
  try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) ? url : null; } catch { return null; }
};

export function deriveOrganizationSignals(email) {
  const identity = deriveIdentitySignals(email);
  const linkLabels = (email.links ?? []).map(link => typeof link === 'string' ? '' : link?.text).filter(Boolean).join('\n');
  const content = [email.subject, email.from, email.snippet, email.body, linkLabels].filter(Boolean).join('\n');
  const organizations = findClaimedOrganizations(content);
  const urls = [...(email.links ?? []).map(link => typeof link === 'string' ? link : link?.url), ...String(email.body ?? '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map(item => typeof item === 'string' ? item : item[0]);
  const linkDomains = [...new Set(urls.map(parseHttpUrl).filter(Boolean).map(url => url.hostname.toLowerCase().replace(/^www\./, '')))];
  if (!organizations.length) return { claimedOrganizations: [], officialDomains: [], linkDomains, linkAlignment: 'no_claim', organizationSenderAlignment: 'no_claim', suspiciousLinkDomains: [] };
  const officialDomains = [...new Set(organizations.flatMap(item => item.officialDomains))];
  const matchesOfficial = hostname => officialDomains.some(domain => hostnameMatchesDomain(hostname, domain));
  const officialLinks = linkDomains.filter(matchesOfficial), suspiciousLinkDomains = linkDomains.filter(domain => !matchesOfficial(domain));
  const linkAlignment = !linkDomains.length ? 'no_links' : suspiciousLinkDomains.length ? (officialLinks.length ? 'mixed' : 'mismatch') : 'official';
  const senderOfficial = matchesOfficial(identity.senderDomain);
  const organizationSenderAlignment = senderOfficial && identity.senderAuthenticated ? 'official_authenticated' : senderOfficial ? 'official_unverified' : 'mismatch';
  return { claimedOrganizations: organizations.map(item => item.name), officialDomains, linkDomains, linkAlignment, organizationSenderAlignment, suspiciousLinkDomains };
}

export function compactEmailState(email, now = new Date()) {
  const signals = deriveIdentitySignals(email);
  const organization = deriveOrganizationSignals(email);
  const raw = {
    subject: String(email.subject ?? ''), from: String(email.from ?? ''), reply_to: String(email.replyTo ?? ''),
    to: String(email.to ?? ''), cc: String(email.cc ?? ''), delivered_to: String(email.deliveredTo ?? ''), original_to: String(email.originalTo ?? ''),
    recipient_account: signals.recipientAccount, recipient_match: signals.recipientMatch,
    sender_domain: signals.senderDomain, sender_authenticated: String(signals.senderAuthenticated), sender_alignment: signals.senderAlignment,
    claimed_organizations: organization.claimedOrganizations.join(', '), official_domains: organization.officialDomains.join(', '),
    organization_sender_alignment: organization.organizationSenderAlignment, link_alignment: organization.linkAlignment,
    link_domains: organization.linkDomains.join(', '), suspicious_link_domains: organization.suspiciousLinkDomains.join(', '),
    received_at: String(email.receivedAt ?? ''),
    authentication_results: String(email.authenticationResults ?? ''), return_path: String(email.returnPath ?? ''),
    snippet: String(email.snippet ?? ''), body: String(email.body ?? '')
  };
  if (raw.body && raw.snippet && raw.body.includes(raw.snippet)) raw.snippet = '';
  const limits = { subject: 260, from: 260, reply_to: 180, to: 220, cc: 140, delivered_to: 140, original_to: 140, recipient_account: 120, recipient_match: 20, sender_domain: 120, sender_authenticated: 8, sender_alignment: 20, claimed_organizations: 100, official_domains: 180, organization_sender_alignment: 30, link_alignment: 20, link_domains: 350, suspicious_link_domains: 250, received_at: 80, authentication_results: 400, return_path: 140, snippet: 220, body: 2000 };
  const minimum = { body: 700, authentication_results: 100, snippet: 0, cc: 0, original_to: 0, delivered_to: 0, return_path: 0, reply_to: 0, to: 80, from: 100, subject: 100, received_at: 0, recipient_account: 60, recipient_match: 10, sender_domain: 40, sender_authenticated: 4, sender_alignment: 8, claimed_organizations: 30, official_domains: 50, organization_sender_alignment: 12, link_alignment: 8, link_domains: 80, suspicious_link_domains: 50 };
  const compactField = key => key === 'body' ? clipUtf8Prefix(raw[key], limits[key]) : clipUtf8Middle(raw[key], limits[key]);
  const state = { analysis_date: now.toISOString(), email: Object.fromEntries(Object.keys(raw).map(key => [key, compactField(key)])) };
  const size = () => encoder.encode(JSON.stringify({ state })).length;
  const order = ['authentication_results', 'snippet', 'cc', 'original_to', 'delivered_to', 'return_path', 'reply_to', 'to', 'from', 'subject', 'received_at', 'recipient_account', 'sender_domain', 'link_domains', 'suspicious_link_domains', 'body'];
  while (size() > PROMPT_STATE_BUDGET) {
    const key = order.find(name => limits[name] > minimum[name]);
    if (!key) break;
    limits[key] = Math.max(minimum[key], limits[key] - 160);
    state.email[key] = compactField(key);
  }
  return state;
}

export function buildEmailPayload(email, now = new Date()) {
  return {
    model: 'urjev',
    state: compactEmailState(email, now),
    problem: EMAIL_PROBLEM
  };
}

export function deriveClassification(answers) {
  const fraud = answers?.fraud_likelihood?.choice ?? 'unclear';
  const spam = answers?.spam_likelihood?.choice ?? 'unclear';
  const contentPurpose = answers?.content_purpose?.choice ?? 'other';
  const importance = answers?.importance?.choice ?? 'uncategorized';
  const urgency = answers?.urgency?.choice ?? 'not_urgent';
  const mentionsTime = Number(answers?.mentions_time?.noul ?? 0) >= 0.5;
  let category;
  if (fraud === 'likely_fraud') category = 'suspected_fraud';
  else if (spam === 'likely_spam') category = 'possible_spam';
  else if (contentPurpose === 'marketing') category = 'marketing';
  else if (contentPurpose === 'knowledge') category = 'knowledge';
  else if (importance === 'important') category = urgency === 'urgent' ? 'important_urgent' : 'important_not_urgent';
  else if (importance === 'secondary') category = 'secondary';
  else category = mentionsTime ? 'time_related' : 'uncategorized';
  return { fraud, spam, contentPurpose, importance, urgency, mentionsTime, category };
}

export const CATEGORY_LABELS = Object.freeze({
  suspected_fraud: '可能詐騙', possible_spam: '可能垃圾', important_urgent: '重要・緊急', important_not_urgent: '重要・不緊急',
  marketing: '行銷', knowledge: '新知', secondary: '次要', time_related: '時間相關', uncategorized: '未分類'
});

export async function analyzeEmail(email, endpoint, fetchImpl = fetch) {
  const payload = buildEmailPayload(email);
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message || `urJev HTTP ${response.status}`);
  const classification = deriveClassification(body.answers);
  const strongBrandMismatch = payload.state.email.link_alignment === 'mismatch' && payload.state.email.organization_sender_alignment === 'mismatch';
  const sensitiveRequest = /密碼|驗證碼|一次性密碼|信用卡號|卡號|轉帳|匯款|加密貨幣|助記詞|(?:請|立即|必須).{0,10}(?:登入驗證|驗證帳戶|確認身分)|password|one[- ]time password|\botp\b|wire transfer|seed phrase/i.test(`${email.subject ?? ''}\n${email.body ?? ''}`);
  const verifiedBrandNewsletter = payload.state.email.organization_sender_alignment === 'official_authenticated'
    && payload.state.email.recipient_match === 'matched'
    && classification.contentPurpose === 'marketing'
    && ['official', 'mixed', 'no_links'].includes(payload.state.email.link_alignment)
    && !sensitiveRequest;
  if (strongBrandMismatch) { classification.fraud = 'likely_fraud'; classification.category = 'suspected_fraud'; }
  else if (verifiedBrandNewsletter) {
    classification.fraud = 'not_fraud';
    if (classification.spam === 'not_spam') classification.category = 'marketing';
  }
  return { ...classification, recipientMatch: payload.state.email.recipient_match, senderAuthenticated: payload.state.email.sender_authenticated === 'true', senderAlignment: payload.state.email.sender_alignment, claimedOrganizations: payload.state.email.claimed_organizations, linkAlignment: payload.state.email.link_alignment, suspiciousLinkDomains: payload.state.email.suspicious_link_domains, organizationSenderAlignment: payload.state.email.organization_sender_alignment, answers: body.answers, meta: body.meta, usage: body.usage };
}
