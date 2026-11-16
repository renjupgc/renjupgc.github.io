# -*- coding: utf-8 -*-
"""补录 2026 洛阳市五子棋棋王赛王府井站分站赛（t3）全部 4 轮成绩。

原先库里只有 5 局（前 3 轮的部分台次），本次按赛后公布的逐轮对阵表补全：
10 人 4 轮，共 20 局，无轮空、无弃权。对阵表未标先后手，按表上左右次序记先手在左。
唐碧、申明增、辛仲庙、廖汉娇都是成人棋手；本次新出场的廖汉娇、潘嘉杰也不是高校棋手。
"""
import sqlite3
import sys

DB = 'data/renju.db'
TID = 3
DATE = '2026-04-25'

NO = {
    1: '唐碧', 2: '廖汉娇', 3: '张晋超', 4: '乔仕鑫', 5: '潘冠臣',
    6: '李致阳', 7: '王鑫宇', 8: '申明增', 9: '潘嘉杰', 10: '潘为民',
}

UNIT = {'潘冠臣': '河南师范大学棋艺协会'}

# 成人（非高校）棋手：照算等级分，不进榜，只给预估名次
ADULT = {
    '唐碧': ('河南省 洛阳市', ''),
    '申明增': ('河南省 洛阳市', ''),
    '辛仲庙': ('河南省 洛阳市', ''),
    '廖汉娇': ('河南省 洛阳市', ''),
    '潘嘉杰': ('河南省 洛阳市', ''),
}

# (轮次, 台次, 先手号, 后手号, 结果)  '1' 先手胜 / '0' 后手胜
R = [
    (1, 1, 1, 2, '0'), (1, 2, 3, 4, '1'), (1, 3, 5, 6, '1'),
    (1, 4, 7, 8, '1'), (1, 5, 9, 10, '1'),

    (2, 1, 2, 9, '0'), (2, 2, 7, 5, '0'), (2, 3, 10, 3, '1'),
    (2, 4, 8, 1, '1'), (2, 5, 4, 6, '0'),

    (3, 1, 5, 9, '1'), (3, 2, 6, 2, '1'), (3, 3, 3, 7, '0'),
    (3, 4, 10, 8, '0'), (3, 5, 1, 4, '1'),

    (4, 1, 8, 5, '0'), (4, 2, 9, 7, '0'), (4, 3, 6, 10, '1'),
    (4, 4, 3, 1, '1'), (4, 5, 2, 4, '0'),
]

WIN = {'1': ('1', '1-0'), '0': ('0', '0-1')}

DESC = ('4 轮积分编排制，10 人参赛，无轮空、无弃权。2026 年 4 月 25 日在洛阳王府井举行，'
        '五手两打，每方 20 分钟共用时、之后 5 分钟包干。成绩据赛后公布的逐轮对阵表录入，'
        '对阵表未标先后手，按表上左右次序记先手在左。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    roster = dict(NO)

    d.execute('update tournaments set name=?, date=?, organizer=?, rules=?,'
              ' time_limit=?, chief_arbiter=?, participants=?, description=?,'
              ' group_name=? where id=?',
              ('2026洛阳市五子棋棋王赛王府井站分站赛', DATE, '洛阳市五子棋协会', '五手两打',
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

    # 成人棋手：等级分表里留行、college 置 0
    for name, (region, uni) in ADULT.items():
        row = d.execute('select region, university from ratings where name=?',
                        (name,)).fetchone()
        if row:
            d.execute('update ratings set college=0, region=CASE WHEN region IS NULL OR'
                      ' region="" THEN ? ELSE region END where name=?', (region, name))
        else:
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,?,?,NULL,0,0,0,0,NULL,"",0,NULL)',
                      (name, region, uni))

    # 未成年/成人以外的其他生面孔照高校默认口径；本场没有这类人
    for name in roster.values():
        if name in ADULT:
            continue
        row = d.execute('select 1 from ratings where name=?', (name,)).fetchone()
        if not row:
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,"","",NULL,0,0,0,0,NULL,"",1,NULL)', (name,))

    d.commit()
    print('台次 %d  名单 %d 人' % (len(R), len(roster)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
