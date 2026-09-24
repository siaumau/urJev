export const EMAIL_PROBLEM = Object.freeze({
  spam_likelihood: {
    type: 'choice',
    instructions: '只根據 email.subject、email.from、email.snippet 與 email.body，判斷郵件是否很可能是垃圾郵件、詐騙或未經請求的大量推銷。正常交易通知、帳戶安全通知、收據、直接往來與使用者可能訂閱的電子報不要僅因含促銷就判成垃圾郵件。',
    criteria: {
      likely_spam: '有明確大量濫發、欺騙、釣魚、可疑獎金、惡意連結誘導、假冒身分或與收件者無合理關係的強訊號',
      not_spam: '看起來是正常往來、帳戶或交易通知、合理訂閱內容，沒有明確垃圾或詐騙訊號',
      unclear: '現有內容不足，無法可靠判斷是否為垃圾郵件'
    }
  },
  importance: {
    type: 'choice',
    instructions: '判斷郵件對收件者的實際重要性。重要表示與本人、帳戶安全、金錢、訂單、工作、學習、法律義務或直接人際往來有明確關係；次要表示可稍後閱讀的更新、一般通知、電子報或促銷；無法歸類時選 uncategorized。',
    criteria: {
      important: '需要本人留意、回覆、決策或採取行動，忽略可能造成實際影響',
      secondary: '有內容價值但優先度低，可延後處理或不需採取明確行動',
      uncategorized: '資訊不足、純系統雜訊，或不符合重要與次要的定義'
    }
  },
  urgency: {
    type: 'choice',
    instructions: '判斷是否需要近期立即處理。只有明確期限、即將發生的行程、帳戶或付款風險、必須迅速回覆等時間壓力才算 urgent；行銷文案自稱限時或緊急，不能單獨當成真正緊急。',
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

export function buildEmailPayload(email, now = new Date()) {
  return {
    model: 'urjev',
    state: {
      analysis_date: now.toISOString(),
      email: {
        subject: email.subject,
        from: email.from,
        received_at: email.receivedAt,
        snippet: email.snippet,
        body: email.body
      }
    },
    problem: EMAIL_PROBLEM
  };
}

export function deriveClassification(answers) {
  const spam = answers?.spam_likelihood?.choice ?? 'unclear';
  const importance = answers?.importance?.choice ?? 'uncategorized';
  const urgency = answers?.urgency?.choice ?? 'not_urgent';
  const mentionsTime = Number(answers?.mentions_time?.noul ?? 0) >= 0.5;
  let category;
  if (spam === 'likely_spam') category = 'possible_spam';
  else if (importance === 'important') category = urgency === 'urgent' ? 'important_urgent' : 'important_not_urgent';
  else if (importance === 'secondary') category = 'secondary';
  else category = mentionsTime ? 'time_related' : 'uncategorized';
  return { spam, importance, urgency, mentionsTime, category };
}

export const CATEGORY_LABELS = Object.freeze({
  possible_spam: '可能垃圾', important_urgent: '重要・緊急', important_not_urgent: '重要・不緊急',
  secondary: '次要', time_related: '時間相關', uncategorized: '未分類'
});

export async function analyzeEmail(email, endpoint, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildEmailPayload(email)) });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message || `urJev HTTP ${response.status}`);
  return { ...deriveClassification(body.answers), answers: body.answers, meta: body.meta, usage: body.usage };
}
