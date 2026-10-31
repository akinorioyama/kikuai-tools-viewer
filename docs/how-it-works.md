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
