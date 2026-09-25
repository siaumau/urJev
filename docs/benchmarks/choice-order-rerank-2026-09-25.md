# choice 選項順序重排實驗

記錄日期：2026-09-25  
模型：Qwen/Qwen3-8B，BF16，vLLM XPU  
資料：`feedback-calibration-100-v2`，共 100 筆、500 個欄位判斷

## LoRA 狀態

目前沒有訓練或載入 LoRA。專案中沒有 PEFT 設定、adapter 權重或 LoRA checkpoint；現行方法是基礎 Qwen3-8B、OneForward 單 token 候選分數、情緒拆題、規則與本次的 choice 順序集成。LoRA 仍是 V2 路線圖中的候選方案，不能把這次提升歸因於微調。

## 測試問題

測試兩種對「分數接近時顛倒排序」的解讀：

1. 原分數的第一、二名接近時，直接改選第二名。
2. 保留標籤與定義的對應，只把 prompt 中候選項目的呈現順序反轉，再推論一次；將兩次同一語意選項的分數各以 50% 加權平均。

資料原有的 60／20／20 calibration、validation、test 切分保持不變。參數搜尋只看 calibration；validation 作是否採用的門檻，test 不參與參數選擇。這 100 筆資料過去已用於開發，因此結果只能視為 regression evidence，仍需新的未見人工資料確認。

## 結果

### 直接顛倒前兩名

OneForward 分數非常尖銳。500 個判斷中，top-1 與 top-2 分差不超過 0.05 的只有 1 個，不超過 0.20 的只有 4 個；這 4 個原本已有 3 個答對。強制改選第二名沒有提升：validation 維持 77% 或下降，test 由 74% 最差降至 71%。因此沒有採用。

### 反向候選順序後加權

| 策略 | Calibration | Validation | Test | 全部 |
|---|---:|---:|---:|---:|
| 原始 OneForward | 233/300（77.7%） | 77/100（77.0%） | 74/100（74.0%） | 384/500（76.8%） |
| 所有題型均做 50/50 集成 | 233/300（77.7%） | 70/100（70.0%） | 73/100（73.0%） | 376/500（75.2%） |
| 只對 choice 做 50/50 集成 | 235/300（78.3%） | 77/100（77.0%） | 76/100（76.0%） | 388/500（77.6%） |

只對 choice 集成共改變 10 個答案：5 個由錯變對、1 個由對變錯、4 個由一個錯誤答案改成另一個錯誤答案。整體增加 4/500，為 **+0.8 個百分點**；test 增加 2/100，為 **+2 個百分點**。這個幅度有幫助，但樣本量不足以證明在真實郵件或其他 Problem 上也會提升。

分欄觀察：

| 欄位 | 原始 | 50/50 順序集成 | 差異 |
|---|---:|---:|---:|
| main_topic | 68% | 71% | +3 pp |
| sentiment | 52% | 53% | +1 pp |
| refund_requested | 98% | 97% | -1 pp |
| expressed_churn_intent | 100% | 100% | 0 pp |
| expressed_frustration | 66% | 55% | -11 pp |

因此正式修正只套用在 `choice`，不套用 `noul` 或有順序的 `score`。目前 Qwen3-8B 的 sentiment 自動拆題路徑仍依原邏輯執行；若改成 direct，才會使用 choice 順序集成。

## 延遲成本

使用 validation＋test 共 40 筆做配對暖機實測，採目前正式設定（8B sentiment 自動拆成兩個是非判斷），每筆維持並行：

| 方法 | 正確 | Mean | p50 | p95 |
|---|---:|---:|---:|---:|
| 原始 | 169/200（84.5%） | 155.7 ms | 152 ms | 200 ms |
| choice 順序集成 | 170/200（85.0%） | 160.0 ms | 159 ms | 196 ms |
| 差異 | +1/200（+0.5 pp） | +4.3 ms | +7 ms | -4 ms（量測波動） |

反向請求與原本五題一起送入最多八路的 vLLM 批次，因此不是把兩次延遲直接相加。代價是每個 direct choice 多一次模型請求與輸入 token；目前正式設定會從 6 個請求增加到 7 個，仍在八路上限內。若停用 sentiment 拆題，五題範例會由 5 個增加到 7 個。更多 choice 題會分批，延遲成本可能更高。

## 使用與重現

預設啟用。若需 A/B 比較，在 `.env` 設定後重啟 15413 API：

```dotenv
CHOICE_ORDER_ENSEMBLE=off
```

重新跑 100 筆反向順序實驗：

```powershell
npm run model:vllm
npm run evaluate:choice-order
```

完整逐題原始輸出寫到被 `.gitignore` 排除的 `reports/reversed-option-order-rerank-100.json`，避免把大型實驗檔納入版本庫。正式採用前仍應用新的人工標註郵件資料鎖定 train／validation／test，再量 accuracy、macro F1 與校準誤差。
