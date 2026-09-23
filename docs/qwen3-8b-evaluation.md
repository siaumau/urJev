# Qwen3-8B 在 Intel Arc Pro B70 的實測

## 結論

Qwen3-8B BF16 可以在 Intel Arc Pro B70 32 GB 與 WSL 的現有 vLLM 環境正常載入。vLLM 顯示模型約占 15.27 GiB，並配置 2 GiB KV cache，測試過程沒有發生顯存不足。

它目前不取代 Qwen3-4B-Instruct-2507。相同資料與 OneForward 設定下，8B 的整體準確率為 76.8%，低於 4B 的 78.2%，延遲則增加約 14 ms。這表示目前的主要準確度瓶頸在任務定義、選項邊界、提示與模型對齊，不只是模型參數量。

## 測試條件

- 資料：`datasets/feedback-calibration-100-v2.jsonl`
- 樣本：100 筆回饋
- 判斷：每筆 5 個欄位，共 500 個判斷
- 推論：OneForward，BF16，2 GiB KV cache，`max_num_seqs=8`
- 硬體：Intel Arc Pro B70 32 GB
- 執行環境：WSL、vLLM XPU
- Qwen3-8B：停用 thinking mode

## 結果

| 指標 | Qwen3-4B-Instruct-2507 | Qwen3-8B |
| --- | ---: | ---: |
| 整體準確率 | **78.2%** | 76.8% |
| 平均延遲 | **112.38 ms** | 126.69 ms |
| P50 | **107 ms** | 125 ms |
| P95 | **136 ms** | 148 ms |
| main_topic | **76%** | 68% |
| sentiment | **64%** | 52% |
| refund_requested | **100%** | 98% |
| expressed_churn_intent | 92% | **100%** |
| expressed_frustration | 59% | **66%** |

原始報告：

- [`benchmarks/accuracy/qwen3-4b-bf16-100-before-8b.json`](benchmarks/accuracy/qwen3-4b-bf16-100-before-8b.json)
- [`benchmarks/accuracy/qwen3-8b-bf16-100-oneforward.json`](benchmarks/accuracy/qwen3-8b-bf16-100-oneforward.json)

## 為何 8B 沒有直接提升準確率

Qwen3-8B 是原始 Qwen3 模型，預設會先產生 thinking 內容；OneForward 則要求第一個輸出 Token 直接落在答案候選中。若不關閉 thinking mode，兩種行為會互相衝突，測試輸出會大量落到預設值。本專案已在 vLLM 請求加入 `chat_template_kwargs.enable_thinking=false`。

停用 thinking 後，8B 恢復正常判斷，但它對目前中文分類規則的對齊仍沒有超過 4B Instruct 版本。尤其情緒欄位容易把 positive 判成 mixed、把 negative 判成 mixed；這類錯誤更適合透過 V2 資料、定義合併、少量微調或校準處理。

8B 的 generated 模式也曾在第一筆資料回傳全為零的挫折程度分布，因此目前只保留為可切換的實驗模型，不作為正式預設。

## 切換方式

8B 權重已下載後，選擇模型並重啟模型與 urJev 服務：

```powershell
npm run model:select:8b
npm run model:vllm
```

切回目前預設的 4B：

```powershell
npm run model:select:4b
npm run model:vllm
```

切換前先在正在執行模型與 urJev 的兩個終端按 `Ctrl+C`。模型名稱會顯示在 `/benchmark` 左側 urJev 卡片中，匯出的 JSON 也會保留當次模型名稱。
