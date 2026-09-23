# urJev OneForward 調整與機率校準計畫

日期：2026-09-23

## 本次已完成的調整

urJev 新增 `/v1/systemone/oneforward`。它保留 State、Problem 與 `choice`／`noul`／`score` 的 public answer 格式，每題改為一個受限候選 token，從 vLLM 取得候選 logprobs 後做 softmax。Playground 預設使用 OneForward，仍可切回產生式基準。

暖機實測由產生式基準的 665 ms／94 輸出 tokens，降為 OneForward 約 127–167 ms／5 輸出 tokens。24 筆既有 smoke cases 共 72 個判定符合預期。這些結果記錄速度與小型語意檢查，不代表機率已校準。

目前回傳值仍標記：

```json
{
  "probability_method": "conditional_label_token_logits",
  "calibrated": false,
  "confidence_method": "unavailable"
}
```

## 新增校準資料

新增 `datasets/feedback-calibration-100.jsonl`，包含 100 筆 State、相同版本的完整 Problem，以及每題 expected answer。使用固定 seed 產生，分成：

- calibration：60 筆
- validation：20 筆
- test：20 筆

資料分布：main topic 為 content 18、pricing 18、service 18、technical 18、other 28；sentiment 為 positive 25、negative 25、mixed 20、neutral 20、unclear 10；refund true 21；churn true 19；frustration 0／1／2／3 分別為 55／20／20／5。

產生器重跑後 SHA-256 保持 `253DB2D0AEA8A7A21F1D2D351D7A2FBDF52F4B3A658B439AD9F775E72850D75B`，31 項程式測試全部通過，其中資料集測試會檢查筆數、ID、文字唯一性、split、Problem 格式與標籤範圍。

## 下一階段實作

1. 在 OneForward 內部保留每個候選的 raw logprob，不把它放入一般公開 API。
2. 用 calibration split 最小化 negative log-likelihood，擬合 `T > 0`：`softmax(logits / T)`。
3. 用 validation split比較未校準與校準後的 NLL、Brier score、ECE、可靠度曲線及 accuracy。
4. 鎖定模型、prompt、Problem 與校準方法後，才在 test split 做一次最終評估。
5. 將 profile 綁定 model、prompt version、Problem hash 與資料版本。任一項改變時停用舊 profile。
6. 校準通過後才把 API 改為 `calibrated: true`；`confidence` 的定義需另外驗證，不直接等同最高類別機率。

Temperature scaling 是第一版首選，只有一個參數，對延遲幾乎沒有影響，而且不改變 multiclass logits 的排序。若未來有超過約 1,000 筆獨立標註資料，再比較 Platt、isotonic 或 Dirichlet calibration。

## 資料使用界線

這 100 筆是合成資料，只適合開發校準管線與初步檢查。由於模板規則與實際流量不同，使用它算出的 ECE 或 temperature 不能直接宣稱適用於真實客戶資料。

目前 24 筆速度／語意案例已參與 OneForward prompt 調整，不能再當成獨立 calibration test。正式上線前應另外建立未參與提示設計的人工資料，並保留不調參的最終 test split。
