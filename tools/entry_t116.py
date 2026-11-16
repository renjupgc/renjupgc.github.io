# -*- coding: utf-8 -*-
"""补录 2023 年第五届全国智力运动会河南省五子棋选拔赛（t116）。

成绩据赛后公布的对阵表逐轮照录：先手在左、后手在右，
0:1 记后手胜，+:- 记后手弃权、-:+ 记先手弃权、-:- 记双方弃权。
"""
import sqlite3
import sys

DB = 'data/renju.db'
TID = 116
DATE = '2023-05-13'

# 编号 —— 姓名：名单按秩序册编号，13 号全场未出场（对阵表里没有），故缺
NO = {
    1: '陈冲', 2: '陈涛', 3: '陈向新', 4: '董新武', 5: '邹澔非', 6: '郭百青',
    7: '何山', 8: '黄健光', 9: '李伯杨', 10: '李永飞', 11: '梁中', 12: '刘梦珂',
    14: '毛玮铭', 15: '乔仕鑫', 16: '任治国', 17: '沈杨帆', 18: '宋之杰',
    19: '唐悦', 20: '王红波', 21: '杨宝宝', 22: '张夏玲', 23: '张毅香',
    24: '赵彦青', 25: '赵云辉',
}
# 秩序册写作「赵彦清」「高澔非」，实为赵彦青、邹澔非
ALIAS = {'赵彦清': '赵彦青', '高澔非': '邹澔非'}

UNIT = {
    '邹澔非': '河南科技大学', '宋之杰': '河南工学院', '乔仕鑫': '黄河科技学院',
    '刘梦珂': '河南经贸职业学院', '沈杨帆': '许昌学院', '赵彦青': '河南警察学院',
    '张毅香': '河南轻工职业学院', '唐悦': '漯河医学高等专科学校',
}

# (轮次, 台次, 先手号, 后手号, 结果)
#   '1' 先手胜 / '0' 后手胜 / 'd' 和 / '0f' 后手弃权 / 'f0' 先手弃权 / 'ff' 双弃
R = [
    (1, 1, 1, 14, '0'), (1, 2, 15, 2, '0'), (1, 3, 3, 16, '0'),
    (1, 4, 17, 4, '0'), (1, 5, 5, 18, '1'), (1, 6, 19, 6, '0f'),
    (1, 7, 7, 20, '0'), (1, 8, 21, 8, 'f0'), (1, 9, 9, 22, '0'),
    (1, 10, 23, 10, '0'), (1, 11, 11, 24, '1'), (1, 12, 25, 12, '1'),

    (2, 1, 2, 19, '1'), (2, 2, 4, 25, '1'), (2, 3, 14, 5, '1'),
    (2, 4, 8, 11, '1'), (2, 5, 10, 16, '0'), (2, 6, 20, 22, '0'),
    (2, 7, 18, 1, '1'), (2, 8, 24, 3, '1'), (2, 9, 6, 15, 'f0'),
    (2, 10, 12, 7, '0'), (2, 11, 17, 9, '1'), (2, 12, 23, 21, '0f'),

    (3, 1, 14, 2, '1'), (3, 2, 16, 4, 'd'), (3, 3, 22, 8, '0'),
    (3, 4, 5, 20, '1'), (3, 5, 7, 18, '0'), (3, 6, 19, 10, '0'),
    (3, 7, 11, 23, '1'), (3, 8, 15, 24, '0'), (3, 9, 25, 17, '0'),
    (3, 10, 1, 9, '1'), (3, 11, 3, 12, '1'), (3, 12, 21, 6, 'ff'),

    (4, 1, 8, 14, '1'), (4, 2, 4, 2, '1'), (4, 3, 16, 5, 'd'),
    (4, 4, 10, 22, '1'), (4, 5, 17, 11, '0'), (4, 6, 18, 24, '1'),
    (4, 7, 20, 1, '1'), (4, 8, 23, 3, '1'), (4, 9, 19, 7, '0'),
    (4, 10, 25, 15, '1'), (4, 11, 9, 12, '0'),

    (5, 1, 4, 8, '1'), (5, 2, 11, 16, '0'), (5, 3, 14, 18, '1'),
    (5, 4, 5, 10, '0'), (5, 5, 2, 25, '1'), (5, 6, 7, 23, '1'),
    (5, 7, 22, 17, 'd'), (5, 8, 24, 20, '0'), (5, 9, 12, 1, '1'),
    (5, 10, 15, 19, '1'), (5, 11, 3, 9, '1'),

    (6, 1, 10, 4, '0'), (6, 2, 8, 16, '1'), (6, 3, 7, 14, '0'),
    (6, 4, 20, 2, '0'), (6, 5, 18, 11, '0'), (6, 6, 17, 5, '0'),
    (6, 7, 22, 3, '1'), (6, 8, 12, 15, '0'), (6, 9, 24, 23, '0'),
    (6, 10, 1, 25, '0'), (6, 11, 9, 19, '1'),

    (7, 1, 4, 14, 'd'), (7, 2, 2, 8, '0'), (7, 3, 11, 10, '0'),
    (7, 4, 16, 22, '1'), (7, 5, 5, 7, '1'), (7, 6, 15, 20, '0'),
    (7, 7, 25, 18, '1'), (7, 8, 23, 17, '0'), (7, 9, 3, 1, '1'),
    (7, 10, 9, 24, '1'), (7, 11, 19, 12, '0'),
]

WIN = {'1': ('1', '1-0'), '0': ('0', '0-1'), 'd': ('0.5', '½-½'),
       '0f': ('0f', '+-'), 'f0': ('f0', '-+'), 'ff': ('ff', '--')}

DESC = ('7 轮瑞士制。秩序册编号到 25 号，13 号全场未出场，对阵表里只出现 24 人。'
        '成绩据赛后公布的对阵表逐轮录入：先手在左、后手在右，0:1 记后手胜，'
        '+:- 记后手弃权、-:+ 记先手弃权、-:- 记双方弃权。郭百青、杨宝宝自第一轮起'
        '未到场，两人第三轮相遇记双弃，其后退出。弃权台不计等级分。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    roster = {no: ALIAS.get(n, n) for no, n in NO.items()}

    # 赛事信息
    d.execute('update tournaments set date=?, organizer=?, rules=?, time_limit=?,'
              ' chief_arbiter=?, participants=?, description=? where id=?',
              (DATE, '河南省全民健身中心', '山口规则', None, '赵严',
               ','.join(roster[no] for no in sorted(roster)), DESC, TID))

    # 名单
    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(roster):
        name = roster[no]
        d.execute('insert into players(tournament_id, player_no, name, unit)'
                  ' values(?,?,?,?)', (TID, no, name, UNIT.get(name, '')))

    # 对局：已有的按 (双方) 认领，保留 id 与棋谱，只纠正轮次/台次
    have = {}
    for r in d.execute('select id, round, board_number, player1, player2 from matches'
                       ' where tournament_id=?', (TID,)):
        have[frozenset((r['player1'], r['player2']))] = dict(r)
    used = set()
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    new = fix = 0
    for rd, board, a, b, res in R:
        p1, p2 = roster[a], roster[b]
        w, rs = WIN[res]
        key = frozenset((p1, p2))
        if key in have:
            mid = have[key]['id']
            used.add(mid)
            d.execute('update matches set round=?, board_number=?, player1=?, player2=?,'
                      ' winner=?, result=?, date=? where id=?',
                      (rd, board, p1, p2, w, rs, DATE, mid))
            fix += 1
        else:
            d.execute('insert into matches(id, tournament_id, round, board_number,'
                      ' player1, player2, winner, result, date, board_record,'
                      ' swap_sequence, five_a, unplayed, walkover)'
                      ' values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                      (nid, TID, rd, board, p1, p2, w, rs, DATE))
            nid += 1
            new += 1

    left = [v for k, v in have.items() if v['id'] not in used]
    if left:
        print('！ 未认领的旧对局:', left)
        for v in left:
            d.execute('delete from matches where id=?', (v['id'],))
        print('   已删除 %d 台（与对阵表对不上）' % len(left))

    # 新面孔先在等级分表里占一行（地区/学校），分数由重算脚本填
    for no in sorted(roster):
        name = roster[no]
        if not d.execute('select 1 from ratings where name=?', (name,)).fetchone():
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,?,?,NULL,0,0,0,0,NULL,"",1,NULL)',
                      (name, '', UNIT.get(name, '')))
        elif UNIT.get(name):
            d.execute('update ratings set university=? where name=? and'
                      ' (university is null or university="")', (UNIT[name], name))

    d.commit()
    print('台次 %d（新录 %d，纠正 %d） 名单 %d 人' % (len(R), new, fix, len(roster)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
