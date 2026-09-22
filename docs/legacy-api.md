# 舊分類／擷取 API

目前 [Playground](../README.md) 使用 State／Problem；本頁的分類與 JSON 擷取仍保留為 `POST /api/decide`，不在現行首頁顯示。它們會使用 `.env` 選定的後端，也可以由 vLLM 執行。

## 分類

```javascript
const response = await fetch('http://127.0.0.1:3210/api/decide', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'classify',
    text: '我想知道包裹什麼時候到',
    labels: ['退款申請', '物流查詢', '產品問題'],
    instructions: '依照使用者的主要需求分類。',
    examples: [{ text: '我要退錢', output: { label: '退款申請' } }]
  })
});
console.log(await response.json());
```

回應包含 `result.label` 與 `meta`。模型可以輸出 `__unknown__` 表示資訊不足或不屬於任何分類，但不保證拒判一定正確。few-shot 範例最多 8 筆，只是提示示範，不是訓練權重。

## JSON 擷取

```json
{
  "mode": "extract",
  "text": "我要三個保溫杯",
  "schema": {
    "type": "object",
    "properties": {
      "product": { "type": ["string", "null"] },
      "quantity": { "type": ["integer", "null"] }
    },
    "required": ["product", "quantity"],
    "additionalProperties": false
  }
}
```

最外層必須是 object，所有欄位必填；可能缺值時允許 null。支援 `type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`description`，不支援任意 `$ref`、正規表示式或日期 format。結果需通過 Ajv 驗證。

## 原有分類評測

```powershell
npm run evaluate
node scripts/evaluate.js my-eval.jsonl my-classification-task.json
```

需先啟動應用與模型服務。JSONL 每列為 `{ "text": "...", "expected": "分類" }`，任務 JSON 使用上述 `mode: classify` 結構；**不能直接使用目前 Playground 匯出的 State／Problem 設定。**

預設 8 筆為小型 smoke test，不是正式準確率。結果包含逐筆答案、準確率與 p50／p95，寫入 `reports/evaluation.json`。這些 API 與 State／Problem 共用 HTTP 忙碌鎖、請求大小限制及錯誤處理，詳見主 README。
