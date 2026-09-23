# urJev V2 下一輪優化路線圖

記錄日期：2026-09-23

## 目前基準

情緒已由五類改為 positive、negative、mixed、neutral 四類，unclear 併入 neutral。

| 資料 | OneForward 整體 | Sentiment | p50 |
|---|---:|---:|---:|
| 100 筆合成校準資料 | 78.4% | 64.0% | 120 ms |
| 40 筆獨立合成資料 | 90.5% | 82.5% | 115 ms |

兩份資料差距很大，所以下一輪不能用單一合成資料的最高數字當成果。feedback-calibration-100-v2 與 feedback-holdout-40-v2 的結果都已查看，後續只能作 regression set，不能再作未見 test。

## 優化優先順序

### P0：建立新的真實標註資料

- 蒐集至少 300 筆去識別化真實回饋；若暫時沒有真實資料，改由兩位人工獨立撰寫與標註。
- positive、negative、mixed、neutral 各至少 60 筆。
- 額外收錄至少 50 筆邊界案例：正面評價加退款、正面評價加不續訂、禮貌抱怨、條件式離開、只有事實但問題嚴重。
- 兩位標註者意見不同的資料先仲裁，不直接拿來訓練。
- 新資料固定切成 train／validation／test；test 在方法鎖定前不得查看。

### P1：改善 sentiment 的 mixed 邊界

目前最明顯的錯誤是 positive 容易被 mixed 吸收，部分 negative 也會被 mixed 吸收。下一輪要明確區分：

- 行為意圖不是情緒：退款、取消、不續訂本身不構成 negative。
- 功能請求不是不滿：『很好，希望新增功能』仍是 positive。
- mixed 必須同時出現明確肯定與明確不滿，不能只因為有「但」或兩個不同事件就判 mixed。

先比較三種方案：

1. 維持 Qwen3-4B OneForward，只用新 training split 擬合小型分類頭或 LoRA。
2. sentiment 單獨換較強模型，其他四題維持 4B OneForward。
3. 使用專用四分類 encoder，保留目前 API answer 格式。

不要再用增加長 prompt 作主要方案；先前實驗已讓 validation 從 78% 降到 71%。

### P2：改善 main_topic 的 other

other 在兩份資料都不穩定。需要加入：

- 沒有 technical／content／pricing／service 直接證據的案例。
- 同時包含兩個主題但只有一個是主要訴求的案例。
- 帳號、發票、通知、登入與一般平台操作等 other 子類型。

可評估「先判斷是否屬於四個具體類別，再選類別」的兩階段分類，但必須以新 validation 驗證，不能根據舊 holdout 選方法。

### P3：穩定 frustration

frustration 在 100 筆資料為 59%，40 筆資料為 90%，顯示目前模板難度與等級比例差異過大。新資料需平衡 0／1／2／3，並特別加入：

- 單次嚴重故障但沒有強烈措辭。
- 反覆發生但語氣平靜。
- 強烈用語但沒有重複處理歷史。
- 退款或離開意圖存在，但沒有不滿措辭。

評估時除 argmax accuracy，也需回報相差一級與相差兩級以上的錯誤；score 是有順序的類別，不能只看一般分類準確率。

### P4：保留 noul，不優先改動

refund_requested 已達 100%，expressed_churn_intent 約 93–97.5%。目前不修改 noul 類型、40%／60% 顯示門檻或輸出格式。只有真實資料顯示 false positive 集中時，才單獨調整 churn。

## 校準與上線條件

- Temperature scaling 只能調整機率可信度，不能提升 argmax accuracy。
- 校準 profile 必須綁定模型、prompt、Problem schema 與資料版本。
- 建議下一版最低門檻：新 test 整體 ≥ 85%、sentiment ≥ 80%、refund ≥ 98%、churn ≥ 95%，OneForward p50 ≤ 150 ms。
- 若 sentiment 使用較強模型，端到端 p50 目標可放寬至 500 ms，但必須明確標示為準確優先模式。
- 未達門檻時維持 experimental 與 calibrated: false。

## 下次開始時的執行順序

1. 鎖定 V2 四分類 Problem，不再修改已評估資料。
2. 建立新的人工標註資料與未見 test。
3. 先跑目前 OneForward 作基準。
4. 只在 train／validation 比較 LoRA、較強模型與專用分類器。
5. 方法鎖定後只執行一次 test。
6. 記錄 accuracy、macro F1、每類 confusion matrix、NLL、Brier、ECE、p50／p95 與輸出 tokens。
