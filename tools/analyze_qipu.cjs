/*
 * 棋谱逐手复盘（离线，构建期跑一遍）
 * ------------------------------------------------------------
 * 读 assets/qipu/_games.json，交给 Rapfi（连珠规则）把每一手之后的局面重算一遍，
 * 结果写到 assets/qipu/eval/<id>.json，再由 build_qipu.py 并进单局数据，
 * 访客点开时不用等引擎。
 *
 *   node tools/analyze_qipu.cjs            有缓存就跳过
 *   node tools/analyze_qipu.cjs --force    全部重算
 *
 * 输出里 b 是「黑方胜率」（0-1），top 是引擎在该局面的首选点（"x,y"）。
 * 引擎报的 WINRATE 是走子方视角，所以要按轮次翻成黑方视角——这个约定
 * 已用「黑天元、白未落」的局面核过：引擎给 0.35，即黑 0.65。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'assets', 'engine');
const GAMES = path.join(ROOT, 'assets', 'qipu', '_games.json');
const EVAL_DIR = path.join(ROOT, 'assets', 'qipu', 'eval');

const TURN_MS = 300;           // 每个局面的思考时间
const MIN_MOVES = 4;           // 太短的记录（弃权、中止）不值得复盘

const src = fs.readFileSync(path.join(ENGINE, 'rapfi-single.js'), 'utf8');
const makeRapfi = new Function('require', '__dirname', '__filename', 'module', 'exports',
    src + '\n;return Rapfi;');
const Rapfi = makeRapfi(require, __dirname, __filename, module, exports);

function hashMoves(moves) {
    let h = 2166136261;
    for (const [x, y] of moves) {
        h = (h ^ (x * 16 + y)) * 16777619 >>> 0;
    }
    return h.toString(36);
}

(async () => {
    if (!fs.existsSync(GAMES)) {
        console.log('！缺少 assets/qipu/_games.json，先跑 python tools/build_qipu.py --no-eval');
        process.exit(1);
    }
    const games = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
    fs.mkdirSync(EVAL_DIR, { recursive: true });

    let lines = [];
    const m = await Rapfi({
        locateFile: (p) => path.join(ENGINE, p),
        onReceiveStdout: (l) => lines.push(l),
        onReceiveStderr: () => {},
        onExit: () => {}
    });
    m.sendCommand('START 15');
    m.sendCommand('INFO rule 4');
    m.sendCommand('INFO show_detail 2');
    m.sendCommand('INFO thread_num 1');

    function analyze(moves) {
        const board = moves.map(([x, y], i) => x + ',' + y + ',' + (i % 2 === 0 ? 1 : 2));
        lines = [];
        m.sendCommand('INFO timeout_match 0');
        m.sendCommand('INFO timeout_turn ' + TURN_MS);
        m.sendCommand(['YXBOARD'].concat(board).concat(['DONE']).join('\n'));
        m.sendCommand('YXNBEST 1');

        let w = null, best = '', depth = 0;
        for (const l of lines) {
            if (l.indexOf('INFO WINRATE ') === 0) {
                w = parseFloat(l.slice(13));
            } else if (l.indexOf('INFO BESTLINE ') === 0) {
                best = l.slice(14).trim().split(/\s+/)[0] || best;
            } else if (l.indexOf('INFO DEPTH ') === 0) {
                depth = parseInt(l.slice(11), 10) || depth;
            } else if (/^\d+,\d+$/.test(l)) {
                best = l;
            }
        }
        return { w, best, depth };
    }

    const force = process.argv.includes('--force');
    const started = Date.now();
    let done = 0, skipped = 0, wasted = 0;
    const total = games.length;

    for (const g of games) {
        const out = path.join(EVAL_DIR, g.id + '.json');
        const hash = hashMoves(g.moves);
        if (!force && fs.existsSync(out)) {
            try {
                const old = JSON.parse(fs.readFileSync(out, 'utf8'));
                if (old.hash === hash && old.ms === TURN_MS) {
                    skipped++;
                    continue;
                }
            } catch (e) { /* 坏了就重算 */ }
        }
        if (g.moves.length < MIN_MOVES) {
            skipped++;
            continue;
        }

        const pos = [];
        const n = g.moves.length;
        let maxDepth = 0;
        for (let k = 0; k < n; k++) {
            const r = analyze(g.moves.slice(0, k));
            if (r.depth > maxDepth) { maxDepth = r.depth; }
            if (r.w === null || !isFinite(r.w)) {
                /* 空盘那一步引擎不肯给胜率，按五五开算，好让第一手的落差说得通 */
                pos.push({ k, b: k === 0 ? 0.5 : null, top: r.best || '' });
                wasted++;
                continue;
            }
            const black = (k % 2 === 0) ? r.w : 1 - r.w;
            pos.push({ k, b: Math.round(black * 1000) / 1000, top: r.best || '' });
        }

        fs.writeFileSync(out, JSON.stringify({
            id: g.id,
            hash: hash,
            ms: TURN_MS,
            n,
            depth: maxDepth,
            engine: 'Rapfi · 连珠规则',
            pos
        }));
        done++;
        const el = (Date.now() - started) / 1000;
        const eta = done ? (el / done) * (total - done - skipped) : 0;
        console.log('  %s  %d 手  %ds  (剩约 %d 分)',
            String(g.id).padStart(5), n, Math.round(el),
            Math.round(eta / 60));
    }

    console.log('复盘完成：%d 局新算，%d 局用缓存，%d 个局面没结果，共 %d 秒',
        done, skipped, wasted, Math.round((Date.now() - started) / 1000));
})();
