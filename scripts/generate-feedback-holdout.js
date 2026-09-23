import { mkdir, writeFile } from 'node:fs/promises';
import { feedbackExample } from '../public/feedback-example.js';

const cases = [
  ['播放器非常順暢，字幕同步也很準確。', 'technical', 'positive', false, false, 0],
  ['影片偶爾停住，希望改善播放穩定性。', 'technical', 'negative', false, false, 1],
  ['影片每天卡住，我已經回報兩次仍沒改善。', 'technical', 'negative', false, false, 2],
  ['播放器完全不能用，修了多次還是一樣，實在太荒謬了！', 'technical', 'negative', false, false, 3],
  ['課程很精彩，但影片反覆緩衝，之前回報也沒有用。', 'technical', 'mixed', false, false, 2],
  ['請問播放器支援哪些畫質？', 'technical', 'neutral', false, false, 0],
  ['影片無法開啟，我想申請這筆課程退費。', 'technical', 'negative', true, false, 1],
  ['播放仍然中斷的話，我下個月就不續訂。', 'technical', 'negative', false, true, 1],

  ['教材內容完整，案例也很有幫助。', 'content', 'positive', false, false, 0],
  ['有一個章節的說明不清楚，希望補充範例。', 'content', 'negative', false, false, 1],
  ['教材版本一直過期，反映好幾次都沒有更新。', 'content', 'negative', false, false, 2],
  ['課程內容大量錯誤，官方還拒絕修正，真的令人憤怒！', 'content', 'negative', false, false, 3],
  ['老師講得很好，但講義有幾處錯字需要修正。', 'content', 'mixed', false, false, 1],
  ['請問這門課總共有幾個單元？', 'content', 'neutral', false, false, 0],
  ['教材內容與介紹不符，我要申請退款。', 'content', 'negative', true, false, 1],
  ['入門部分清楚，但進階內容持續缺漏，我已決定不續訂。', 'content', 'mixed', false, true, 2],

  ['年繳折扣很划算，我對目前方案很滿意。', 'pricing', 'positive', false, false, 0],
  ['月費稍微偏高，希望增加較便宜的方案。', 'pricing', 'negative', false, false, 1],
  ['帳單連續三個月金額不同，詢問後仍沒有說明。', 'pricing', 'negative', false, false, 2],
  ['無預警大幅漲價，這種收費方式太離譜了！', 'pricing', 'negative', false, false, 3],
  ['方案功能完整，但每個裝置都要額外付費。', 'pricing', 'mixed', false, false, 1],
  ['企業方案每位使用者如何計價？', 'pricing', 'neutral', false, false, 0],
  ['我誤買年繳方案，現在要取消並申請退款，沒有其他評價。', 'pricing', 'neutral', true, false, 0],
  ['目前價格很合理，但公司改用其他平台，我已決定到期不續訂。', 'pricing', 'positive', false, true, 0],

  ['客服回覆迅速而且說明清楚，非常感謝。', 'service', 'positive', false, false, 0],
  ['客服回覆有點慢，希望縮短等待時間。', 'service', 'negative', false, false, 1],
  ['同一案件追問三次，客服仍然沒有處理。', 'service', 'negative', false, false, 2],
  ['客服態度惡劣還直接掛電話，這種服務讓人非常生氣！', 'service', 'negative', false, false, 3],
  ['人員態度親切，但承諾的回電一直沒有發生。', 'service', 'mixed', false, false, 2],
  ['請問客服週末是否有人值班？', 'service', 'neutral', false, false, 0],
  ['客服處理得很好，不過公司政策改變，我們下期不再續訂。', 'service', 'positive', false, true, 0],
  ['我只是詢問客服退費規定，目前沒有要退款。', 'service', 'neutral', false, false, 0],

  ['需要協助，細節之後再補。', 'other', 'unclear', false, false, 0],
  ['關於平台有一件事，請看尚未附上的檔案。', 'other', 'unclear', false, false, 0],
  ['有個問題想反映，內容稍後提供。', 'other', 'unclear', false, false, 0],
  ['請幫忙處理。', 'other', 'unclear', false, false, 0],
  ['網站整體操作很直覺，我很喜歡新的深色模式。', 'other', 'positive', false, false, 0],
  ['通知信太多，希望可以關閉其中幾類。', 'other', 'negative', false, false, 1],
  ['登入很方便，但通知設定的位置很難找到。', 'other', 'mixed', false, false, 1],
  ['我要申請退款，也已決定停止使用；這只是帳務安排，沒有對平台的評價。', 'other', 'neutral', true, true, 0]
];

const problem = structuredClone(feedbackExample.questions);
const rows = cases.map(([text, main_topic, sentiment, refund_requested, expressed_churn_intent, expressed_frustration], index) => {
  const ordinal = String(index + 1).padStart(3, '0');
  return {
    id: `HOLD${ordinal}`, split: 'holdout', source: 'synthetic_manual_holdout_v2',
    state: { feedback: { id: `HOLD${ordinal}`, date: `2026-09-${String(index % 28 + 1).padStart(2, '0')}`, product: '線上課程平台', channel: '獨立測試集', text } },
    problem,
    ...(sentiment === 'unclear' ? { merged_sentiment_from: 'unclear' } : {}),
    expected: { main_topic, sentiment: sentiment === 'unclear' ? 'neutral' : sentiment, refund_requested, expressed_churn_intent, expressed_frustration }
  };
});
if (rows.length !== 40 || new Set(rows.map(row => row.state.feedback.text)).size !== 40) throw new Error('Holdout must contain 40 unique rows.');
await mkdir(new URL('../datasets/', import.meta.url), { recursive: true });
await writeFile(new URL('../datasets/feedback-holdout-40-v2.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
console.log(JSON.stringify({ rows: rows.length, file: 'datasets/feedback-holdout-40-v2.jsonl' }));
