# データの所在を特定した手順

プロットのデータがどこにあるかを調べた手順の記録です。サイトの構造が変わったときに、同じ方法で調べ直すための参考にしてください。

## 1. 公開ページ（WordPress）

`https://maniken.jp/kikuai-open/<レポート名>/` は WordPress のページです。

- scriptタグのうち `push(` を含むものは、投稿フォームや質問のグループ分けの処理で、プロットのデータではありませんでした。
- canvas や、Plotly、ECharts、D3 などのグラフライブラリも見つかりませんでした。
- プロットは iframe で埋め込まれていました。

```js
[...document.querySelectorAll('iframe')].map(f => f.src)
// => ['https://maniken.jp/kikuai-report-embed/<レポート名>/', ...]
```

## 2. 埋め込みページ（同じドメイン）

`/kikuai-report-embed/<レポート名>/` の中身は scriptタグを持たず、さらに iframe が 1 つあるだけでした。同じドメインなので、親ページから `contentDocument` で中身を読めます。

```js
const d = document.querySelector('iframe[src*="kikuai-report-embed"]').contentDocument;
d.querySelector('iframe').src
// => 'https://kikuai.maniken.jp/<ID>?exp=...&embed=1&sig=...&...'
```

この iframe は別ドメイン（`kikuai.maniken.jp`）なので、親ページからは中身を読めません。URL を新しいタブで直接開いて調べます。

## 3. レポート本体（Next.js）

レポート本体は Next.js（App Router）のページで、データは `self.__next_f.push([1, "..."])` の形でインラインの scriptタグに埋め込まれていました。

- 前半の push には、パイプラインの Python コード（`extraction`、`hierarchical_clustering` など）が文字列で入っています。
- 32 万文字ほどの大きな push に、`"result":{"arguments":[...], "clusters":[...]}` が含まれます。
- 中身は JSON 文字列の中にエスケープされた形で入っています。そのため、push の引数を `JSON.parse` してから連結し、`"arguments":[` と `"clusters":[` の配列を、括弧の対応を見て切り出しています。

arguments の 1 件の例:

```json
{"arg_id":"A1633_0","argument":"…","comment_id":"1633","x":6.11,"y":10.63,"p":0,"cluster_ids":["0","1_3","2_1"],"attributes":null,"url":null}
```

## 4. みんなの声との対応

「みんなの声」タブ（公開ページ側）では、次の対応で arguments と結び付けられます。

| 画面上の要素 | DOM | arguments の `comment_id` |
|---|---|---|
| 声 | `article.kikuai-open-card#voice-<番号>` | `<番号>` |
| 同様の声・返信 | `article.kx-related-voice#comment-<番号>` | `1000000000 + <番号>` |

Chrome 拡張（`extension/kikuai-args-viewer`）は、この対応を使って表示しています。クラスタの見出しは、arguments の `cluster_ids` を clusters TSV の `id` と突き合わせて表示しています。

## 5. みんなの声の一覧（`extract-voices.js`）

「みんなの声」タブは、公開ページの URL のクエリでページを切り替えています。

- `tab=voices` で「みんなの声」タブ、`voice_page=<番号>` でページ番号、`sort=new` で新しい順になります。
- 各ページの HTML を `fetch` で取得し、`DOMParser` で読んでいます。ページ番号を増やしていき、新しい声（まだ見ていない `article.kikuai-open-card` の `id`）が出てこなくなったところで止めます。
- 声とコメントの要素は、4 の表のものと同じです。項目は次の要素から取っています。

| 項目 | 要素 |
|---|---|
| 声の日付・投稿者・ジャンル・本文 | `.kikuai-open-card__date`、`.kikuai-open-card__meta strong`、`.kikuai-open-card__genre`、`.kikuai-open-card__text` |
| 声のコメント件数 | `[data-comments-toggle]` の文字列の中の数字 |
| コメントの日付・本文 | `time`、`.kx-related-voice__text` |
| コメントの区分・属性 | `.kx-related-voice__identity`、`.kx-comment-profile span`（`・` でつないだもの） |

本文の `<br>` は改行に置き換えています。

## 6. プロット（ブックマークレット）

レポート本体のプロットは Plotly で描かれていて、`.js-plotly-plot` の要素の `data` から点のデータを読めます。

- ブックマークレットは、偶数番号（0, 2, 4, …）のトレースだけを対象にしています（元の show-plotly-data のブックマークレットと同じ扱いです）。
- 各点の `text` に「クラスタ名`<br>`意見の本文」、`customdata` に `arg_id` が入っています。`comment_id` とクラスタの情報は点のデータに無いので、3 の方法で arguments と clusters を読み、`arg_id` で突き合わせています。
- 印の丸は、`layout.xaxis.range` / `layout.yaxis.range` と SVG の大きさから位置を計算して、SVG に `circle` を追加して描いています。
