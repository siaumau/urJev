# Qwen3-8B 情緒準確度修正

日期：2026-09-23。此版本已套用到本機 15413 與 15414；模型為 Qwen/Qwen3-8B，vLLM 在 18000。

## 實測結果

| 資料與指標 | 原單標籤方式 | 正負分開判斷 |
| --- | ---: | ---: |
| 100 筆 v2：情緒 | 52/100（52%） | 85/100（85%） |
| 100 筆 v2：全部五題 | 384/500（76.8%） | 416/500（83.2%） |
| 40 筆 v2：情緒 | 32/40（80%） | 36/40（90%） |
| 40 筆 v2：全部五題 | 178/200（89%） | 182/200（91%） |
| 新增 32 筆挑戰案例：情緒 | 22/32（68.75%） | 30/32（93.75%） |

100 筆新方案五題平均評估耗時 143.12 ms、P50 138 ms、P95 178 ms；40 筆新方案平均 141.10 ms。這是評估函式的計時範圍，並非外網瀏覽器等待時間。另以實際 15414 HTTP API 跑 32 筆挑戰案例，每筆送全部五題、只核對有標註的情緒，仍答對 30/32；平均 server_ms 126.82 ms、Node 用戶端來回 129.21 ms，包含該次暖機影響。不同輸入與快取狀態不能用平均時間直接互推。

100 筆的原方案取自前次已保存的 8B BF16 報告；40 筆 v2 在本輪依序重跑原方式與新方式。批次組成與浮點運算可能使少量邊界案例變動：100 筆的新方案除了情緒以外，主題 68→67、流失意圖 100→99、不滿程度 66→67；這三欄的提示與分類邏輯均未改動。整體改善不能宣稱每筆、每欄都零退步。

## 調查與研究依據

前輪已測試停用思考、平衡提示、字母標籤、自由答案與 Intel 保守設定。保守設定仍為 52% 情緒準確率，100 筆預測有 99 筆與最佳化設定相同，沒有證據支持硬體加速是主要問題。只放寬答案生成長度沒有改善；要求先列證據可到 73%，但單題平均約 785 ms。

本輪參考兩項研究：

- [Calibrate Before Use（ICML 2021）](https://arxiv.org/abs/2102.09690)：提示格式、範例順序及答案偏好會影響分類表現。這支持檢查標籤偏向，但本次沒有套用論文的 contextual calibration，也沒有調整信心閾值。
- [Decomposed Prompting（ICLR 2023）](https://arxiv.org/abs/2210.02406)：把複雜任務拆成較簡單子問題，能在其研究任務改善表現。這是本次設計的參考，並非論文已驗證 Qwen3 或本專案。

100 筆開發資料上的消融結果：原方式 52%、獨立逐選項核對 62%、正負兩問但仍含完整原分類定義 75%、刪除原分類定義而不提供示範 55%、加入六組完整 user/assistant 示範後 85%。因此提升來自本次子問題與示範的組合，不能宣稱單靠模型變大或單靠拆題必然改善。

可觀察的錯誤模式是把退款、取消、希望改善等行為推論為不滿，或把禮貌性謝謝當成肯定；也會忽略同一段中較弱的另一種評價。本次示範教的是同時有正負時兩問都成立，以及沒有明確評價的行為不等於情緒。它仍由模型判斷語意，不是用退款關鍵字直接硬編答案。

## 新方法及適用範圍

兩個子問題並行執行，各輸出一個 true/false Token：

| 有明確肯定 | 有明確不滿 | 結果 |
| --- | --- | --- |
| 是 | 否 | positive |
| 否 | 是 | negative |
| 是 | 是 | mixed |
| 否 | 否 | neutral |

預設只在 Qwen3-8B、OneForward 端點、且指令與四個類別定義完全符合內建回饋範例時啟用。欄位 ID 與 criteria 排列順序可不同；自訂定義、額外 unclear、其他模型、以及加入示範後超出提示長度上限時，回到原單標籤方式。這避免用內建情緒規則覆蓋使用者自己的 Problem。

五題變成六個推論請求，統一受最多八個並行請求的限制。任何子問題失敗都先等待其他在途請求完成，再回傳錯誤。回應仍有五個 answers；usage 記錄實際六個輸出 Token。`meta.inference_requests`、逐題 `decision_method` 及 `subrequests` 可核對執行路徑。

為保留既有機率欄位，若肯定分數為 p、不滿分數為 n，四類分數為 p(1−n)、(1−p)n、pn、(1−p)(1−n)。這採用獨立假設，**不是經校準的聯合機率，也不是正確率**。API 保留 `calibrated:false` 與 `confidence:null`，並標示 `independent_binary_product_scores`；介面也說明比例屬組合估計。

## 驗證限制與剩餘問題

100 筆與 40 筆都是先前已查看的合成資料，不能再稱為盲測。32 筆挑戰資料在本輪候選評估前寫好，涵蓋退款但肯定、取消但肯定、禮貌用語、引用他人評價及正負共存；同樣由助理產生，沒有經獨立人工覆核，仍不能作為真實業務準確率保證。資料與標準答案未為迎合預測而修改。

新挑戰資料仍有兩個錯誤：SC16 把「還是會使用」當成肯定，導致 negative→mixed；SC19 漏掉價格滿意，導致 mixed→negative。沒有根據這兩筆再調整提示。本輪五類舊資料上的 80% 是研究腳本強制拆題的結果，不是正式啟用範圍；正式服務對五類定義仍保留原方法。

37 項自動測試通過，涵蓋四類組合、權重有效性、Token 計數、定義變更時不套用、並行上限及失敗後等待在途工作。實際 HTTP 32 筆另外確認模型 8B、每筆五題、六個推論請求及六個輸出 Token。

## 重跑與還原

```powershell
# 完整五题评估，模型需先啟動且 .env MODEL 為 Qwen/Qwen3-8B
npm run evaluate:calibration-data -- --oneforward-only
npm run evaluate:calibration-data -- --dataset=datasets/feedback-holdout-40-v2.jsonl --oneforward-only

# 凍結的研究候選與新增案例
node --env-file-if-exists=.env scripts/research-sentiment.js --variants=isolated,fewshot
node --env-file-if-exists=.env scripts/research-sentiment.js --challenge --variants=baseline,fewshot
```

`.env` 中 `SENTIMENT_STRATEGY=auto`（未設定時亦為 auto）啟用自動選擇。設成 `SENTIMENT_STRATEGY=direct` 並重啟網頁/API 服務可還原原方式，無需重啟 18000 模型。改回 auto 同理。Benchmark 匯出會保留各筆實際模型、機率方法與請求數，便於區分前後版本。

## 原始報告

- [原 8B 100 筆](benchmarks/accuracy/qwen3-8b-bf16-100-oneforward.json)
- [新 8B 100 筆](benchmarks/accuracy/8b-decomposed-full-100.json)
- [原 8B 40 筆 v2](benchmarks/accuracy/8b-direct-full-40-v2.json)
- [新 8B 40 筆 v2](benchmarks/accuracy/8b-decomposed-full-40-v2.json)
- [拆題研究](benchmarks/accuracy/8b-sentiment-decomposition-research.json)
- [完整示範研究](benchmarks/accuracy/8b-sentiment-fewshot-research.json)
- [32 筆前後比較](benchmarks/accuracy/8b-sentiment-challenge32-research.json)
- [32 筆實際 API 驗證](benchmarks/accuracy/8b-decomposed-live-challenge32.json)
