# 情緒四分類 v2

日期：2026-09-23

## 調整

情緒由五類改為四類：

- positive：明確肯定或滿意，沒有明確不滿
- negative：明確不滿或批評，沒有明確肯定
- mixed：同時包含明確肯定與不滿
- neutral：沒有明確正負評價，包括事實陳述、詢問或資訊不足

原本的 unclear 併入 neutral。原因是兩者都代表「沒有可用的正負情緒」，但 Qwen3-4B 無法穩定區分「完整但沒有情緒」與「資訊不足所以無法判斷」。如果產品未來需要知道資料是否足以作答，應新增獨立的 answerable／insufficient_information 題目，不應把它混在情緒類別裡。

v1 資料保留作歷史重現；v2 使用新的檔名，不覆蓋舊資料。

## 100 筆校準資料

| 指標 | v1 五分類 | v2 四分類 |
|---|---:|---:|
| OneForward 整體 | 76.4% | 78.4% |
| OneForward sentiment | 54.0% | 64.0% |
| OneForward p50 | 115 ms | 120 ms |
| 產生式整體 | 80.0% | 80.2% |
| 產生式 sentiment | 68.0% | 69.0% |

OneForward 多答對 10 個原本 unclear、實際預測為 neutral 的案例；其他欄位沒有因此改標。四分類將整體提升 2 個百分點，情緒提升 10 個百分點。

## 40 筆獨立資料

| 指標 | v1 五分類 | v2 四分類 |
|---|---:|---:|
| OneForward 整體 | 88.5% | 90.5% |
| OneForward sentiment | 72.5% | 82.5% |
| OneForward p50 | 119 ms | 115 ms |
| 產生式整體 | 84.5% | 87.0% |
| 產生式 sentiment | 70.0% | 82.5% |

## v2 機率校準

在 60 筆 calibration split 擬合 temperature 後，OneForward test split 的 accuracy 維持 79%，NLL 由 3.0951 降到 0.5542，10-bin ECE 由 0.2010 降到 0.0504。這些參數仍只來自合成資料，沒有載入公開 API。

## 結論

四分類比五分類更符合目前的模型能力與業務輸出。它不會讓模型更懂情緒，而是移除沒有穩定決策價值、且無法可靠標註的邊界。主要剩餘錯誤是 positive 容易被判成 mixed，以及部分 negative 被 mixed 吸收；下一階段需要真實人工資料，不再新增更多近義類別。
