# Qwen3-8B 在 Intel Arc Pro B70 的實測

後續更新：本文件保留改良前的模型比較與診斷歷程。8B 已加入正負分開判斷與完整示範，100 筆整體準確率由 76.8% 提升至 83.2%，本機 15413／15414 已套用；最新方法、適用範圍及資料限制見 [情緒準確度修正](sentiment-accuracy-improvement.md)。

## 結論

Qwen3-8B BF16 可以在 Intel Arc Pro B70 32 GB 與 WSL 的現有 vLLM 環境正常載入。vLLM 顯示模型約占 15.27 GiB，並配置 2 GiB KV cache，測試過程沒有發生顯存不足。

它目前不取代 Qwen3-4B-Instruct-2507。相同資料與 OneForward 設定下，8B 的整體準確率為 76.8%，低於 4B 的 78.2%，延遲則增加約 14 ms。這次結果不足以定位主要瓶頸，也不能證明較大模型的語意理解較差：模型版本、訓練方式、提示、解碼限制與合成資料標註都可能影響結果。

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

停用 thinking 後，8B 恢復正常判斷，但它在目前測試中的情緒欄位容易把 positive 判成 mixed、把 negative 判成 mixed。一般共用的正溫度縮放可以調整信心程度，卻不改變 argmax 排名，因此不能靠這種機率校準直接修正分類錯誤。

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

### 完整操作與驗證

1. 在模型與網頁服務各自的終端按 `Ctrl+C`，等待停止。
2. 開啟 PowerShell，進入專案並選擇模型（兩個模型已下載時不必再下載）：

```powershell
Set-Location F:\sideproject\urJev
npm run model:select:8b
# 要切回 4B，改用 npm run model:select:4b
npm run model:vllm
```

3. 等待模型完成啟動，保持上述終端開啟。在第二個 PowerShell 終端啟動網頁：

```powershell
Set-Location F:\sideproject\urJev
npm start
```

4. `.env` 的 `PORT` 決定網頁埠，範本為 15413。若本次要使用 15414，可在第二個終端執行以下指令取代 `npm start`：

```powershell
$env:PORT = '15414'
npm start
```

5. 檢查模型與網頁回報的名稱一致（網頁埠依實際使用調整）：

```powershell
Invoke-RestMethod http://127.0.0.1:18000/v1/models
Invoke-RestMethod http://127.0.0.1:15413/api/health
```

8B 應回報 `Qwen/Qwen3-8B`；4B 應回報 `Qwen/Qwen3-4B-Instruct-2507`，health 應為 `ready: true`。開啟對應埠的 `/benchmark`，先匯出既有結果再重新整理；重新整理會清除頁面中的 API key 與測試結果。切换只改 `.env`，不會熱切換已啟動的程序，因此兩個服務都必須重啟。

## 2026-09-23 原因複查：已確認與待驗證

### 並非只比較參數量

[Qwen3-4B-Instruct-2507 官方模型卡](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) 說明它是更新後的 non-thinking 版本，改進包含指令遵循與文字理解；[原始 Qwen3-8B 模型卡](https://huggingface.co/Qwen/Qwen3-8B) 則提供 thinking／non-thinking 切換。兩者的訓練版本與模式不同，不能用這次成績推論「4B 的能力天花板高於 8B」。更大容量提供潛力，不保證每項分類任務必然進步。

### 錯誤集中在情緒邊界

從已保存報告逐欄比對，8B 修正了 4B 的 33 個錯誤，同時新增 40 個錯誤，淨少答對 7 個。500 個判斷來自同一批 100 筆合成資料，並非 500 個獨立真實樣本；1.4 個百分點差距不能直接外推實際業務表現。

| 情緒真值 | 筆數 | 4B 誤判 mixed | 8B 誤判 mixed |
| --- | ---: | ---: | ---: |
| positive | 25 | 20 | 22 |
| negative | 25 | 9 | 19 |

案例 CAL015：「播放器操作很流暢，希望能記住上次的播放速度。請協助確認。」標註為 positive，8B 判 mixed。CAL009 明確肯定客服，另提出退款，也被判 mixed。這提示模型可能將改善建議或退款行為推論成不滿，但尚未用對照實驗確認因果；也需要人工複核資料定義是否清楚一致。

### 提示與單 Token 決策仍待對照

`src/systemone.js` 的情緒提示反覆強調 mixed，邊界範例包含 negative、neutral、mixed，卻缺少純 positive 範例；這是可檢驗的提示偏向，不能直接認定為已證實原因。OneForward 限制下一個 Token 必須是候選，仍有完整前向計算，但沒有多 Token 推理空間，且可能受答案標籤與排列順序影響。

### 下一步實驗順序

1. 人工複核既有合成資料，另外保留未參與調整的測試集。
2. 對兩個模型使用相同資料，分別測原提示、平衡四類範例、移除情緒額外提示；只在開發集選擇版本。
3. 比較語意標籤與 A–D，輪換候選順序，測量答案是否受標籤影響。
4. 以簡單分類答案的多 Token 輸出作對照，再測 8B thinking；不要把全零權重 JSON 的失敗當成一般語意推理失敗。
5. 在保留測試集比較準確率、逐類召回率、完整請求耗時與錯誤率，再决定是否替換預設模型。現有延遲僅代表這次評估腳本的測量範圍，不代表外網瀏覽器端到端延遲。

上述初步複查之後，依使用者要求切換到 8B 並執行下列實驗。工作機的 `.env` 已選擇 8B；版本庫範本仍以 4B 為初始設定。

## 8B 情緒診斷實驗

使用同一份 100 筆 v2 資料，僅測試 sentiment；所有版本皆停用 thinking，temperature 為 0。這是已被查看與調整過的開發資料，不是新的泛化成績。

| 方法 | 情緒答對數 | 備註 |
| --- | ---: | --- |
| 原提示、語意標籤、單 Token | 52 / 100 | 重現先前結果 |
| 移除額外情緒規則與範例 | 49 / 100 | 簡化沒有改善 |
| 平衡四類範例、明確區分請求與評價 | 56 / 100 | 小幅改善 |
| 同上，標籤改為 A–D | 50 / 100 | 字母標籤沒有改善 |
| 平衡範例、自由文字答案（最多 32 Token） | 56 / 100 | 仍要求直接回答，與受限版本逐筆結果一致 |
| 平衡範例、先列正負證據再回答（最多 192 Token） | 73 / 100 | 單題平均 785 ms，不能當成五題完整延遲 |

最後一種使用可見的證據說明，並沒有啟用 Qwen thinking mode。改動包含提示要求與允許的輸出長度，因此無法把提升完全歸因於 Token 數量。

已觀察到的錯誤：CAL009 的回應直接把「想申請退費」列為不滿；CAL015 直接把「希望能記住上次的播放速度」列為不滿。這與 Problem 要求只看明確評價、不要從行為推測情緒的定義不一致。模型的可見說明支持這個錯誤模式，但不代表完整揭露其內部推理。

本輪結果支持繼續調整任務對齊與證據判讀，不能以此證明 8B 的語意能力天花板。也不能宣稱放寬輸出就必定提高準確率：只允許自由標籤的版本沒有提升，要求先列證據才出現改善。暫不將開發集上的新提示直接套用到正式服務。

原始資料：

- [五種提示與輸出對照](benchmarks/accuracy/8b-sentiment-ablation.json)
- [先列證據再分類](benchmarks/accuracy/8b-sentiment-evidence.json)
- [保守 Intel 執行設定對照](benchmarks/accuracy/8b-sentiment-safe.json)

### Intel 最佳化對照

另外以 `npm run model:vllm:safe` 啟動同一個 8B BF16 模型，使用 Transformers 模型實作、Triton attention、eager 執行，停用 prefix cache、async scheduling 與自訂 compiled normalization hook。原提示情緒準確率仍為 52%；100 筆中有 99 筆與最佳化設定的預測一致。唯一不同是 CAL030（真值 positive），從 mixed 變為 neutral，兩者皆錯。

因此沒有證據顯示這些 Intel 加速設定是本次大量情緒誤判的主因。這是兩組設定的整體對照，不能證明所有核心數值完全相同，也不能單獨識別任一設定的因果效果。測試後已恢復最佳化執行方式，模型維持 8B。

### 既有 40 筆資料回歸

在既有 `feedback-holdout-40.jsonl` 上，原提示情緒準確率為 27/40（67.5%），先列證據的版本為 34/40（85%）。後者的 16 筆 negative 全部答對，但 7 筆 positive 仍有 2 筆被判 mixed，4 筆 unclear 仍全被判 neutral。這份舊資料仍包含 unclear，與 100 筆 v2 的四類情緒定義不同，兩份準確率不可直接合併。

先列證據單題平均約 734 ms；採順序請求且包含暖機影響，並未量測五題併行時的整體延遲。改善方向在兩份資料上相同，但兩份都屬已查看的合成資料，仍需新的人工標註資料驗證。

- [回歸原提示](benchmarks/accuracy/8b-sentiment-regression-baseline.json)
- [回歸先列證據](benchmarks/accuracy/8b-sentiment-regression-evidence.json)

目前網頁保留原本 OneForward 提示與快速路徑；新方法僅存在於診斷腳本，尚未作為正式修正上線。15413 與 15414 均重新啟動並指向 18000 的 Qwen3-8B。

重跑指令（先確認 8B 已啟動）：

```powershell
node --env-file-if-exists=.env scripts/diagnose-sentiment.js
node --env-file-if-exists=.env scripts/diagnose-sentiment.js --evidence
```

報告寫入 `reports/`；不會更改正式提示或資料標註。`--holdout` 使用既有 40 筆資料，但該資料在歷次調整中已被查看，只能用作額外回歸檢查，不能稱為全新盲測。
