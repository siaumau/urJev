# 300–400 ms 挑戰：接近目標，但未採用

2026-09-22。先將上一版編譯 RMSNorm、FlashAttention、平面具名權重保存為 `10d3823` 並推送。這輪只新增實驗腳本，Playground 保留該版本。

## 方法與數據

沿用 Qwen3-4B-Instruct-2507 BF16、Intel Arc Pro B70、WSL vLLM 與相同五題。新舊請求在同一服務交錯執行，每組兩輪暖機、十輪計時。時間為 `systemOne` 的推論流程耗時，不包含瀏覽器往返與前置 schema 準備，不是完整使用者等待時間。未使用答案快取；沿用服務的 prefix cache。

| 實驗 | 同組具名基準中位數 | 候選中位數 | 候選範圍 | 低於 400 ms |
|---|---:|---:|---:|---:|
| 固定順序數字陣列 | 542.5 ms | 453 ms | 404–540 ms | 0/10 |
| 整數陣列 JSON Schema | 544.5 ms | 454 ms | 327–505 ms | 2/10 |
| 整數陣列＋無空白 regex 約束 | 537.5 ms | 400.5 ms | 352–442 ms | 5/10 |

候選將具名選項的權重改為固定順序陣列，並在收到結果後對應回原選項。最後一組透過 vLLM `structured_outputs.regex` 強制 0–100 整數、固定陣列長度與無空白格式，仍以 Ajv 驗證後才採用。五題總輸出從 95 降至 59 tokens。API 用法參考 [vLLM 官方結構化輸出說明](https://github.com/vllm-project/vllm/blob/main/docs/features/structured_outputs.md)。

## 未採用的原因

六筆額外案例各檢查情緒、退款與停止續訂意圖，共 18 項。具名基準與一般數字陣列均為 17/18；整數陣列及 regex 整數陣列均為 16/18。額外退步案例是「月費太貴，我決定不續訂，但不需要退款。」：候選的停止續訂權重未達既定 0.6 門檻，判斷為否。混合情緒仍誤判，且基準偏 negative、陣列偏 positive。

因此不能宣稱維持相同品質，也未達穩定 300–400 ms。單次 327 ms 或 352 ms 不能代表一般請求表現。本輪沒有將實驗格式接入正式服務，也沒有改模型、量化權重或改變使用者的 State／Problem。

## 重現

先啟動目前模型服務，避免同時執行其他推論負載：

```sh
node scripts/experiment-array-weights.js
node scripts/experiment-array-weights.js --integer
node scripts/experiment-array-weights.js --integer --regex
```

各命令包含速度與六筆語意案例比較，會覆寫 `reports/` 中對應報告。本次原始數據位於 [benchmarks/400ms](benchmarks/400ms)。小型案例不代表完整品質評估；下一步應先改善陣列位置語意與否定句判斷，通過更多案例後才考慮替換正式版本。
