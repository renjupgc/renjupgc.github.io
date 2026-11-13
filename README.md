# 连珠杂箱

连珠（五子棋）爱好者的资料站点：赛事报道与赛后记、比赛成绩与对局记录、等级分，外加几个自己用得上的小工具。

纯静态站，托管在 GitHub Pages，直接以 `main` 分支根目录发布。没有框架、没有打包步骤，页面是手写的 HTML，重复的部分（页头、导航、页脚、音乐盒、无刷新跳转）由 `assets/layout.js` 在运行时注入。

在线地址：<https://renjupgc.github.io/>

## 目录

```
index.html            首页：棋手搜索、公告、最近更新
zalun.html  zashi.html  zayu.html  zaji.html     四个栏目页
404.html              找不到页面时的兜底

posts/                文章页（24 篇），自成一体，只有正文在 HTML 里
zayu/                 杂豫：赛事、成绩与棋手
  t{id}.html          每场赛事一页：赛事信息 + 成绩表
  p/{姓名}.html       每位棋手一页：等级分、参赛记录、逐局战绩（354 页）
  rating.html         等级分总表
  renwu.html          人物小传
zaji/                 杂技：工具页
  dapu.html           打谱（含图片认谱）
  molun.html          末轮计算器（含成绩单 OCR）
  predict.html        胜率预测
  jinzhao.html        禁手找茬
  vcf.html            VCF 做题
bisai/index.html      单届选拔赛成绩表，浏览器里用 sql.js 读 bisai.db

assets/
  style.css           全站样式（唯一一份）
  layout.js           页头/页脚/音乐盒/无刷新跳转
  board.js            棋盘渲染与交互
  players.js          棋手搜索索引（脚本生成）
  qipu.js  qipu/      棋谱数据与复盘（脚本生成）
  predict.js          预测模型参数与交手记录（脚本生成）
  engine/             Rapfi 引擎 wasm
  vendor/sqljs/       浏览器端 SQLite
  img/  audio/        配图与音乐

data/
  renju.db            赛事主库：tournaments / matches / ratings / players
  manual.db           手工补丁：改名、弃权、隐藏赛事、名次修正

tools/                构建脚本（见下）
docs/ROADMAP.md       改进建议与创意清单
```

## 本地预览

页面用了 `fetch` 做站内无刷新跳转，`bisai/` 还要读 `.db`，所以必须走 http，不能直接双击打开：

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 构建

页面分两类：手写的（首页、栏目页、文章页、工具页）和生成的（赛事页、棋手页、索引数据）。改了 `data/renju.db` 之后按顺序跑：

```bash
python tools/build_zayu.py       # 赛事页 + 等级分表 + zayu.html
python tools/build_players.py    # 棋手主页，并给等级分表里的姓名补内链
python tools/build_qipu.py       # 从 matches.board_record 导出棋谱 JSON
python tools/build_predict.py    # 预测页的模型参数与交手记录
python tools/build_seo.py        # canonical / og: / sitemap / robots / feed / 分享图
python tools/build_img_attrs.py  # 图片尺寸、懒加载
```

后两个是「全站扫一遍」的脚本，可反复执行（幂等）：手写页面加了新文章、换了配图之后单独跑它们就行。

依赖只有 Python 3 标准库，没有第三方包。

## 写页面的约定

- `<body data-nav="杂论" data-base="../">`：`data-nav` 决定导航高亮，`data-base` 是到站点根的相对前缀（根目录页面留空，子目录写 `../`）。
- 每页保留 `<div id="site-header"></div>` 和 `<main>`，`layout.js` 依赖它们。
- 站内跳转不整页刷新，只换 `<main>`。因此：
  - 页面专属样式要写在 `<head>` 的 `<style>` 里（会被带过去），不要写在 `<main>` 内联。
  - 页面自己的 `<script>` 会被补跑一次，代码要能重复执行而不出错。
- 文章页的日期只写在栏目页的列表里（`<span class="date">`），`build_seo.py` 从那里反查，无需在文章页另立字段。

## 部署

推到 `main` 即发布，GitHub Pages 一两分钟内生效。
