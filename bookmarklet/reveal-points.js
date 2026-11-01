javascript:(function() {
    const PLOT_CLASS_NAME = "js-plotly-plot";
    const SVG_CONTAINER_CLASS = "main-svg";
    const TARGET_PLOT_INDEX = 0;
    const TARGET_SVG_INDEX = 2;
    const OUTPUT_CONTAINER_ID = "plotlySmartFilteredDataOutput";
    const CIRCLE_INDICATOR_CLASS = "dynamic-indicator-circle";
    const FILTER_DIALOG_ID = "plotlySmartFilterDialog";
    const BLINK_INDICATOR_CLASS = "dynamic-indicator-blink";
    const STATE_KEY = "__revealPointsAllViewsState";

    /* 前回の実行で付けた監視を止める（再実行したときに二重に動かないように） */
    const prevState = window[STATE_KEY];
    if (prevState && prevState.observer) prevState.observer.disconnect();
    if (prevState && prevState.detach) prevState.detach();

    /* 表示中の Plotly グラフを探す。表示切替でグラフ要素が作り直されるので、毎回探し直す */
    function findPlot() {
        const plots = [...document.getElementsByClassName(PLOT_CLASS_NAME)].filter(p => p.data && p.data.length);
        const visible = plots.filter(p => { const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        return visible[0] || plots[0] || document.getElementsByClassName(PLOT_CLASS_NAME)[TARGET_PLOT_INDEX] || null;
    }

    function plotMode(plot) {
        return plot.data.some(t => t.type === "treemap") ? "treemap" : "scatter";
    }

    /* 丸を描く SVG。グラフ要素の中から選ぶ（無ければ元のページ全体での番号指定） */
    function findSvg(plot) {
        const local = plot.getElementsByClassName(SVG_CONTAINER_CLASS);
        return local[TARGET_SVG_INDEX] || local[local.length - 1] || document.getElementsByClassName(SVG_CONTAINER_CLASS)[TARGET_SVG_INDEX] || null;
    }

    /* データ座標を SVG 上の位置に変換する。Plotly の軸情報が使えればそれを使い、無ければ元の計算 */
    function toPixel(plot, svgContainer, x, y) {
        const fl = plot._fullLayout;
        const xa = fl && fl.xaxis, ya = fl && fl.yaxis;
        if (xa && ya && typeof xa.l2p === "function" && typeof ya.l2p === "function" && xa._offset !== undefined) {
            return { px: xa._offset + xa.l2p(x), py: ya._offset + ya.l2p(y) };
        }
        const xAxisRange = plot.layout.xaxis.range;
        const yAxisRange = plot.layout.yaxis.range;
        if (!xAxisRange || !yAxisRange) return null;
        const svgRect = svgContainer.getBoundingClientRect();
        const xProportion = (x - xAxisRange[0]) / (xAxisRange[1] - xAxisRange[0]);
        const yProportion = (y - yAxisRange[0]) / (yAxisRange[1] - yAxisRange[0]);
        return { px: xProportion * svgRect.width, py: svgRect.height - (yProportion * svgRect.height) };
    }

    function drawCircleForPoint(plot, svgContainer, traceIndex, pointIndex) {
        try {
            const x = plot._fullData[traceIndex].x[pointIndex];
            const y = plot._fullData[traceIndex].y[pointIndex];
            if (x === undefined || y === undefined) return;
            const pos = toPixel(plot, svgContainer, x, y);
            if (!pos) return;
            const svgNS = 'http://www.w3.org/2000/svg';
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('class', CIRCLE_INDICATOR_CLASS);
            circle.setAttribute('cx', pos.px);
            circle.setAttribute('cy', pos.py);
            circle.setAttribute('r', '8');
            circle.setAttribute('fill', 'rgba(255, 165, 0, 0.8)');
            circle.setAttribute('stroke', 'black');
            circle.setAttribute('stroke-width', '2');
            circle.style.pointerEvents = 'none';
            svgContainer.appendChild(circle);
        } catch (error) {
            console.error(`Failed to draw circle for trace ${traceIndex}, point ${pointIndex}:`, error);
        }
    }

    /* 選んだ点に赤い丸を描く。animate が真なら最初に数回点滅し、その後は次の点を選ぶまで表示を続ける */
    function drawSelectedCircle(plot, svgContainer, traceIndex, pointIndex, animate) {
        document.querySelectorAll(`.${BLINK_INDICATOR_CLASS}`).forEach(c => c.remove());
        if (!svgContainer) return;
        try {
            const x = plot._fullData[traceIndex].x[pointIndex];
            const y = plot._fullData[traceIndex].y[pointIndex];
            if (x === undefined || y === undefined) return;
            const pos = toPixel(plot, svgContainer, x, y);
            if (!pos) return;
            const svgNS = 'http://www.w3.org/2000/svg';
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('class', BLINK_INDICATOR_CLASS);
            circle.setAttribute('cx', pos.px);
            circle.setAttribute('cy', pos.py);
            circle.setAttribute('r', '14');
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', 'red');
            circle.setAttribute('stroke-width', '4');
            circle.style.pointerEvents = 'none';
            if (animate) {
                const anim = document.createElementNS(svgNS, 'animate');
                anim.setAttribute('attributeName', 'opacity');
                anim.setAttribute('values', '1;0;1');
                anim.setAttribute('dur', '0.6s');
                anim.setAttribute('repeatCount', '5');
                circle.appendChild(anim);
            }
            svgContainer.appendChild(circle);
        } catch (error) {
            console.error(`Failed to draw selection for trace ${traceIndex}, point ${pointIndex}:`, error);
        }
    }

    /* 一覧から選んだ点のホバー表示を開く（ページで window.Plotly が使える場合のみ） */
    function openHover(plot, traceIndex, pointIndex) {
        try {
            const P = window.Plotly;
            if (P && P.Fx && typeof P.Fx.hover === 'function') {
                P.Fx.hover(plot, [{ curveNumber: traceIndex, pointNumber: pointIndex }]);
            }
        } catch (e) {
            console.warn("Plotly hover failed:", e);
        }
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') {
            if (unsafe === null || unsafe === undefined) return '';
            try {
                unsafe = String(unsafe);
            } catch (e) {
                return '';
            }
        }
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    /* ページに埋め込まれた self.__next_f.push(...) から arguments と clusters を取り出す（extract-arguments.js / extract-clusters.js と同じ方法） */
    function loadReportData() {
        const flight = [...document.scripts].map(s => s.textContent)
            .filter(t => t.startsWith('self.__next_f.push('))
            .map(t => { try { return JSON.parse(t.slice('self.__next_f.push('.length, t.lastIndexOf(')')))[1] || ''; } catch (e) { return ''; } })
            .join('');
        function extractArrays(text, key) {
            const out = [];
            let from = 0, pos;
            while ((pos = text.indexOf(key, from)) >= 0) {
                const start = pos + key.length - 1;
                let depth = 0, inStr = false, esc = false, end = -1;
                for (let j = start; j < text.length; j++) {
                    const c = text[j];
                    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
                    if (c === '"') inStr = true;
                    else if (c === '[') depth++;
                    else if (c === ']') { depth--; if (depth === 0) { end = j; break; } }
                }
                if (end < 0) break;
                try { out.push(JSON.parse(text.slice(start, end + 1))); } catch (e) { console.warn('parse failed at', pos, e); }
                from = end + 1;
            }
            return out;
        }
        const argById = new Map();
        extractArrays(flight, '"arguments":[').filter(arr => arr.length && arr[0].arg_id).flat()
            .forEach(a => { if (!argById.has(String(a.arg_id))) argById.set(String(a.arg_id), a); });
        const clusterById = new Map();
        extractArrays(flight, '"clusters":[').filter(arr => arr.length && arr[0].id != null).flat()
            .forEach(c => { if (!clusterById.has(String(c.id))) clusterById.set(String(c.id), c); });
        return { argById, clusterById };
    }

    /* テキスト・arg_id・comment_id を分けて入力するポップアップ */
    function askFilters() {
        return new Promise(resolve => {
            const old = document.getElementById(FILTER_DIALOG_ID);
            if (old) old.remove();
            const overlay = document.createElement('div');
            overlay.id = FILTER_DIALOG_ID;
            overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:2147483647; display:flex; align-items:center; justify-content:center; font-family:Arial,sans-serif;";
            const box = document.createElement('div');
            box.style.cssText = "background:#fff; border:2px solid #8e44ad; border-radius:8px; padding:16px 20px; width:min(440px,90vw); box-shadow:0 4px 16px rgba(0,0,0,0.3); color:#222;";
            const field = (label, hint) => {
                const wrap = document.createElement('label');
                wrap.style.cssText = "display:flex; flex-direction:column; margin:0 0 10px; font-size:14px;";
                wrap.textContent = label;
                const input = document.createElement('input');
                input.type = 'text';
                input.style.cssText = "display:block; box-sizing:border-box; margin-top:4px; padding:6px; font-size:14px; border:1px solid #aaa; border-radius:4px;";
                input.placeholder = hint;
                wrap.appendChild(input);
                box.appendChild(wrap);
                return input;
            };
            const title = document.createElement('div');
            title.textContent = "検索条件（空欄は条件なし。複数入れた場合はすべてを満たすもの）";
            title.style.cssText = "font-weight:bold; margin-bottom:12px; font-size:14px;";
            box.appendChild(title);
            const textInput = field("テキスト（一部一致）", "例: 子育て");
            const argInput = field("arg_id（一部一致。カンマ区切りで複数可、どれかを含めば対象）", "例: 1935, 1936");
            const commentInput = field("comment_id（一部一致）", "例: 193");
            const buttons = document.createElement('div');
            buttons.style.cssText = "text-align:right; margin-top:6px;";
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = "キャンセル";
            const okBtn = document.createElement('button');
            okBtn.textContent = "検索";
            [cancelBtn, okBtn].forEach(b => { b.style.cssText = "margin-left:8px; padding:6px 14px; font-size:14px; cursor:pointer;"; buttons.appendChild(b); });
            box.appendChild(buttons);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            const finish = value => { overlay.remove(); resolve(value); };
            const submit = () => finish({
                text: textInput.value,
                argIds: argInput.value.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean),
                commentPart: commentInput.value.trim()
            });
            okBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', () => finish(null));
            [textInput, argInput, commentInput].forEach(inp => inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
            }));
            textInput.focus();
        });
    }

    /* 意見が属するクラスタ（Lv0 を除く）を「Lv1: ラベル (id), Lv2: …」の形で出す */
    function clusterPathHtml(report, argRecord) {
        return ((argRecord && argRecord.cluster_ids) || [])
            .map(id => ({ id: String(id), c: report.clusterById.get(String(id)) }))
            .filter(x => !x.c || Number(x.c.level) !== 0)
            .map(x => x.c
                ? `<strong>Lv${escapeHtml(x.c.level)}:</strong> ${escapeHtml(x.c.label)} (${escapeHtml(x.id)})`
                : `<strong>cluster:</strong> ${escapeHtml(x.id)}`)
            .join(", ");
    }

    /* ページのデータ（arguments）から条件に合う意見を探す。テキストは意見本文と所属クラスタ名を対象にする */
    function reportArgMatches(report, a, f) {
        const labels = (a.cluster_ids || []).map(id => report.clusterById.get(String(id)))
            .filter(c => c && Number(c.level) !== 0).map(c => c.label).join("\n");
        const textMatched = f.targetText === null || (String(a.argument || "") + "\n" + labels).indexOf(f.targetText) !== -1;
        const argMatched = f.argIdTerms.length === 0 || f.argIdTerms.some(t => String(a.arg_id).indexOf(t) !== -1);
        const commentMatched = f.commentPart === "" || (a.comment_id !== undefined && a.comment_id !== null && String(a.comment_id).indexOf(f.commentPart) !== -1);
        return textMatched && argMatched && commentMatched;
    }

    function clusterListHtml(report, clusterHits) {
        if (report.clusterById.size === 0) {
            return `<div><h2>Clusters</h2><p>clusters データが見つかりませんでした</p></div>`;
        }
        const hitClusters = [...clusterHits.entries()].map(([id, count]) => ({ id, count, c: report.clusterById.get(id) }));
        hitClusters.sort((a, b) => {
            const la = a.c ? Number(a.c.level) : Infinity, lb = b.c ? Number(b.c.level) : Infinity;
            return (la - lb) || a.id.localeCompare(b.id, undefined, { numeric: true });
        });
        const items = hitClusters.map(h => h.c
            ? `<li><strong>[Lv${escapeHtml(h.c.level)}] ${escapeHtml(h.c.label)}</strong> (id: ${escapeHtml(h.id)}, ${h.count}件)</li>`
            : `<li><strong>id: ${escapeHtml(h.id)}</strong> (${h.count}件) clusters データに見つかりません</li>`
        ).join("");
        return `<div style="border-bottom:1px solid #8e44ad; margin-bottom:10px;"><h2>Clusters in results (${hitClusters.length})</h2><ul>${items}</ul></div>`;
    }

    function addClusterHits(clusterHits, argRecord) {
        ((argRecord && argRecord.cluster_ids) || []).forEach(id => {
            clusterHits.set(String(id), (clusterHits.get(String(id)) || 0) + 1);
        });
    }

    function getOutputContainer() {
        let outputContainer = document.getElementById(OUTPUT_CONTAINER_ID);
        if (!outputContainer) {
            outputContainer = document.createElement('div');
            outputContainer.id = OUTPUT_CONTAINER_ID;
            outputContainer.style.cssText = "border:2px solid #8e44ad; padding:15px; margin-top:20px; font-family:Arial,sans-serif; background-color:#f4e6f7;";
            document.body.appendChild(outputContainer);
        }
        return outputContainer;
    }

    function clearIndicators() {
        document.querySelectorAll(`.${CIRCLE_INDICATOR_CLASS}, .${BLINK_INDICATOR_CLASS}`).forEach(c => c.remove());
    }

    /* 前に付けたグラフのイベントを外す */
    function detachPlotHandlers(plot) {
        if (!plot || !plot.removeListener) return;
        const h = plot.__revealHandlers || {};
        Object.keys(h).forEach(ev => { try { plot.removeListener(ev, h[ev]); } catch (e) { } });
        plot.__revealHandlers = {};
    }

    function attachPlotHandler(plot, ev, fn) {
        if (!plot.on) return;
        plot.__revealHandlers = plot.__revealHandlers || {};
        plot.__revealHandlers[ev] = fn;
        plot.on(ev, fn);
    }

    /* ===== 散布図（全体図・詳細クラスタ・濃い意見） ===== */
    function renderScatter(state, plot, isInitial) {
        const { report, f } = state;
        const svgContainer = findSvg(plot);
        if (!svgContainer && isInitial) {
            alert(`Could not find the target SVG container with class "${SVG_CONTAINER_CLASS}". Circles will not be drawn.`);
        }
        const filteredPoints = [];
        const clusterHits = new Map();
        const shownArgIds = new Set();
        const seen = new Set();
        let htmlOutputString = "";
        const traces = plot.data;
        /* 表示切替やバージョンでトレースの並びが変わるので、点を持つトレースを全部見る（凸包などの線だけのトレースは除く）。同じ意見が二重に出ないよう arg_id で重複を除く */
        for (let i = 0; i < traces.length; i++) {
            const trace = traces[i];
            if (!trace || !(trace.type || "scatter").startsWith("scatter")) continue;
            if (trace.mode && trace.mode.indexOf("markers") === -1) continue;
            if (trace.fill && trace.fill !== "none") continue;
            const traceName = trace.name || `Unnamed Trace ${i}`;
            let traceHtmlContent = "";
            let pointsInThisTraceMatched = false;
            const numPoints = (trace.x && Array.isArray(trace.x)) ? trace.x.length : 0;
            for (let j = 0; j < numPoints; j++) {
                const customtext = Array.isArray(trace.text) ? (trace.text[j] || "") : "";
                const customdata = trace.customdata && trace.customdata[j] ? trace.customdata[j] : {};
                const argIdValue = customdata.arg_id !== undefined ? customdata.arg_id : "N/A";
                const key = argIdValue !== "N/A" ? `a:${argIdValue}` : `xy:${trace.x[j]},${trace.y[j]}`;
                if (argIdValue !== "N/A") shownArgIds.add(String(argIdValue));
                if (seen.has(key)) continue;
                const textValue = String(customtext || "");
                const argRecord = report.argById.get(String(argIdValue));
                const commentIdValue = customdata.comment_id !== undefined ? customdata.comment_id : (argRecord ? argRecord.comment_id : undefined);
                const textMatched = f.targetText === null || textValue.indexOf(f.targetText) !== -1;
                const argMatched = f.argIdTerms.length === 0 || f.argIdTerms.some(t => String(argIdValue).indexOf(t) !== -1);
                const commentMatched = f.commentPart === "" || (commentIdValue !== undefined && commentIdValue !== null && String(commentIdValue).indexOf(f.commentPart) !== -1);
                if (textMatched && argMatched && commentMatched) {
                    seen.add(key);
                    pointsInThisTraceMatched = true;
                    filteredPoints.push({ traceIndex: i, pointIndex: j });
                    addClusterHits(clusterHits, argRecord);
                    const pointClusterHtml = clusterPathHtml(report, argRecord);
                    /* text は「クラスタ名<br>意見本文」の形なので、最初の <br> で前後に分ける */
                    const pointTextString = String(customtext || "N/A");
                    const brMatch = pointTextString.match(/<br\s*\/?>/i);
                    const textHead = brMatch ? pointTextString.slice(0, brMatch.index) : pointTextString;
                    const textBody = brMatch ? pointTextString.slice(brMatch.index + brMatch[0].length) : (argRecord ? escapeHtml(argRecord.argument) : "");
                    traceHtmlContent += `<li data-trace="${i}" data-point="${j}" style="cursor:pointer;" title="クリックでグラフ上の点を選択">Point ${j + 1} (Trace ${i}): ` +
                        `<strong>arg_id:</strong> ${escapeHtml(argIdValue)}, ` +
                        `<strong>comment_id:</strong> ${escapeHtml(commentIdValue !== undefined ? commentIdValue : "N/A")},` +
                        `<br><strong>text:</strong> ${textHead}` +
                        (pointClusterHtml ? `<br>${pointClusterHtml}` : "") +
                        (textBody ? `<br>${textBody}` : "") +
                        `</li>`;
                }
            }
            if (pointsInThisTraceMatched) {
                htmlOutputString += `<h3>Trace ${i}: ${escapeHtml(traceName)}</h3><ul>${traceHtmlContent}</ul>`;
            }
        }

        /* この表示に出ていない該当意見（詳細クラスタ・濃い意見では一部のクラスタだけが表示される） */
        let hiddenHtml = "";
        if (report.argById.size > 0 && shownArgIds.size > 0) {
            const hidden = [...report.argById.values()].filter(a => !shownArgIds.has(String(a.arg_id)) && reportArgMatches(report, a, f));
            if (hidden.length > 0) {
                const items = hidden.map(a => {
                    const path = clusterPathHtml(report, a);
                    return `<li><strong>arg_id:</strong> ${escapeHtml(a.arg_id)}, <strong>comment_id:</strong> ${escapeHtml(a.comment_id !== undefined ? a.comment_id : "N/A")}` +
                        (path ? `<br>${path}` : "") + `<br>${escapeHtml(a.argument)}</li>`;
                }).join("");
                hiddenHtml = `<details style="border-top:1px solid #8e44ad; margin-top:10px;"><summary><strong>この表示には出ていない該当意見 (${hidden.length}件)</strong>（本文・所属クラスタ名で照合）</summary><ul>${items}</ul></details>`;
            }
        }

        const outputContainer = getOutputContainer();
        clearIndicators();
        if (filteredPoints.length === 0) {
            outputContainer.innerHTML = `<h2>Tracked Points (Filter: All Entries)</h2><p>この表示には該当する点がありません。</p>${hiddenHtml}`;
            if (isInitial && !hiddenHtml) alert(`No entries found matching filter.`);
            return;
        }

        let selected = null;
        const redrawCircles = () => {
            const svg = findSvg(plot);
            if (!svg) return;
            document.querySelectorAll(`.${CIRCLE_INDICATOR_CLASS}`).forEach(c => c.remove());
            for (const point of filteredPoints) {
                drawCircleForPoint(plot, svg, point.traceIndex, point.pointIndex);
            }
            if (selected) drawSelectedCircle(plot, svg, selected.traceIndex, selected.pointIndex, false);
        };
        redrawCircles();
        attachPlotHandler(plot, 'plotly_relayout', redrawCircles);
        attachPlotHandler(plot, 'plotly_afterplot', redrawCircles);

        outputContainer.innerHTML = `${clusterListHtml(report, clusterHits)}<h2>Tracked Points (Filter: All Entries)</h2>${htmlOutputString}${hiddenHtml}`;
        /* 点を選ぶ: 一覧の行に赤枠、グラフの点に赤い丸（次の点を選ぶまで残す） */
        const selectPoint = (traceIndex, pointIndex) => {
            const li = outputContainer.querySelector(`li[data-trace="${traceIndex}"][data-point="${pointIndex}"]`);
            if (!li) return null;
            outputContainer.querySelectorAll('li[data-trace]').forEach(x => { x.style.outline = ''; });
            li.style.outline = '3px solid red';
            li.style.outlineOffset = '2px';
            selected = { traceIndex, pointIndex };
            drawSelectedCircle(plot, findSvg(plot), traceIndex, pointIndex, true);
            return li;
        };
        /* 一覧の行をクリック: グラフへスクロールして点を選ぶ */
        outputContainer.onclick = e => {
            const li = e.target.closest('li[data-trace]');
            if (!li) return;
            const traceIndex = Number(li.dataset.trace), pointIndex = Number(li.dataset.point);
            selectPoint(traceIndex, pointIndex);
            plot.scrollIntoView({ behavior: 'smooth', block: 'center' });
            openHover(plot, traceIndex, pointIndex);
        };
        /* グラフの点をクリック: 一覧の該当する行へスクロールして点を選ぶ（一覧に無い点は何もしない） */
        attachPlotHandler(plot, 'plotly_click', ev => {
            const pt = ev && ev.points && ev.points[0];
            if (!pt) return;
            const li = selectPoint(pt.curveNumber, pt.pointNumber);
            if (li) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        if (isInitial) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ===== 階層（ツリーマップ） ===== */
    function sliceId(el) {
        const d = el.__data__;
        if (!d) return null;
        if (d.data && d.data.data && d.data.data.id !== undefined) return String(d.data.data.id);
        if (d.data && d.data.id !== undefined) return String(d.data.id);
        if (d.id !== undefined) return String(d.id);
        return null;
    }

    function renderTreemap(state, plot, isInitial) {
        const { report, f } = state;
        const outputContainer = getOutputContainer();
        clearIndicators();
        if (report.argById.size === 0) {
            outputContainer.innerHTML = `<h2>階層表示</h2><p>arguments データが見つからないため、階層表示では検索できません。</p>`;
            if (isInitial) alert("arguments data not found in page; 階層表示では検索できません。");
            return;
        }
        const matched = [...report.argById.values()].filter(a => reportArgMatches(report, a, f));
        if (matched.length === 0) {
            outputContainer.innerHTML = `<h2>Tracked Opinions (階層)</h2><p>該当する意見がありません。</p>`;
            if (isInitial) alert(`No entries found matching filter.`);
            return;
        }
        const clusterHits = new Map();
        matched.forEach(a => addClusterHits(clusterHits, a));
        const matchedIds = new Set(matched.map(a => String(a.arg_id)));
        let selected = null;

        /* ツリーマップのタイルに枠を付ける: 該当意見を含むクラスタ・該当意見はオレンジ、選んだ意見とその上位クラスタは赤 */
        const paint = () => {
            const selectedPath = new Set();
            if (selected) {
                selectedPath.add(selected);
                const a = report.argById.get(selected);
                ((a && a.cluster_ids) || []).forEach(id => selectedPath.add(String(id)));
            }
            plot.querySelectorAll('g.slice').forEach(el => {
                const id = sliceId(el);
                const surface = el.querySelector('path.surface') || el.querySelector('path');
                if (!surface || id === null) return;
                if (surface.dataset.revealOrigStroke === undefined) {
                    surface.dataset.revealOrigStroke = surface.style.stroke || "";
                    surface.dataset.revealOrigStrokeWidth = surface.style.strokeWidth || "";
                }
                if (selectedPath.has(id)) {
                    surface.style.stroke = 'red';
                    surface.style.strokeWidth = '4px';
                } else if (clusterHits.has(id) || matchedIds.has(id)) {
                    surface.style.stroke = 'rgb(255, 140, 0)';
                    surface.style.strokeWidth = '3px';
                } else {
                    surface.style.stroke = surface.dataset.revealOrigStroke;
                    surface.style.strokeWidth = surface.dataset.revealOrigStrokeWidth;
                }
            });
        };
        state.repaint = paint;
        paint();
        attachPlotHandler(plot, 'plotly_afterplot', paint);

        const items = matched.map(a => {
            const path = clusterPathHtml(report, a);
            return `<li data-arg="${escapeHtml(a.arg_id)}" style="cursor:pointer;" title="クリックで階層上の位置を赤枠で表示">` +
                `<strong>arg_id:</strong> ${escapeHtml(a.arg_id)}, <strong>comment_id:</strong> ${escapeHtml(a.comment_id !== undefined ? a.comment_id : "N/A")}` +
                (path ? `<br>${path}` : "") + `<br>${escapeHtml(a.argument)}</li>`;
        }).join("");
        outputContainer.innerHTML = `${clusterListHtml(report, clusterHits)}<h2>Tracked Opinions (階層, ${matched.length}件)</h2>` +
            `<p style="font-size:13px;">オレンジ枠: 該当意見を含むクラスタ。赤枠: 選んだ意見とその上位クラスタ。タイルをクリックすると下の階層に入れます。テキストは本文と所属クラスタ名で照合します。</p><ul>${items}</ul>`;

        const selectArg = argId => {
            const li = outputContainer.querySelector(`li[data-arg="${CSS.escape(argId)}"]`);
            if (!li) return null;
            outputContainer.querySelectorAll('li[data-arg]').forEach(x => { x.style.outline = ''; });
            li.style.outline = '3px solid red';
            li.style.outlineOffset = '2px';
            selected = argId;
            paint();
            return li;
        };
        outputContainer.onclick = e => {
            const li = e.target.closest('li[data-arg]');
            if (!li) return;
            selectArg(li.dataset.arg);
            plot.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        /* 意見のタイルをクリック: 一覧の該当行へ（ページ側の階層移動はそのまま動く） */
        attachPlotHandler(plot, 'plotly_click', ev => {
            const pt = ev && ev.points && ev.points[0];
            if (!pt || pt.id === undefined || !matchedIds.has(String(pt.id))) return;
            const li = selectArg(String(pt.id));
            if (li) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        if (isInitial) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function render(state, isInitial) {
        const plot = findPlot();
        if (state.plot && state.plot !== plot) detachPlotHandlers(state.plot);
        state.repaint = null;
        if (!plot || !plot.data) {
            if (isInitial) alert("Plotly graph not found or invalid.");
            return;
        }
        detachPlotHandlers(plot);
        state.plot = plot;
        state.data = plot.data;
        state.mode = plotMode(plot);
        try {
            if (state.mode === "treemap") renderTreemap(state, plot, isInitial);
            else renderScatter(state, plot, isInitial);
        } catch (error) {
            if (isInitial) alert("An error occurred: " + error.message);
            console.error("Error during bookmarklet execution:", error);
        }
    }

    function run(filters) {
        const f = {
            targetText: filters.text.trim() !== "" ? filters.text : null,
            argIdTerms: filters.argIds,
            commentPart: filters.commentPart
        };
        if (f.targetText === null && f.argIdTerms.length === 0 && f.commentPart === "") {
            alert("No text filter applied.");
        }
        let report = { argById: new Map(), clusterById: new Map() };
        try {
            report = loadReportData();
        } catch (e) {
            console.warn("Failed to read arguments/clusters from page data:", e);
        }
        if (f.commentPart !== "" && report.argById.size === 0) {
            console.warn("arguments data not found in page; comment_id filter can only use customdata.comment_id.");
        }
        const state = { f, report, plot: null, data: null, mode: null, repaint: null, observer: null };
        state.detach = () => detachPlotHandlers(state.plot);
        window[STATE_KEY] = state;
        render(state, true);

        /* 表示切替（全体図・詳細クラスタ・階層など）でグラフが作り直されたら、同じ条件で表示し直す */
        let timer = null;
        state.observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const plot = findPlot();
                if (!plot || !plot.data) return;
                if (plot !== state.plot || plot.data !== state.data || plotMode(plot) !== state.mode) {
                    render(state, false);
                } else if (state.repaint) {
                    state.repaint();
                }
            }, 300);
        });
        state.observer.observe(document.body, { childList: true, subtree: true });
    }

    askFilters().then(filters => {
        if (filters === null) {
            alert("Operation cancelled.");
            return;
        }
        run(filters);
    });
})();