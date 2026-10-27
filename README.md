# GPA Helper

多科目考古題刷題網站。純靜態網頁（HTML + JS），部署在 GitHub Pages。

**網站本身不含任何題目。** 題目由使用者在網站上「匯入題庫」，存在自己的瀏覽器裡，
並可透過私人 GitHub Gist 跨裝置同步。

## 匯入題庫

在網站上點科目按鈕 →「匯入題庫」，有三種方式：

| 方式 | 適合情境 |
| --- | --- |
| **選擇檔案** | 手上有題庫 `.json` 檔（可直接拖曳進視窗） |
| **貼上文字** | 直接複製 JSON 文字貼上 |
| **網址** | Gist 頁面、GitHub 檔案頁面、Raw 連結或任何 JSON 網址。用網址匯入的題庫可以按「分享連結」，對方開啟後確認即可匯入 |

- 題庫存在瀏覽器的 IndexedDB；清除網站資料會一併刪除（重新匯入或從雲端同步即可恢復）。
- **作答紀錄依「科目代號」保存**：用相同代號重新匯入（或按「更新」）會更新題目並保留紀錄。
- 匯入時會清除題目中的程式碼與外部連結，只保留粗體、上下標、換行、表格、圖片等基本格式與安全的樣式，
  所以即使匯入別人分享的題庫，也不會危害你存在瀏覽器裡的 GitHub Token。

## 跨裝置同步（GitHub Gist）

「雲端同步」會把**作答紀錄、收藏、設定與匯入的題庫**存進同一個私人 Gist：

- 進度：`gpa_helper_sync.json`
- 題庫：每個題庫一個檔案 `gpa_bank_<科目代號>.json`

新裝置只要貼上 Token 與 Gist ID，按「雙向智慧合併」就會下載所有題庫與紀錄。
刪除的題庫在下次合併時也會從雲端與其他裝置移除。

> 不要把同步用 Gist 的網址分享給別人：拿到 Gist 網址就能看到裡面所有檔案（包含作答紀錄）。
> 要分享題庫，請另外建立一個只放題庫檔的 Gist。

## 題庫格式

可以是**題目陣列**，或包含科目資訊與共用圖片的完整格式：

```json
{
  "subject": { "id": "physiology-1", "name": "生理學", "subtitle": "一段", "topics": ["Cardiovascular", "Renal"] },
  "images": { "heart.png": "data:image/png;base64,..." },
  "questions": [
    {
      "id": "Q0001",
      "topic": "Cardiovascular",
      "stem": "題幹文字",
      "options": { "A": "選項A", "B": "選項B", "C": "選項C", "D": "選項D" },
      "answer": "B",
      "explanation": "詳解",
      "years": [112, 113],
      "image": "heart.png"
    }
  ]
}
```

`subject.topics` 是主題的顯示順序（可省略）；`images` 讓多題共用同一張圖，題目的 `image` 寫圖片名稱即可，
也可以直接寫 `https://` 圖片網址。

### 題目欄位

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | ✓ | 題號，同科目內不可重複（作答紀錄以此為 key；只能用英數字、`_`、`-`） |
| `stem` | ✓ | 題幹 |
| `options` |  | 選項物件，key 為 A/B/C/D…；可加 `"說明"` 作為配合題說明。`null` 表示問答題 |
| `answer` |  | 正確答案 key；多個正解用 `/` 分隔，如 `"A/C"` |
| `topic` |  | 主題分類，省略時歸入 `Other` |
| `subtopic` |  | 子主題（可被搜尋） |
| `explanation` |  | 詳解 |
| `years` |  | 出現年份陣列；整個科目都沒有年份時會隱藏年份篩選 |
| `repeat_count` |  | 跨年度出現次數，>1 時顯示「重複」標籤 |
| `variants` |  | 歷年原題版本，用於「跨年度原題並排比對」 |
| `image` |  | 插圖：`images` 裡的名稱，或 `https://` 網址 |
| `ref` |  | 出處 |
| `answer_basis` |  | `slides` 顯示「授課簡報依據」、`textbook` 顯示「教科書依據」，其他值顯示「教科書標準知識」 |
| `flags` |  | `disputed`、`stem_or_option_typo`、`incomplete_source`、`recalled_by_student` 會在題目上顯示標籤 |

沒有選項的問答題會顯示「顯示解答」按鈕，不列入作答紀錄。
`variants[].part` 可標註 `"A"`／`"B"`（顯示為 Part A）或 `"補充"`（顯示為補充題）。

## 本機開發與內建科目

本機可以直接用檔案的方式放題庫（這些檔案已列在 `.gitignore`，**不會上傳到 GitHub**）：

```
subjects/
  index.js              科目註冊（會上傳）
  local.js              本機內建科目清單（不上傳）
  <科目id>/questions.js  GPAHelper.registerQuestions("<科目id>", [...])（不上傳）
  <科目id>/images/       題目插圖（不上傳）
```

把本機科目轉成可在網站上匯入的檔案：

```bash
node tools/export-banks.js            # 全部科目 → 題庫匯入檔/<科目id>.json
node tools/export-banks.js anatomy    # 只轉指定科目
```

插圖會自動嵌入檔案的 `images` 欄位。產生的檔案同樣不會上傳到 GitHub。

在本機用瀏覽器開啟 `index.html` 會看到內建科目；部署到 GitHub Pages 時沒有 `subjects/local.js`，
主控台出現一筆 `local.js` 404 是正常的。

## 部署

推到 GitHub 後，在 repo 的 **Settings → Pages** 選擇 *Deploy from a branch*，Branch 選 `main`、資料夾選 `/ (root)`。

## 其他

- 每個科目的作答紀錄、錯題與收藏分開儲存在瀏覽器 localStorage。
- 舊版「解剖學考古題刷題庫」的進度會在第一次開啟時自動搬到解剖學科目。
- 網址 `index.html#<科目代號>` 可直接開啟指定科目；`index.html?import=<題庫網址>` 會開啟匯入視窗。
