# 连珠杂箱

连珠（五子棋）爱好者的资料站点：赛事报道与赛后记、比赛成绩与对局记录、等级分，
外加几个自己用得上的小工具。

线上地址：<https://renjupgc.github.io/>

纯静态站，没有任何框架和打包步骤：手写 HTML，推到 `main` 分支即由 GitHub Pages 发布。
页头、导航、页脚、无刷新跳转这些重复部分由 `assets/layout.js` 在运行时注入。

## 先看哪里

| 想做的事 | 看这里 |
| --- | --- |
| 搞清楚站点怎么搭的、每个目录放什么 | [DEVNOTES.md](DEVNOTES.md) |
| 本地跑起来预览 | `python -m http.server 8000`（必须走 http，不能双击打开） |
| 改了赛事数据要重新生成页面 | [DEVNOTES.md 的「构建」一节](DEVNOTES.md#构建) |
| 接账号 / 云端进度 | [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) |
| 还没做的想法 | [docs/ROADMAP.md](docs/ROADMAP.md) |

## 目录一览

```
index.html            首页
zalun.html            杂论：赛后记、裁判记与随想（页顶有文章意象词云）
zashi.html            杂史
zaxiang.html          杂想
zayu.html  zayu/      杂豫：赛事成绩、棋手主页、等级分总表与时光机
zaji.html  zaji/      杂技：打谱、末轮计算、胜率预测、VCF、连珠英语等工具
yuce.html             胜率与落子预测
posts/                文章页
assets/               样式、脚本、图片、音乐
data/                 数据库、词表、名册与统计素材
api/                  只读 JSON 接口（由 Actions 定时生成）
tools/                生成页面与数据的脚本
admin/                后台面板（暗门，不在导航里）
labs/                 未上线的试验页
bisai/                单届选拔赛成绩表
renju/                第三方 Otter Renju 的静态构建（给 zaji/katago.html 供模型与运行时）
supabase/             建表 SQL
```

## 本地预览

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 部署

推到 `main` 即发布，GitHub Pages 一两分钟内生效。
