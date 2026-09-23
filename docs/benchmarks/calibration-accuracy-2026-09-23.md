# 100 筆合成資料準確率與機率校準基準

日期：2026-09-23

## 測試方法

- 模型：Qwen3-4B-Instruct-2507 BF16
- 推論：vLLM XPU，Intel Arc Pro B70，暖機服務
- 資料：`datasets/feedback-calibration-100.jsonl`
- 規模：100 筆 State，每筆 5 題，合計 500 個標註判斷
- 方法：比較 OneForward 與產生式基準；兩者使用相同模型、State 和 Problem
- 準確率：以各題機率最高的選項 argmax 對比 expected answer
- 機率校準：在 60 筆 calibration split 分欄擬合 temperature，再檢查 20 筆 validation 與 20 筆 test

## 準確率與速度

| 指標 | OneForward | 產生式基準 |
|---|---:|---:|
| 整體準確率 | 381 / 500（76.2%） | 400 / 500（80.0%） |
| calibration split | 75.0% | 79.0% |
| validation split | 78.0% | 82.0% |
| test split | 78.0% | 81.0% |
| main topic | 76.0% | 65.0% |
| sentiment | 53.0% | 68.0% |
| refund requested | 100.0% | 100.0% |
| churn intent | 93.0% | 99.0% |
| frustration | 59.0% | 68.0% |
| 延遲 p50 | 123 ms | 490 ms |
| 延遲 p95 | 167 ms | 572 ms |
| 平均延遲 | 130.1 ms | 505.5 ms |
| 100 筆總輸出 tokens | 500 | 9,330 |

OneForward 在這次測試的整體準確率低 3.8 個百分點，p50 約快 3.98 倍，p95 約快 3.43 倍，輸出 token 減少 18.66 倍。主題分類優於產生式基準，但情緒與不滿程度是主要弱點。其中同時出現「正面評價＋退費或不續訂」的邊界案例，OneForward 容易過度判為 mixed。

`sentiment=unclear` 的 10 筆資料在兩種方法都被判為 neutral，這也顯示合成資料中 unclear 與 neutral 的界線需要再由人工審查。

## Temperature scaling

Temperature scaling 不改變 argmax，所以不會提高這次的準確率；它調整的是機率數值是否過度自信。

| test split | Accuracy | NLL 校準前 → 後 | Brier 校準前 → 後 | ECE 校準前 → 後 |
|---|---:|---:|---:|---:|
| OneForward | 78.0% → 78.0% | 3.5007 → 0.5878 | 0.4282 → 0.3024 | 0.2029 → 0.0817 |
| 產生式基準 | 81.0% → 81.0% | 5.9249 → 0.6703 | 0.3548 → 0.3245 | 0.1625 → 0.0478 |

OneForward 分欄 temperature：

| 欄位 | T |
|---|---:|
| main_topic | 10.6148 |
| sentiment | 12.2523 |
| refund_requested | 0.2994 |
| expressed_churn_intent | 5.7816 |
| expressed_frustration | 13.8529 |

多個 temperature 大於 10，表示 raw token 機率對錯誤預測過度自信。校準後 NLL、Brier 和整體 ECE 都改善，但這些參數目前只來自小型合成資料，尚未載入公開 API。

## 結論與使用界線

OneForward 已驗證能大幅降低延遲與輸出量，但這份資料上還不能在每個欄位維持產生式基準的準確率。下一步應優先改善 sentiment 與 frustration 的標註定義、prompt 或專用分類訓練，再使用新的未見資料評估。

這 100 筆是模板生成的開發資料，每個 split 的題數也小。由於本次已查看 test 結果，未來若依此調整系統，必須新建 holdout，不能再把這 20 筆 test 當成完全未見資料。

## 重跑

```powershell
npm run evaluate:calibration-data
npm run calibrate:report
```

第一個指令會實際執行 1,000 次題目推論（500 個 OneForward＋500 個產生式），並寫入本機 `reports/calibration-dataset-evaluation.json`。第二個指令擬合 temperature 並把校準結果加入同一份報告。
