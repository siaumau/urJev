# 校準資料集

`feedback-calibration-100-v2.jsonl` 是目前預設的可重現合成資料集，用來建立 urJev OneForward 的機率校準流程。v2 將 unclear 併入 neutral，情緒為 positive、negative、mixed、neutral 四類。`feedback-calibration-100.jsonl` 保留為五分類歷史版本。每行是一筆完整 JSON，包含：

- `state`：一則模擬客服回饋。
- `problem`：五個固定問題，包含 main topic、sentiment、refund、churn 與 frustration。
- `expected`：上述五題的標註答案。
- `split`：`calibration`、`validation` 或 `test`。
- `source` 與 `seed`：標示資料是合成資料及其固定亂數種子。

## 分割

| Split | 筆數 | 用途 |
|---|---:|---|
| calibration | 60 | 擬合 temperature 等校準參數 |
| validation | 20 | 選擇校準方法、檢查規則與門檻 |
| test | 20 | 方法確定後只做最終評估 |

五題合計有 500 個標註值。v2 涵蓋五種主題、四種情緒、退款與續訂正反例，以及四個 frustration 等級。

## 獨立 Holdout

feedback-holdout-40-v2.jsonl 是第二批獨立撰寫的 40 筆四分類案例，共 200 個答案，用來檢查調整是否只適用於原本的模板資料。feedback-holdout-40.jsonl 保留為五分類歷史版本。

~~~powershell
npm run dataset:holdout
~~~

v2 SHA-256：43791D5DFE81F2060C704D0FB686E605CB62BE72722D3FB61F8D7A2127FF3E06。這批資料已完成評估並查看結果，後續不能再視為完全未見資料。四分類結果見[情緒四分類 v2](../docs/benchmarks/sentiment-four-class-v2.md)。

## 重新產生

```powershell
npm run dataset:calibration
```

產生器使用固定 seed `20260923`。相同程式版本會產生相同內容，適合版本控制與重跑測試。

v2 SHA-256：`82429586CD89878D132CC21D555FE774822B1B21321B4DE27FBD6FBFC5C78CF1`。五分類 v1 SHA-256：`253DB2D0AEA8A7A21F1D2D351D7A2FBDF52F4B3A658B439AD9F775E72850D75B`。

## 執行準確率與校準測試

```powershell
npm run evaluate:calibration-data
npm run calibrate:report
```

只測試特定 split 或資料檔：

~~~powershell
npm run evaluate:calibration-data -- --split=validation --oneforward-only
npm run evaluate:calibration-data -- --dataset=datasets/feedback-holdout-40-v2.jsonl --oneforward-only
~~~

評估會分別跑 OneForward 與產生式基準，需要本機 vLLM 服務已啟動。v2 完整結果寫入本機 `reports/feedback-calibration-100-v2-evaluation.json`；摘要收錄在[情緒四分類 v2](../docs/benchmarks/sentiment-four-class-v2.md)。

## 限制

這些文字由規則與模板合成，標籤也由產生規則決定。它們可用來打通 raw logits、temperature fitting、profile 載入及指標計算，但不能代表真實使用者分布，也不能單獨證明 production calibration。

部分案例刻意將正面評價與退款／停止續訂意圖放在一起，用來確認模型不會把行為意圖直接當成情緒。這類組合雖較少見，仍屬有效的邊界案例。

在正式使用前，應加入真實匿名資料或由人工獨立撰寫與標註的資料。不要使用 test split 調整 prompt、修改規則、選擇方法或估計 temperature；一旦這樣使用，該 split 就不再是未見測試資料。
