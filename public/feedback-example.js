export const feedbackExample = {
  state: { feedback: { id: 'R001', date: '2026-09-22', product: '線上課程平台', channel: '客服表單', text: '課程內容很實用，但影片一直卡住，換瀏覽器也一樣。我已經反映三次，都沒有改善。如果這週還沒修好，我就不續訂了，請問可以退費嗎？' } },
  questions: {
    main_topic: { type: 'choice', instructions: '根據 `feedback.text`，這則回饋最主要希望解決的是哪一類問題？若提到多個主題，選擇造成主要困擾的問題。', criteria: { technical: '功能故障、播放異常、速度或穩定性問題', content: '內容品質、正確性或實用性問題', pricing: '價格或方案是否划算', service: '客服態度、回應或處理方式問題', other: '其他主題或資訊不足以分類' } },
    sentiment: { type: 'choice', instructions: '根據 `feedback.text` 明確表達的評價，這則回饋的情緒屬於哪一類？同時包含明確肯定與不滿時，選擇 mixed。', criteria: { positive: '表達肯定或滿意，沒有明確不滿', negative: '表達不滿或批評，沒有明確肯定', mixed: '同時表達肯定與不滿', neutral: '沒有明確正負評價，包括事實陳述、詢問或資訊不足' } },
    refund_requested: { type: 'noul', instructions: '`feedback.text` 是否提出退款要求，或詢問自己是否可以退款？只提及退款政策但沒有自身退款意圖不算。' },
    expressed_churn_intent: { type: 'noul', instructions: '`feedback.text` 是否明確表達取消訂閱、不再續訂或停止使用的意圖，包括附帶條件的意圖？不要僅因顧客不滿就推定他會離開。' },
    expressed_frustration: { type: 'score', instructions: '只根據 `feedback.text` 的措辭，評估顧客表達的不滿程度。不要推測未表達的內心感受。', criteria: ['沒有表達不滿，只是詢問、陳述或肯定', '表達輕微不便或希望改善，沒有強烈抱怨', '明確抱怨問題持續、反覆發生或處理無效', '表達強烈憤怒、斥責或激烈抗議'] }
  }
};
