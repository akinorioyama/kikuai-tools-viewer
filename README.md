# 聴くAI レポート データ抽出ツール

ブロードリスニングサービス「聴くAI」で公開されているレポートから、次のデータを取り出して確認するためのツール群です。

- プロットに使われている意見（arguments）の全件
- 各レベルのクラスタ（ID、見出し、説明、件数）
- 「みんなの声」ページ上で、各声・コメントの横に対応する意見を並べて表示する Chrome 拡張

> **非公式ツールです。** 聴くAI の運営者、およびレポートを公開している自治体とは関係ありません。サイトの構造が変わると動かなくなることがあります。

## 構成

```
extension/kikuai-args-viewer/   Chrome 拡張（みんなの声ビューア）
scripts/extract-arguments.js    プロットの意見を TSV で取得（コンソール用）
scripts/extract-clusters.js     クラスタを TSV で取得（コンソール用）
docs/how-it-works.md            データの所在を特定した手順の記録
```

取得したデータ（TSV）はこのリポジトリには含めていません。各自で取得してください。`.gitignore` で `*.tsv` を除外しています。

## 利用上の注意

- 対象サイトの利用規約を確認し、その範囲で利用してください。
- 取得したデータには市民の意見が含まれます。再配布や二次利用は、レポートの公開元の方針に従ってください。
- スクリプトはブラウザに表示済みのページの中身を読むだけで、外部への送信は行いません。拡張機能も、取り込んだ TSV（arguments と clusters）をブラウザ内（`chrome.storage.local`）に保存するだけです。

## 1. データの取得（arguments / clusters）

レポートのプロットは、公開ページに入れ子の iframe で埋め込まれています。スクリプトは**一番内側のレポート本体のページ**で実行する必要があります。

### 1-1. レポート本体のページを開く

1. 公開ページ（例: `https://maniken.jp/kikuai-open/<レポート名>/`）を開きます。
2. DevTools のコンソールで次を実行し、レポート本体の URL を表示します。

   ```js
   const d = document.querySelector('iframe[src*="kikuai-report-embed"]').contentDocument;
   console.log(d.querySelector('iframe').src);
   ```

3. 表示された URL（`https://kikuai.maniken.jp/<ID>?exp=...&sig=...` の形）を新しいタブで開きます。

> この URL には有効期限付きの署名（`exp`、`sig`）が付いています。期限が切れたら公開ページからもう一度取得してください。Issue や README などに URL をそのまま貼らないでください。

### 1-2. スクリプトを実行する

レポート本体のタブで DevTools のコンソールを開き、`scripts/` のファイルの中身を貼り付けて実行します。

| スクリプト | 出力ファイル | 列 |
|---|---|---|
| `extract-arguments.js` | `report_arguments_YYYYMMDD_HHMM.tsv` | `arg_id`, `argument`, `comment_id`, `x`, `y`, `p`, `cluster_ids`, `attributes`, `url` |
| `extract-clusters.js` | `report_clusters_YYYYMMDD_HHMM.tsv` | `level`, `id`, `parent`, `label`, `takeaway`, `value` |

- ファイル名の先頭は、各スクリプト冒頭の `PREFIX` で変更できます。
- TSV は BOM 付き UTF-8 です。Excel でもそのまま開けます。
- 本文中のタブと改行は半角スペースに置き換えています。
- `cluster_ids` は、レベル順にカンマ区切りで並んでいます（例: `0,1_3,2_1`）。
- 実行後、`window.__args` / `window.__clusters` に配列が残ります。JSON が必要な場合は、`copy(JSON.stringify(window.__args, null, 2))` でクリップボードにコピーできます。

### 各列の意味

**arguments**

| 列 | 内容 |
|---|---|
| `arg_id` | 意見の ID（例: `A1633_0`） |
| `argument` | 元のコメントから AI が抽出した意見の文 |
| `comment_id` | 元コメントの ID。声は番号そのまま、同様の声・返信は `1000000000 + コメント番号` |
| `x`, `y` | プロット上の座標 |
| `cluster_ids` | 所属クラスタ（レベル 0, 1, 2 …） |

元のコメントの原文は、レポートのデータには含まれていません。

**clusters**

| 列 | 内容 |
|---|---|
| `level` | 階層レベル（0 が全体） |
| `id` | クラスタ ID（arguments の `cluster_ids` と対応） |
| `parent` | 親クラスタの ID |
| `label` | クラスタ名 |
| `takeaway` | クラスタの説明文 |
| `value` | 含まれる意見の件数 |

## 2. Chrome 拡張（みんなの声ビューア）

「みんなの声」タブの各声・コメントの右側に、arguments TSV の対応する行（抽出された意見、`cluster_ids`、座標）を表示します。clusters TSV も取り込むと、各意見の下に所属クラスタの見出しが表示されます。

### インストール（パッケージ化されていない拡張機能として読み込む）

Chrome ウェブストアでは公開していません。次の手順で読み込みます。

1. このリポジトリを clone するか、ZIP でダウンロードして展開します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押し、`extension/kikuai-args-viewer` フォルダを選びます。

更新したときは、`chrome://extensions` で拡張機能の再読み込みボタンを押してください。

### 使い方

1. 公開ページ（`https://maniken.jp/kikuai-open/<レポート名>/`）の「みんなの声」タブを開きます。
2. 画面左下のツールバーから、1-2 で取得した 2 つの TSV を取り込みます。
   - 「TSV取込」: **arguments の TSV** を選びます（`arg_id`、`comment_id` 列が必要）。
   - 「クラスタ取込」: **clusters の TSV** を選びます（`id`、`label` 列が必要）。どちらを先に取り込んでもかまいません。
3. 各声・コメントの右側に、対応する意見が表示されます。
   - `arg_id` の番号と `comment_id` が一致しない行は、橙色で表示されます。
   - 該当する行がない場合は「TSV に該当する行なし」と表示されます。
   - clusters TSV を取り込んでいると、各意見の下に、所属クラスタ（レベル 1 と 2）の ID、見出し、件数が表示されます。見出しにマウスを乗せると説明文（`takeaway`）が出ます。クラスタ TSV に無い ID は「クラスタファイルに該当なし」と表示されます。
4. ツールバーには、取り込んだファイル名と行数が表示されます。
5. 取り込んだ TSV は、レポートごとにブラウザに保存されます。次回からは自動で表示されます。「解除」で 2 つとも保存を消して元の表示に戻ります。

### 権限

- `storage`: 取り込んだ 2 つの TSV をブラウザ内に保存するため
- 動作対象: `https://maniken.jp/kikuai-open/*` のみ

## ライセンス

[MIT](LICENSE)
