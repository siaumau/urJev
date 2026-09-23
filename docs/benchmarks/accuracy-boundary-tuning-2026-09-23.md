# 分類邊界調整與獨立 Holdout

日期：2026-09-23

## 嘗試過的方案

這輪針對 other、neutral／unclear、退款／流失意圖與情緒分離，以及 frustration 等級加入更長的文字規則。既有 validation 的 OneForward 準確率由 78% 降到 71%，因此完整撤回；小模型在單 token 決策前加入更多相鄰概念，反而增加干擾。

接著嘗試按題型固定路由：主題與 noul 使用 OneForward，情緒與 frustration 使用產生式。validation 達 85%，但新的 40 筆 holdout 只有 81%，低於同資料 OneForward 的 84% 與產生式的 84.5%。這表示「哪條路徑擅長哪一欄」會隨資料分布改變，固定路由已過度擬合，因此也沒有保留。

## 保留的修正

Qwen tokenizer 會把 unclear 拆成多個 token。先前 OneForward 只能把它替換為無語意的 A；現在優先使用單 token 且語意接近的 unknown，找不到合適別名時才退回 A–J。

| 資料 | 修正前 | 修正後 |
|---|---:|---:|
| 既有 validation（100 個判斷） | 78.0% | 79.0% |
| 既有 100 筆整體（500 個判斷） | 76.2% | 76.4% |
| 既有整體 NLL | 3.9407 | 3.5379 |
| 既有整體 p50 | 123 ms | 115 ms |

改善幅度小，但方向一致，而且沒有犧牲延遲。unclear 案例仍全部被判成 neutral，表示語意別名只能降低 token 標籤偏差，無法解決類別本身高度重疊的問題。

## 新 Holdout 結果

新增 datasets/feedback-holdout-40.jsonl，包含 40 筆獨立撰寫案例與 200 個答案。OneForward 第一次評估結果：

| 指標 | 結果 |
|---|---:|
| 整體 | 177 / 200（88.5%） |
| main topic | 82.5% |
| sentiment | 72.5% |
| refund requested | 100.0% |
| churn intent | 97.5% |
| frustration | 90.0% |
| 延遲 p50 / p95 | 119 / 168 ms |

同一批資料的產生式基準為 84.5%。這不表示 OneForward 已固定達到 88.5%；既有 100 筆仍只有 76.4%，兩份合成資料的句型、類別比例與難度不同，正好證明準確率高度依賴資料分布。

這 40 筆結果已被查看，因此從現在起屬於 exposed test set。未來若依這份錯誤案例調整模型，必須再建立新的 holdout 才能衡量泛化能力。

## 結論

- noul 不是主要瓶頸。
- unclear 與 neutral 若不需要不同處置，合併兩類會比要求 4B 模型硬分更可靠。
- other 需要「沒有任何具體類別證據」的拒答能力。
- 情緒與 frustration 若要穩定提升，需要人工標註的真實案例、少量微調或專用分類器，不能再依靠增加 prompt 長度。

重跑命令：

~~~powershell
npm run dataset:holdout
npm run evaluate:calibration-data -- --dataset=datasets/feedback-holdout-40.jsonl --oneforward-only
~~~
