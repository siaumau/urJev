# OneForward Jev-style 實驗

日期：2026-09-23

## 目的

原本的 `/v1/systemone` 讓五題並行，但每題仍要逐 token 生成完整權重 JSON。OneForward 路徑保留相同 State、Problem 與 typed answer 格式，把每題改為一次候選決策，減少自回歸解碼。

## 做法

1. 驗證 State、Problem 與每題 criteria。
2. 使用 vLLM tokenizer 檢查答案 key。可安全表示為唯一單 token 時直接使用語意 key；其餘選項使用 A–J。
3. 將候選限制交給 vLLM `structured_outputs.choice`，設定 `max_tokens: 1`、`logprobs: true`。
4. 從候選 token logprobs 做限定 softmax，再映射回原始 key。
5. Choice 取 argmax；Noul 回傳 P(true)；Score 計算等級期望值。

這些機率是候選標籤下一 token 的相對分布，尚未經溫度縮放或資料集校準。Tokenizer 可能用另一組 token 片段拼出同一個字；目前只比較完整的首 token 標籤，不計算整條候選序列的總機率。API 因此維持 `confidence: null`，並在 `meta` 標記 `calibrated: false` 與 `experimental: true`。

## 實測

硬體與服務：Intel Arc Pro B70、WSL、Qwen3-4B-Instruct-2507 BF16、vLLM XPU。

| 項目 | 結果 |
|---|---:|
| 單筆五題產生式基準（暖機） | 665 ms、94 輸出 tokens |
| 單筆五題 OneForward（暖機） | 127–167 ms、5 輸出 tokens |
| 24 筆 OneForward p50／p95 | 117／176 ms |
| 24 筆 OneForward範圍 | 67–198 ms |
| 情緒／退款／續訂檢查 | 72／72 |
| 程式測試 | 30／30 |

第一次遇到新提示形狀可能包含 XPU JIT 或 graph 暖機，不能用冷啟動時間代表穩態延遲。這 24 筆是小型 smoke set，其中主集合的邊界規則用於提示調整；另外八筆 holdout 在最後一條泛化規則加入後也全部通過。它不是生產資料的統計準確率證明。

## 與 Jev 的界線

目前能對齊的公開概念是 State＋typed questions、封閉候選、無自由文字、直接取得決策分布，以及多題批次推論。Jev 的專有 backbone、平行 sampler、RLCD 訓練資料與 loss、confidence 校準公式沒有公開，因此 urJev 不宣稱是 Jev 複製品。

## 重跑

```powershell
npm run model:vllm
npm run evaluate:oneforward
node scripts/evaluate-accuracy.js oneforward-holdout --oneforward --holdout
npm test
```

實際使用：

```text
POST /v1/systemone/oneforward
Content-Type: application/json
```

Body 與 `/v1/systemone` 相同。需要回歸比較時，Playground 可切換「產生式基準」。
