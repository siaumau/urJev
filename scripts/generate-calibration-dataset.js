import { mkdir, writeFile } from 'node:fs/promises';
import { feedbackExample } from '../public/feedback-example.js';

const seed = 20260923;
let state = seed;
const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = values => values[Math.floor(random() * values.length)];
const products = ['線上課程平台', '語言學習平台', '職能培訓平台', '程式學習平台'];
const channels = ['客服表單', '站內回饋', '續訂問卷', 'App 回饋'];
const suffixes = ['謝謝。', '請協助確認。', '希望可以盡快處理。', '想知道後續安排。'];

const topics = {
  technical: {
    positive: ['影片播放很順暢，倍速切換也很好用；希望新增離線播放功能。', '播放器操作很流暢，希望能記住上次的播放速度。', '手機與電腦同步得很好，希望增加投放到電視的功能。', '字幕切換很方便，希望新增自動下載選項。', '目前播放功能很穩定，想建議加入子母畫面。'],
    negative: ['影片偶爾會卡住，麻煩協助改善。', '切換章節時常要重新載入，使用上有些不便。', '影片持續卡住，我已回報三次仍未改善。', '播放器每天都會中斷，重新安裝後還是一樣。', '影片完全不能播放，反映多次都沒用，真的讓人非常生氣！'],
    mixed: ['課程內容很實用，但影片播放經常卡住。', '老師講解得很好，可是播放器切換章節很慢。', '字幕功能很方便，但手機播放每天都會中斷。', '平台介面清楚，不過影片畫質一直自動下降。'],
    neutral: ['請問影片是否支援離線播放？', '想了解播放器能否固定為 1.5 倍速。', '請問字幕可以下載嗎？', '手機版是否支援子母畫面？']
  },
  content: {
    positive: ['課程內容很實用，希望增加資料分析的進階章節。', '老師的範例很清楚，想再看到更多實作題。', '教材整理得很好，希望新增課後練習。', '內容深入又容易理解，期待後續系列課程。', '講義很完整，希望增加英文版教材。'],
    negative: ['部分教材說明不夠清楚，希望補充範例。', '有幾個章節內容太舊，請協助更新。', '教材錯字反覆出現，回報兩次仍未修正。', '課程內容和介紹不一致，很多章節都缺少範例。', '教材大量錯誤，反映後完全沒有修改，真的非常失望！'],
    mixed: ['老師講解生動，但講義有不少錯字。', '課程架構很好，可是部分內容已經過時。', '實作題很有幫助，但答案說明常常缺漏。', '入門內容很清楚，不過進階章節過於簡略。'],
    neutral: ['請問下個月會新增哪些課程？', '想確認講義是否有英文版本。', '課後練習共有幾題？', '請問這門課涵蓋哪些章節？']
  },
  pricing: {
    positive: ['年繳方案很划算，想了解是否還有學生優惠。', '目前價格合理，希望推出家庭共享方案。', '方案內容符合需求，想詢問企業大量授權。', '折扣很實用，希望續訂時也能使用。', '月費可以接受，想了解升級方案的價差。'],
    negative: ['月費有點高，希望提供更彈性的方案。', '升級價差比預期高，請說明計價方式。', '價格連續調整兩次，但方案內容沒有增加。', '帳單每月金額不同，詢問多次仍沒有說明。', '突然大幅漲價又沒有通知，這種收費方式太離譜了！'],
    mixed: ['課程很多也很實用，但月費偏高。', '年繳折扣不錯，可是升級費用超出預算。', '方案功能完整，但不同裝置還要另外付費。', '試用體驗很好，不過正式方案的價格太高。'],
    neutral: ['請問月繳與年繳分別是多少？', '學生方案需要提供哪些證明？', '想了解企業授權如何計價。', '升級方案會從哪一天開始收費？']
  },
  service: {
    positive: ['客服回覆很親切，希望表揚今天協助我的人員。', '客服很快就解決問題，想留下正面回饋。', '處理人員說明得很清楚，希望轉達感謝。', '客服追蹤很完整，想詢問如何給予評價。', '這次服務很有耐心，希望主管能知道。'],
    negative: ['客服回覆稍慢，希望縮短等待時間。', '處理說明不夠清楚，麻煩再確認一次。', '同一問題已聯絡三次，客服仍沒有回覆。', '每次客服都要我重新說明，問題一直沒有處理。', '客服態度非常惡劣，申訴多次也沒人理會！'],
    mixed: ['客服態度很親切，但問題到現在仍未解決。', '回覆速度很快，可是提供的處理方式無效。', '客服說明很有耐心，但承諾的回電沒有發生。', '人員態度很好，不過案件被重複轉接很多次。'],
    neutral: ['請問客服服務時間到幾點？', '想查詢案件目前由哪個部門處理。', '客服案件編號要在哪裡查看？', '請問可以改用電話聯絡嗎？']
  },
  other: {
    positive: ['整體使用體驗很好，想詢問電子發票如何下載。', '平台設計很清楚，希望增加深色模式。', '登入流程很方便，想建議加入更多頭像選項。', '通知整理得很好，希望能自訂寄送時間。', '網站操作很直覺，想了解發票抬頭如何修改。'],
    negative: ['電子發票不容易找到，希望改善入口。', '通知信有點太多，希望可以分別關閉。', '帳號資料連續兩次無法修改，請協助處理。', '發票資訊一直顯示錯誤，回報後仍未更正。', '帳號設定完全無法儲存，處理很久都沒結果，實在太糟了！'],
    mixed: ['網站介面很好看，但通知設定很難找到。', '登入很方便，可是電子發票資訊一直錯誤。', '首頁整理得很清楚，但帳號資料無法修改。', '搜尋功能很好用，不過通知信重複寄送。'],
    neutral: ['請問電子發票在哪裡下載？', '想了解如何修改帳號名稱。', '通知信可以設定寄送時間嗎？', '請問如何刪除舊的登入裝置？']
  }
};

const frustrationFor = (sentiment, index) => sentiment === 'negative' ? [1, 1, 2, 2, 3][index] : sentiment === 'mixed' ? [1, 1, 2, 2][index] : 0;
const rows = [];
for (const [topic, groups] of Object.entries(topics)) {
  for (const sentiment of ['positive', 'negative', 'mixed', 'neutral']) {
    groups[sentiment].forEach((base, index) => rows.push({ topic, sentiment, frustration: frustrationFor(sentiment, index), base }));
  }
}
for (let index = 0; index < 10; index++) rows.push({ topic: 'other', sentiment: 'unclear', frustration: 0, base: pick(['需要協助。', '關於平台的事情。', '詳情之後補充。', '請看附件。', '有一個問題。']) + ` 參考代碼 U${index + 1}。` });

// Shuffle deterministically so each split contains a mixture of topics and labels.
for (let index = rows.length - 1; index > 0; index--) {
  const target = Math.floor(random() * (index + 1));
  [rows[index], rows[target]] = [rows[target], rows[index]];
}

const problem = structuredClone(feedbackExample.questions);
const output = rows.map((row, index) => {
  const refund = row.sentiment !== 'unclear' && index % 4 === 0;
  const churn = row.sentiment !== 'unclear' && index % 5 === 0;
  const refundText = refund ? '另外，我想申請退費。' : index % 4 === 1 ? '我只是了解退費規則，目前沒有要申請。' : '';
  const churnText = churn ? '我已決定下期不再續訂。' : index % 5 === 1 ? '目前沒有取消訂閱或停止使用的打算。' : '';
  const text = row.sentiment === 'unclear' ? row.base : [row.base, refundText, churnText, pick(suffixes)].filter(Boolean).join(' ');
  const ordinal = String(index + 1).padStart(3, '0');
  return {
    id: `CAL${ordinal}`,
    split: index < 60 ? 'calibration' : index < 80 ? 'validation' : 'test',
    source: 'synthetic_seeded_v2',
    seed,
    state: { feedback: { id: `CAL${ordinal}`, date: `2026-09-${String(index % 28 + 1).padStart(2, '0')}`, product: pick(products), channel: pick(channels), text } },
    problem,
    ...(row.sentiment === 'unclear' ? { merged_sentiment_from: 'unclear' } : {}),
    expected: { main_topic: row.topic, sentiment: row.sentiment === 'unclear' ? 'neutral' : row.sentiment, refund_requested: refund, expressed_churn_intent: churn, expressed_frustration: row.frustration }
  };
});

if (output.length !== 100 || new Set(output.map(item => item.state.feedback.text)).size !== 100) throw new Error('Dataset must contain 100 unique texts.');
const counts = field => Object.fromEntries([...new Set(output.map(item => item.expected[field]))].sort().map(value => [value, output.filter(item => item.expected[field] === value).length]));
const splitCounts = Object.fromEntries(['calibration', 'validation', 'test'].map(split => [split, output.filter(item => item.split === split).length]));
await mkdir(new URL('../datasets/', import.meta.url), { recursive: true });
await writeFile(new URL('../datasets/feedback-calibration-100-v2.jsonl', import.meta.url), output.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log(JSON.stringify({ rows: output.length, splits: splitCounts, main_topic: counts('main_topic'), sentiment: counts('sentiment'), refund_requested: counts('refund_requested'), expressed_churn_intent: counts('expressed_churn_intent'), expressed_frustration: counts('expressed_frustration') }, null, 2));
