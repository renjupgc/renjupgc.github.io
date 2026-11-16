# -*- coding: utf-8 -*-
"""录入 2023 年第五届全国智力运动会河南省五子棋选拔赛（第二期，成人组，t118）。

成绩据赛后公布的对阵表逐轮录入：每轮表格里「姓名 编号 本轮前积分」成对出现，
本轮结果由下一轮积分推得，与公示的成绩表逐人核对一致。对阵表未标先后手，
按表上左右次序记先手在左。
"""
import sqlite3
import sys

DB = 'data/renju.db'
TID = 118
DATE = '2023-06-18'

NO = {
    1: '董新武', 2: '黄健光', 3: '毛玮铭', 4: '李永飞', 5: '陈涛',
    6: '赵云辉', 7: '王红波', 8: '沈杨帆', 9: '何山', 10: '宋之杰',
    11: '陈向新', 12: '赵严', 13: '薛程程', 14: '李佳男', 15: '宋嫣娟',
    16: '温永彩', 17: '王海波', 18: '刘梦珂',
}
# 秩序册写作「薛成成」，实为薛程程
ALIAS = {'薛成成': '薛程程'}

UNIT = {'薛程程': '郑州大学', '沈杨帆': '许昌学院',
        '刘梦珂': '河南经贸职业学院', '宋之杰': '河南工学院'}

# (轮次, 台次, 先手号, 后手号, 结果)；后手号 0 表示轮空
#   '1' 先手胜 / '0' 后手胜 / 'd' 和 / '0f' 后手弃权 / 'f0' 先手弃权 / 'ff' 双弃
R = [
    (1, 1, 1, 9, '1'), (1, 2, 11, 2, 'f0'), (1, 3, 3, 12, '1'),
    (1, 4, 13, 4, '1'), (1, 5, 5, 14, '0'), (1, 6, 16, 6, '0'),
    (1, 7, 7, 17, 'd'), (1, 8, 18, 8, '0'),

    (2, 1, 6, 1, '0'), (2, 2, 2, 13, '1'), (2, 3, 8, 3, '0'),
    (2, 4, 14, 7, '0'), (2, 5, 17, 5, 'd'), (2, 6, 4, 16, '0'),
    (2, 7, 9, 18, '1'), (2, 8, 12, 0, '1'),

    (3, 1, 1, 3, 'd'), (3, 2, 7, 2, '0'), (3, 3, 13, 6, '1'),
    (3, 4, 14, 8, '1'), (3, 5, 16, 9, '1'), (3, 6, 12, 17, 'd'),
    (3, 7, 5, 4, '0'), (3, 8, 18, 0, '1'),

    (4, 1, 2, 1, '1'), (4, 2, 3, 13, '1'), (4, 3, 16, 14, '1'),
    (4, 4, 12, 7, 'd'), (4, 5, 17, 4, '0'), (4, 6, 6, 18, '1'),
    (4, 7, 8, 9, '1'), (4, 8, 5, 0, '1'),

    (5, 1, 3, 2, '0'), (5, 2, 1, 16, '1'), (5, 3, 4, 12, '0'),
    (5, 4, 8, 6, '1'), (5, 5, 7, 13, 'd'), (5, 6, 9, 14, '0'),
    (5, 7, 18, 5, '0'), (5, 8, 17, 0, '1'),

    (6, 1, 2, 8, '1'), (6, 2, 12, 1, '0'), (6, 3, 14, 3, '0'),
    (6, 4, 5, 16, 'd'), (6, 5, 4, 7, '0'), (6, 6, 9, 17, 'd'),
    (6, 7, 13, 18, '1'), (6, 8, 6, 0, '1'),

    (7, 1, 16, 2, 'd'), (7, 2, 1, 7, 'd'), (7, 3, 3, 5, '0'),
    (7, 4, 8, 13, '1'), (7, 5, 6, 14, '0'), (7, 6, 12, 9, '1'),
    (7, 7, 17, 18, '1'), (7, 8, 4, 0, '1'),
]

WIN = {'1': ('1', '1-0'), '0': ('0', '0-1'), 'd': ('0.5', '½-½'),
       '0f': ('0f', '+-'), 'f0': ('f0', '-+'), 'ff': ('ff', '--')}

DESC = ('7 轮积分编排制，成人组 18 人报名。2023 年 6 月 16—18 日在河南省全民健身中心'
        '四楼大厅举行，采用《中国五子棋竞赛规则》（2013 版）指定开局、三手可交换、'
        '五手 N 打，每方 30 分钟、每步加 15 秒。成绩据赛后公布的对阵表逐轮录入，'
        '对阵表未标先后手，按表上左右次序记先手在左。陈向新第一轮弃权、其后退出，'
        '宋之杰、宋嫣娟全程未出场，三人无对阵记录，成绩表里只列 16 人。轮空按 + 记。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    roster = {no: ALIAS.get(n, n) for no, n in NO.items()}

    cur = d.execute('select id from tournaments where id=?', (TID,)).fetchone()
    if cur:
        d.execute('update tournaments set name=?, date=?, organizer=?, rules=?,'
                  ' time_limit=?, chief_arbiter=?, participants=?, description=?,'
                  ' group_name=? where id=?',
                  ('2023年第五届全国智力运动会河南省五子棋选拔赛（第二期）', DATE,
                   '河南省全民健身中心', '指定开局、三手可交换、五手N打',
                   '30分钟+15秒/步', None,
                   ','.join(roster[no] for no in sorted(roster)), DESC,
                   '成人组', TID))
    else:
        d.execute('insert into tournaments(id, name, date, organizer, rules,'
                  ' time_limit, chief_arbiter, participants, description, group_name)'
                  ' values(?,?,?,?,?,?,?,?,?,?)',
                  (TID, '2023年第五届全国智力运动会河南省五子棋选拔赛（第二期）',
                   DATE, '河南省全民健身中心', '指定开局、三手可交换、五手N打',
                   '30分钟+15秒/步', None,
                   ','.join(roster[no] for no in sorted(roster)), DESC, '成人组'))

    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(roster):
        name = roster[no]
        d.execute('insert into players(tournament_id, player_no, name, unit)'
                  ' values(?,?,?,?)', (TID, no, name, UNIT.get(name, '')))

    d.execute('delete from matches where tournament_id=?', (TID,))
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    for rd, board, a, b, res in R:
        p1 = roster[a]
        p2 = '轮空' if b == 0 else roster[b]
        w, rs = WIN[res]
        d.execute('insert into matches(id, tournament_id, round, board_number,'
                  ' player1, player2, winner, result, date, board_record,'
                  ' swap_sequence, five_a, unplayed, walkover)'
                  ' values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                  (nid, TID, rd, board, p1, p2, w, rs, DATE))
        nid += 1

    # 新面孔先在等级分表里占一行（地区/学校），分数由重算脚本填
    for no in sorted(roster):
        name = roster[no]
        row = d.execute('select 1 from ratings where name=?', (name,)).fetchone()
        if not row:
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,"河南省",?,NULL,0,0,0,0,NULL,"",1,NULL)',
                      (name, UNIT.get(name, '')))
        elif UNIT.get(name):
            d.execute('update ratings set university=? where name=? and'
                      ' (university is null or university="")', (UNIT[name], name))

    d.commit()
    print('台次 %d  名单 %d 人' % (len(R), len(roster)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
