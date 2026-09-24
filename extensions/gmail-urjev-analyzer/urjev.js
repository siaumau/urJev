export const EMAIL_PROBLEM = Object.freeze({
  spam_likelihood: {
    type: 'choice',
    instructions: '根據 email.subject、email.from、email.authentication_results、email.return_path、email.snippet 與 email.body，判斷郵件是否很可能是垃圾郵件、詐騙或未經請求的大量濫發。若 authentication_results 顯示 SPF、DKIM 或 DMARC 通過且與寄件網域對齊，這是來源真實的重要證據；官方帳戶安全通知不要只因出現「立即檢查」「有人嘗試登入」「查看活動」等警示文字就判成釣魚。正常品牌促銷、優惠、活動導購、交易通知、帳戶安全通知、收據、直接往來與使用者可能訂閱的電子報，不要僅因含行銷內容、追蹤連結或退訂連結就判成垃圾郵件。驗證失敗、網域不一致、索取密碼或付款資料及可疑連結仍是強烈風險訊號。',
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

export function buildEmailPayload(email, now = new Date()) {
  return {
    model: 'urjev',
    state: {
      analysis_date: now.toISOString(),
      email: {
        subject: email.subject,
        from: email.from,
        received_at: email.receivedAt,
        authentication_results: email.authenticationResults ?? '',
        return_path: email.returnPath ?? '',
        snippet: email.snippet,
        body: email.body
      }
    },
    problem: EMAIL_PROBLEM
  };
}

export function deriveClassification(answers) {
  const spam = answers?.spam_likelihood?.choice ?? 'unclear';
  const contentPurpose = answers?.content_purpose?.choice ?? 'other';
  const importance = answers?.importance?.choice ?? 'uncategorized';
  const urgency = answers?.urgency?.choice ?? 'not_urgent';
  const mentionsTime = Number(answers?.mentions_time?.noul ?? 0) >= 0.5;
  let category;
  if (spam === 'likely_spam') category = 'possible_spam';
  else if (contentPurpose === 'marketing') category = 'marketing';
  else if (contentPurpose === 'knowledge') category = 'knowledge';
  else if (importance === 'important') category = urgency === 'urgent' ? 'important_urgent' : 'important_not_urgent';
  else if (importance === 'secondary') category = 'secondary';
  else category = mentionsTime ? 'time_related' : 'uncategorized';
  return { spam, contentPurpose, importance, urgency, mentionsTime, category };
}

export const CATEGORY_LABELS = Object.freeze({
  possible_spam: '可能垃圾', important_urgent: '重要・緊急', important_not_urgent: '重要・不緊急',
  marketing: '行銷', knowledge: '新知', secondary: '次要', time_related: '時間相關', uncategorized: '未分類'
});

export async function analyzeEmail(email, endpoint, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildEmailPayload(email)) });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message || `urJev HTTP ${response.status}`);
  return { ...deriveClassification(body.answers), answers: body.answers, meta: body.meta, usage: body.usage };
}
