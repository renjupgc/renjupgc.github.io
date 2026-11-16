# -*- coding: utf-8 -*-
"""录入 2022 年河南省全民健身运动会五子棋比赛（成人公开组，t115）。

11 轮积分编排制，168 人报名（公示名次表 138 人，另有 30 人全程未得分或未到场）。
成绩据赛后公布的逐轮对阵表逐轮录入（数据见 data_t121.py）：
对阵表左栏是奇数台、右栏是偶数台，结果按「左:右」记——
1:0 左胜 / 0:1 右胜 / 0.5:0.5 和 / 1+:0- 右方弃权 / 0-:1+ 左方弃权 / 0-:0- 双弃。

表里每个棋手姓名后带的积分是「本轮开赛前」的累计分，逐轮核对过：按本文件的
结果码累加，与公示名次表 138 人的总积分逐人相符（退赛后不参与排名的孙俊强除外）。

乔天皓即乔仕鑫、高澔非即邹澔非，已按站内用名归一。
"""
import os
import sqlite3
import sys

import data_t121 as D

DB = 'data/renju.db'
TID = 115
DATE = '2022-11-10'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADULT_FILE = os.path.join(ROOT, 'data', 'adult_players.txt')
PUBLIC_FILE = os.path.join(ROOT, 'data', 'public_players.txt')

CODE = {
    '1:0': ('1', '1-0'), '0:1': ('0', '0-1'), '0.5:0.5': ('0.5', '½-½'),
    '1+:0-': ('0f', '+-'), '0-:1+': ('f0', '-+'), '0-:0-': ('ff', '--'),
    'BYE': ('1', '1-0'),
}

# 公示名次表的「单位」一栏 -> (地区, 是否高校)
UNITS = {
    # —— 河南高校
    '郑州轨道工程职业学院': ('河南省 郑州市', 1),
    '商丘师范学院': ('河南省 商丘市', 1),
    '河南财经政法大学': ('河南省 郑州市', 1),
    '河南中医药大学': ('河南省 郑州市', 1),
    '河南工学院': ('河南省 新乡市', 1),
    '郑州师范学院': ('河南省 郑州市', 1),
    '南阳师范学院': ('河南省 南阳市', 1),
    '河南科技大学': ('河南省 洛阳市', 1),
    '鹤壁职业技术学院': ('河南省 鹤壁市', 1),
    '安阳工学院': ('河南省 安阳市', 1),
    '安阳学院': ('河南省 安阳市', 1),
    '郑州轻工业大学': ('河南省 郑州市', 1),
    '郑州经贸学院': ('河南省 郑州市', 1),
    '郑州科技学院': ('河南省 郑州市', 1),
    '河南经贸职业学院': ('河南省 郑州市', 1),
    '郑州大学': ('河南省 郑州市', 1),
    '南阳理工学院': ('河南省 南阳市', 1),
    '河南职业技术学院': ('河南省 郑州市', 1),
    '信阳农林学院': ('河南省 信阳市', 1),
    '焦作大学': ('河南省 焦作市', 1),
    '河南警察学院': ('河南省 郑州市', 1),
    '商丘工学院': ('河南省 商丘市', 1),
    '河南理工大学': ('河南省 焦作市', 1),
    '许昌学院': ('河南省 许昌市', 1),
    '河南科技学院': ('河南省 新乡市', 1),
    '河南牧业经济学院': ('河南省 郑州市', 1),
    '河南师范大学': ('河南省 新乡市', 1),
    '黄河科技学院': ('河南省 郑州市', 1),
    '郑州工程技术学院': ('河南省 郑州市', 1),
    '洛阳文化旅游职业技术学院': ('河南省 洛阳市', 1),
    # —— 河南省内的个人/单位报名（非高校）
    '河南省郑州市': ('河南省 郑州市', 0),
    '河南省洛阳市西工区': ('河南省 洛阳市', 0),
    '新乡市': ('河南省 新乡市', 0),
    '禹州市': ('河南省 许昌市', 0),
    '新蔡县黄楼镇': ('河南省 驻马店市', 0),
    '洛阳市五子棋协会': ('河南省 洛阳市', 0),
    '洛阳五子棋协会': ('河南省 洛阳市', 0),
    '河南德弈五子棋俱乐部': ('河南省 郑州市', 0),
    '南阳棋院': ('河南省 南阳市', 0),
    '林州市临淇镇临淇完小': ('河南省 安阳市', 0),
    '李集镇大朱小学': ('河南省', 0),
    '祖师庙镇人民政府': ('河南省', 0),
    '学生': ('河南省', 0),
    '创新': ('河南省', 0),
    # —— 外省（一律不出个人主页）
    '山东省临沂第一中学': ('山东省 临沂市', 0),
    '天津市': ('天津市', 0),
    '盘山电厂': ('天津市', 0),
    '甘大棋联': ('甘肃省', 1),
    '宁波疏星棋院': ('浙江省 宁波市', 0),
    '上海外国语大学嘉定外国语学校': ('上海市', 0),
    '江西育华学校初中部': ('江西省 南昌市', 0),
    '绩溪县适之中学东山校区': ('安徽省 宣城市', 0),
    '芒市4小': ('云南省 德宏州', 0),
    '武汉工商学院': ('湖北省 武汉市', 1),
    '湖北武汉工商学院': ('湖北省 武汉市', 1),
    '武汉电力职业技术学院': ('湖北省 武汉市', 1),
    '西南民族大学': ('四川省 成都市', 1),
    '西北工业大学': ('陕西省 西安市', 1),
    '贵州中医药大学时珍学院': ('贵州省 贵阳市', 1),
    '芜湖职业技术学院': ('安徽省 芜湖市', 1),
}

DESC = (
    '2022 年河南省全民健身运动会五子棋比赛，成人公开组，11 轮积分编排制，'
    '168 人报名（公示名次表列 138 人，另有 30 人未到场或全程弃权）。'
    '2022 年 11 月 10 日线上举行，河南省全民健身中心主办，山口规则，裁判长赵严。'
    '成绩据赛后公布的逐轮对阵表录入：表中左栏是奇数台、右栏是偶数台，'
    '先手在左、后手在右，0:1 记后手胜，1+:0- 记后手弃权、0-:1+ 记先手弃权、'
    '0-:0- 记双方弃权，第 6、7、8、10、11 轮各有一人轮空。'
    '表内每个姓名后的积分是开赛前的累计分，逐轮核过，与公示名次表的总积分逐人相符。'
    '乔天皓、高澔非按站内用名记为乔仕鑫、邹澔非。'
    '任治国 9.5 分居首，陈涛、潘冠臣 9 分列二三位。'
)


def board_numbers(r):
    """该轮 PAIRS 顺序（先左栏奇数台、后右栏偶数台）对应的台号。"""
    n = len(D.PAIRS[r])
    return [b for b in range(1, n + 1, 2)] + [b for b in range(2, n + 1, 2)]


# 名次表「单位」栏为空、按外省计的个人，逐个点名（地区, 是否高校）
OVERRIDE = {
    '刘晋峰': ('天津市', 0),
    '洪婉茹': ('福建省 泉州市', 0),   # 福建南安
    '周旭红': ('陕西省', 0),
}


def classify(no):
    """(地区, 单位, 是否高校)。"""
    name = D.NO.get(no)
    if name in OVERRIDE:
        region, college = OVERRIDE[name]
        return region, D.UNIT.get(no, ''), college
    unit = D.UNIT.get(no, '')
    if not unit:
        return '河南省', '', 1
    region, college = UNITS.get(unit, (None, None))
    if region is None:
        # 兜底：单位里出现外省地名按外省记，其余按河南
        for k, v in (('武汉', '湖北省 武汉市'), ('山东', '山东省'), ('天津', '天津市'),
                     ('贵州', '贵州省'), ('陕西', '陕西省'), ('四川', '四川省'),
                     ('安徽', '安徽省'), ('江西', '江西省'), ('上海', '上海市'),
                     ('浙江', '浙江省'), ('云南', '云南省'), ('甘肃', '甘肃省'),
                     ('辽宁', '辽宁省'), ('湖南', '湖南省'), ('山西', '山西省')):
            if k in unit:
                region = v
                break
        else:
            region = '河南省'
        college = 1 if ('大学' in unit or '学院' in unit or '高等专科学校' in unit
                        or '专科学校' in unit) else 0
    return region, unit, college


def append_list(path, header, names):
    """把名单里没有的姓名追加到文件末尾（一行一个）。"""
    have = set()
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            have = {ln.strip() for ln in f if ln.strip() and not ln.startswith('#')}
    add = [n for n in names if n not in have]
    if not add:
        return []
    with open(path, 'a', encoding='utf-8') as f:
        f.write('\n' + header + '\n')
        for n in add:
            f.write(n + '\n')
    return add


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    names = [D.NO[i] for i in sorted(D.NO)]

    d.execute('update tournaments set name=?, date=?, organizer=?, rules=?, time_limit=?,'
              ' chief_arbiter=?, participants=?, description=?, group_name=? where id=?',
              ('2022年河南省全民健身运动会五子棋比赛', DATE, '河南省全民健身中心',
               '山口规则', None, '赵严', ','.join(names), DESC, '成人公开组', TID))

    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(D.NO):
        d.execute('insert into players(tournament_id, player_no, name, unit) values(?,?,?,?)',
                  (TID, no, D.NO[no], D.UNIT.get(no, '')))

    d.execute('delete from matches where tournament_id=?', (TID,))
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    total = 0
    for r in sorted(D.PAIRS):
        boards = board_numbers(r)
        for bd, (a, b), c in zip(boards, D.PAIRS[r], D.CODES[r]):
            w, rs = CODE[c]
            p2 = '轮空' if b is None else D.NO[b]
            d.execute('insert into matches(id, tournament_id, round, board_number, player1,'
                      ' player2, winner, result, date, board_record, swap_sequence, five_a,'
                      ' unplayed, walkover) values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                      (nid, TID, r, bd, D.NO[a], p2, w, rs, DATE))
            nid += 1
            total += 1

    # 等级分表：老棋手补空，新人按单位的地区/高校属性起一行
    played = set()
    for r in sorted(D.PAIRS):
        for (a, b), c in zip(D.PAIRS[r], D.CODES[r]):
            if c in ('1:0', '0:1', '0.5:0.5'):
                played.add(a)
                if b is not None:
                    played.add(b)
    old_names = {r['name'] for r in d.execute('select name from ratings')}
    for no in sorted(D.NO):
        name = D.NO[no]
        region, unit, college = classify(no)
        row = d.execute('select region, university from ratings where name=?',
                        (name,)).fetchone()
        if row and name in OVERRIDE:      # 点名校正的，直接覆盖
            d.execute('update ratings set region=?, college=?, university=? where name=?',
                      (region, college, row['university'], name))
        if row:
            if not (row['region'] or '').strip():
                d.execute('update ratings set region=? where name=?', (region, name))
            if unit and not (row['university'] or '').strip():
                d.execute('update ratings set university=? where name=?', (unit, name))
        else:
            d.execute('insert into ratings(name, region, university, rating, games, wins,'
                      ' draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,?,?,NULL,0,0,0,0,NULL,"",?,NULL)',
                      (name, region, unit, college))

    d.commit()

    # 新人按地区/是否高校分档：非河南的不出主页，非高校的记作成人棋手
    new_public, new_adult = [], []
    for no in sorted(D.NO):
        name = D.NO[no]
        if name in old_names:         # 老棋手，地区/高校属性早已定过，不动
            continue
        region, unit, college = classify(no)
        if no not in played:          # 全程弃权 / 未到场
            continue
        if '河南' in region:
            new_public.append(name)
        if not college:
            new_adult.append(name)

    pub = append_list(PUBLIC_FILE,
                      '# 2022 年河南省全民健身运动会五子棋比赛（成人公开组）出场的河南棋手',
                      new_public)
    adult = append_list(ADULT_FILE,
                        '# 2022 年河南省全民健身运动会五子棋比赛（成人公开组）出场的'
                        '成人（非高校）棋手',
                        new_adult)

    print('赛事 t%d：%d 轮 %d 台（对局 %d），报名 %d 人，实际出场 %d 人'
          % (TID, len(D.PAIRS), total, total, len(D.NO), len(played)))
    print('  新增可公开主页 %d 人；新增成人（非高校）%d 人' % (len(pub), len(adult)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %2d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
