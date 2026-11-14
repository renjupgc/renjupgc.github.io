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
  t{id}.html          每场赛事一页：赛事信息 + 成绩表；名称含「高校」「大学生」的
                      页头再标「选手平均等级分 + 等级」两个徽标（只给平均分与对应等级，
                      不列个人档位）
  p/{姓名}.html       每位棋手一页：等级分走势、参赛记录、逐局战绩、成绩卡
                      （只给 data/public_players.txt 名单里的人出页，现 354 页）
  rating.html         等级分总表（页角挂时光机入口）
  shiguang.html       等级分时光机：拖时间轴看每个比赛日的先验榜单
                      不单独列出，也不进 sitemap：只从 rating.html 的页角进
  renwu.html          人物小传
zaji/                 杂技：工具页
  dapu.html           打谱（含开局命名、同型局、图片认谱）
  molun.html          末轮计算器（含成绩单 OCR）
  predict.html        胜率预测
  jinzhao.html        禁手找茬
  vcf.html            VCF 做题
bisai/index.html      单届选拔赛成绩表，浏览器里用 sql.js 读 bisai.db
api/duiju/            只读 JSON 接口（Actions 定时生成并提交，Pages 直接发）
  index.json          赛事与轮次索引
  shanhai/r1.json     山海杯第 1 轮：逐台对局与预测概率

assets/
  style.css           全站样式（唯一一份）
  layout.js           页头/页脚/音乐盒/无刷新跳转
  board.js            棋盘渲染与交互
  players.js          棋手搜索索引（脚本生成）
  rating-history.js   等级分时序，时光机与棋手曲线共用（脚本生成）
  openings-data.js    有手顺的对局语料，开局与同型检索用（脚本生成）
  openings.js         26 开局命名 + 225 维向量同型检索
  timemachine.js      时光机页面逻辑
  playercard.js  qr.js  棋手成绩卡（Canvas 出图，二维码自研编码）
  qipu.js  qipu/      棋谱数据与复盘（脚本生成）
  predict.js          预测模型参数与交手记录（脚本生成）
  engine/             Rapfi 引擎 wasm
  vendor/sqljs/       浏览器端 SQLite
  img/  audio/        配图与音乐

data/
  renju.db            赛事主库：tournaments / matches / ratings / players
  manual.db           手工补丁：补录赛事与对局、改名、弃权、隐藏赛事、名次修正
  public_players.txt  可公开的棋手名单：名册之外不出页、不进搜索、不挂内链
  rating_excluded.txt 不计等级分的赛事（非公开进行）：公示表与时光机都按它排除
  duiju.db            对局库：逐台对局 + 预测概率（山海杯等），api/duiju/ 由它导出
  shanhai/2026-r1.json  山海杯第 1 轮的录入源文件（一轮一份）

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
python tools/build_zayu.py            # 赛事页 + 等级分表 + zayu.html
python tools/build_rating_history.py  # 按比赛日先验重放，导出等级分时序 JSON
python tools/build_players.py         # 棋手主页（含走势图），并给等级分表里的姓名补内链
python tools/build_qipu.py            # 从 matches.board_record 导出棋谱 JSON
python tools/build_openings.py        # 导出有手顺的对局语料（开局命名 / 同型检索）
python tools/build_predict.py    # 预测页的模型参数与交手记录
python tools/build_seo.py        # canonical / og: / sitemap / robots / feed / 分享图
python tools/build_img_attrs.py  # 图片尺寸、懒加载
```

后两个是「全站扫一遍」的脚本，可反复执行（幂等）：手写页面加了新文章、换了配图之后单独跑它们就行。

## 对局库与预测接口（duiju.db）

山海杯这类「逐台预测」的页面不再把数据写进 HTML。库里只放对局（台次、双方编号与姓名、
赛果）和预测概率；等级分只留在录入源文件里，分数按前几轮赛果现算，两者都不入库。
`tools/manage_duiju.py` 负责把一轮对局录进去、再摊成站点上的 JSON。页面读的
`api/duiju/` 由 GitHub Actions 定时从库里重出并提交，仓库里没有服务器进程。

```
data/shanhai/2026-r1.json   一轮的录入源文件：台号、黑白双方、等级分、预测概率
        │  record
        ▼
data/duiju.db              唯一的数据源（tournaments / rounds / games）
        │  export
        ▼
api/duiju/index.json       赛事与轮次索引
api/duiju/shanhai/r1.json  单轮：赛事信息 + 23 台对局 + 预测
        │  fetch
        ▼
posts/2026-shanhai-r1.html 照接口画表格；同一页用 ?r=N 换轮，不再一轮一个文件
```

```bash
python tools/manage_duiju.py all data/shanhai/2026-r1.json   # 录入 + 导出
python tools/manage_duiju.py sync                            # 重录 data/ 下所有轮次 + 导出
python tools/manage_duiju.py export                          # 只导出
python tools/manage_duiju.py result --tid 2026-shanhai --round 1 --table 3 --value B
python tools/manage_duiju.py show                            # 库里有什么
```

**后端就是 Actions，不是服务器。** `.github/workflows/update-duiju.yml` 每 30 分钟
（另外在推送 `data/shanhai/`、`tools/manage_duiju.py` 或手动触发时）跑一次
`python tools/manage_duiju.py sync`，把仓库里的轮次 JSON 重录进 `duiju.db`、重出
`api/duiju/`，有变化就由 `github-actions[bot]` 提交回 main；Pages 随即把新的 JSON 发出去。
做法照搬 renju4433.github.io 的 `update-bisai.yml`：定时 + 手动 + 路径触发，`contents: write`，
同一个 concurrency 组防并发。

`record` / `sync` / `export` 都是幂等的：数据没变时库和 `api/` 下的文件一个字节都不动
（导出不写时间戳），定时任务不会刷空提交；JSON 里 `result` 为 `null` 时不覆盖库里已经
记下的赛果，所以赛果既可以写在 JSON 里，也可以事后用 `result` 命令补。

`record` 整轮覆盖写库，可反复执行；一轮的 JSON（`rating` 只是给源文件留个底，
不入库、不进接口）：

```json
{
  "tournament": {"id": "2026-shanhai", "name": "「山海杯」2026 年全国五子棋业余棋王争霸赛线下总决赛",
                 "year": 2026, "group": "公开组", "rule": "塔拉山口-10", "slug": "shanhai"},
  "round": 1,
  "predicted_at": "2026-11-14 01:29:38",
  "model": "gbdt-20260704",
  "games": [
    {"table": 1,
     "black": {"no": 1, "name": "王俊锴", "rating": 2347.3},
     "white": {"no": 24, "name": "马子轩", "rating": 2164.7},
     "prediction": {"black": 65.6, "draw": 9.3, "white": 25.2},
     "result": null}
  ]
}
```

`prediction` 缺省表示这一轮还没跑预测；`result` 取 `B`（黑胜）/`W`（白胜）/`D`（和），
有值后页面会在概率块上方挂一个比分标签。台次旁的「N 分」是这一轮开赛前的累计分，
由库里前几轮的 `result` 现算，不进库。

页面：<https://renjupgc.github.io/posts/2026-shanhai-r1.html>，`?r=2` 之类切到别的轮次。
旧的 `posts/2026-shanhai-cup-r1.html` 已删除；那份单页 HTML 里的数据与样式都不再是本页的来源。
`data/duiju.db` 和 `api/duiju/` 都要提交：前者是源，后者才是线上被读的那份。

补录赛事与对局（源备份库不在手边时也走这条路）：在 `data/manual.db` 的 `tournaments_extra`、
`matches_extra` 各插一行——只收录部分对局时，`total_rounds` 填规程里的总轮数，页面靠它显示「共几轮」；
再往 `data/renju.db` 补同一条，然后

```bash
python tools/recompute_ratings.py     # 重算全表：WHR 是全历史拟合，多一场早期赛事会牵动所有人
python tools/build_zayu.py --rebuild  # 重出赛事页（沿用库内快照，不重算等级分）
```

`zayu.html` 的赛事名单是手工挑的，新赛事要自己加一行 `<li>`，`build_zayu.py` 只照这份名单出页。

`data/public_players.txt` 是可公开的棋手名单：`zayu/p/` 只给名单里的人出页，站内搜索与等级分表的
内链也只认这份名单。名单之外的人照旧出现在成绩表里（那是赛事记录），但不单独出页、不进搜索。
补人时确认后往名单里加一行，重跑 `build_players.py`。

`data/rating_excluded.txt` 是不计等级分的赛事：非公开进行的比赛（不对外报名、不公示成绩、站上
不出赛事页）留在库里备查，但不进 WHR 计算。`build_zayu.py`、`recompute_ratings.py`、
`build_rating_history.py` 读的是同一份名单，所以公示表与时光机末帧逐人相等；改完重跑
`build_rating_history.py` 与 `build_players.py` 即可。

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
