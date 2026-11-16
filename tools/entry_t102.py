# -*- coding: utf-8 -*-
"""补录 2026 洛阳市金秋五子棋棋王赛（t102）全部 5 轮成绩。

原先库里只有 3 局（邹澔非—李致阳、王鑫宇—邹澔非、李致阳—王鑫宇，且未记轮次），
本次按赛后公布的逐轮对阵表补全：10 人 5 轮，共 25 局，无轮空、无弃权。
对阵表未标先后手，按表上左右次序记先手在左。
相卫利、潘为民（水木菁华）是洛阳的成人棋手。
"""
import sqlite3
import sys

DB = 'data/renju.db'
TID = 102
DATE = '2026-10-31'

NO = {
    1: '王鑫宇', 2: '辛仲庙', 4: '申明增', 5: '刘昊喆', 6: '夏振东',
    7: '唐碧', 9: '李致阳', 10: '相卫利', 11: '潘为民', 13: '邹澔非',
}

UNIT = {'相卫利': '水木菁华', '潘为民': '水木菁华'}

# 新面孔的等级分初始行：(地区, 学校)。相卫利、潘为民是洛阳成人，不进场分榜。
PROFILE = {
    '相卫利': ('河南省 洛阳市', '', 0),
    '潘为民': ('河南省 洛阳市', '', 0),
    '申明增': ('', '', 1),
    '唐碧': ('', '', 1),
    '辛仲庙': ('', '', 1),
}

# (轮次, 台次, 先手号, 后手号, 结果)  '1' 先手胜 / '0' 后手胜 / 'd' 和
R = [
    (1, 1, 1, 2, '1'), (1, 2, 4, 5, '1'), (1, 3, 6, 7, '1'),
    (1, 4, 9, 10, '1'), (1, 5, 11, 13, '0'),

    (2, 1, 13, 9, '1'), (2, 2, 6, 4, '0'), (2, 3, 10, 1, '0'),
    (2, 4, 7, 11, '1'), (2, 5, 2, 5, 'd'),

    (3, 1, 1, 13, '0'), (3, 2, 4, 7, '1'), (3, 3, 9, 6, '1'),
    (3, 4, 11, 2, '0'), (3, 5, 5, 10, '1'),

    (4, 1, 13, 4, '1'), (4, 2, 9, 1, '1'), (4, 3, 5, 6, '0'),
    (4, 4, 2, 7, 'd'), (4, 5, 10, 11, '1'),

    (5, 1, 2, 13, '0'), (5, 2, 4, 9, '0'), (5, 3, 6, 1, '0'),
    (5, 4, 7, 10, '1'), (5, 5, 11, 5, '1'),
]

WIN = {'1': ('1', '1-0'), '0': ('0', '0-1'), 'd': ('0.5', '½-½')}

DESC = ('5 轮积分编排制，10 人参赛，无轮空、无弃权。2026 年 10 月 31 日在洛阳举行，'
        '五手两打，每方 20 分钟共用时、之后 5 分钟包干。成绩据赛后公布的逐轮对阵表录入，'
        '对阵表未标先后手，按表上左右次序记先手在左。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    roster = dict(NO)

    d.execute('update tournaments set name=?, date=?, organizer=?, rules=?,'
              ' time_limit=?, chief_arbiter=?, participants=?, description=?,'
              ' group_name=? where id=?',
              ('2026洛阳市金秋五子棋棋王赛', DATE, '洛阳市五子棋协会', '五手两打',
               '20分钟共用时后5分钟包干', '王锦萍',
               ','.join(roster[no] for no in sorted(roster)), DESC, '公开组', TID))

    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(roster):
        d.execute('insert into players(tournament_id, player_no, name, unit)'
                  ' values(?,?,?,?)', (TID, no, roster[no], UNIT.get(roster[no], '')))

    d.execute('delete from matches where tournament_id=?', (TID,))
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    for rd, board, a, b, res in R:
        w, rs = WIN[res]
        d.execute('insert into matches(id, tournament_id, round, board_number,'
                  ' player1, player2, winner, result, date, board_record,'
                  ' swap_sequence, five_a, unplayed, walkover)'
                  ' values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                  (nid, TID, rd, board, roster[a], roster[b], w, rs, DATE))
        nid += 1

    # 生面孔先在等级分表里占一行，分数由重算脚本填
    for name, (region, uni, college) in PROFILE.items():
        row = d.execute('select 1 from ratings where name=?', (name,)).fetchone()
        if not row:
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,?,?,NULL,0,0,0,0,NULL,"",?,NULL)',
                      (name, region, uni, college))

    d.commit()
    print('台次 %d  名单 %d 人' % (len(R), len(roster)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
