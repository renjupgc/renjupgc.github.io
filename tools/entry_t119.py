# -*- coding: utf-8 -*-
"""录入 2021 年河南省五子棋锦标赛（成人公开组，t119）。

成绩据赛后公布的成绩表逐轮录入：表中每格记「本轮对手编号 + 结果」，
1 胜 / 0 负 / ½ 和 / + 对手弃权胜 / − 自己弃权负。12 号是轮空位，不是棋手。
原始成绩表未记先后手，按编号小者在先记之；等级分与先后手无关。
"""
import sqlite3
import sys

DB = 'data/renju.db'
TID = 119
DATE = '2021-12-05'

NO = {
    1: '黄健光', 2: '王红波', 3: '董新武', 4: '张夏玲', 5: '温永彩',
    6: '刘静函', 7: '杜建航', 8: '李永飞', 9: '任治国', 10: '高嘉擎',
    11: '陈涛',
}
BYE_NO = 12                       # 12 号是轮空位

UNIT = {
    '黄健光': '河南德弈五子棋俱乐部', '董新武': '河南德弈五子棋俱乐部',
    '温永彩': '河南德弈五子棋俱乐部', '张夏玲': '河南德弈五子棋俱乐部',
    '陈涛': '许昌农商银行', '高嘉擎': '郑州大学', '刘静函': '郑州师范学院',
    '杜建航': '郑州西亚斯学院',
}

# 本科高校棋手的地区（成绩表「地区」一栏填的是俱乐部，籍贯照学校所在城市记）
NEW_COLLEGE = {
    '高嘉擎': '河南省 郑州市',
    '刘静函': '河南省 郑州市',
    '杜建航': '河南省 郑州市',
}

# (轮次, 台次, 先手号, 后手号, 结果)  'bye' 表示后手号为轮空位
R = [
    (1, 1, 1, 6, '1'), (1, 2, 3, 8, '1'), (1, 3, 11, BYE_NO, 'bye'),
    (1, 4, 5, 10, '1'), (1, 5, 2, 7, '1'), (1, 6, 4, 9, '0f'),

    (2, 1, 3, 11, '1'), (2, 2, 4, 1, '0'), (2, 3, 2, 5, '0'),
    (2, 4, 6, 7, '1'), (2, 5, 10, BYE_NO, 'bye'),

    (3, 1, 11, 5, '1'), (3, 2, 3, 1, '0'), (3, 3, 2, 6, '1'),
    (3, 4, 10, 4, '0'),

    (4, 1, 2, 1, '0'), (4, 2, 5, 3, '0'), (4, 3, 10, 11, '0'),
    (4, 4, 6, 4, '0.5'),

    (5, 1, 11, 1, '0.5'), (5, 2, 4, 3, '0'), (5, 3, 6, 5, '0'),
    (5, 4, 2, 10, '1'),

    (6, 1, 5, 1, '0'), (6, 2, 4, 11, '0'), (6, 3, 2, 3, '0'),
    (6, 4, 6, 10, '0'),

    (7, 1, 10, 1, '0'), (7, 2, 6, 3, '0'), (7, 3, 2, 11, '0'),
    (7, 4, 4, 5, '0'),
]

WIN = {'1': ('1', '1-0'), '0': ('0', '0-1'), '0.5': ('0.5', '½-½'),
       '0f': ('0f', '+-'), 'bye': ('1', '1-0')}

DESC = ('个人赛成人公开组，7 轮积分编排制，11 人报名、2 人中途退赛（杜建航、李永飞第 2 轮后，'
        '任治国首轮弃权）。原定 2021 年 11 月 6—7 日举行，因疫情延期至 12 月在郑州市新中菲酒店'
        '开赛，采用《中国五子棋竞赛规则》（2013 版）指定开局、三手交换、五手 N 打，每方 30 分钟'
        '包干。裁判长赵严。成绩据赛后公布的成绩表逐轮录入，表中 12 号是轮空位；成绩表未记先后手，'
        '按编号小者在先记之。黄健光 6.5 分居首，董新武 6 分次之，陈涛 5.5 分第三。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    roster = dict(NO)

    row = d.execute('select id from tournaments where id=?', (TID,)).fetchone()
    if row:
        d.execute('update tournaments set name=?, date=?, organizer=?, rules=?,'
                  ' time_limit=?, chief_arbiter=?, participants=?, description=?,'
                  ' group_name=? where id=?',
                  ('2021年河南省五子棋锦标赛（成人公开组）', DATE,
                   '河南省社会体育事务中心、河南省棋类协会', '指定开局、三手交换、五手N打',
                   '30分钟包干', '赵严',
                   ','.join(roster[no] for no in sorted(roster)), DESC, '成人公开组', TID))
    else:
        d.execute('insert into tournaments(id, name, date, organizer, rules, time_limit,'
                  ' chief_arbiter, participants, description, group_name)'
                  ' values(?,?,?,?,?,?,?,?,?,?)',
                  (TID, '2021年河南省五子棋锦标赛（成人公开组）', DATE,
                   '河南省社会体育事务中心、河南省棋类协会', '指定开局、三手交换、五手N打',
                   '30分钟包干', '赵严',
                   ','.join(roster[no] for no in sorted(roster)), DESC, '成人公开组'))

    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(roster):
        d.execute('insert into players(tournament_id, player_no, name, unit)'
                  ' values(?,?,?,?)', (TID, no, roster[no], UNIT.get(roster[no], '')))

    d.execute('delete from matches where tournament_id=?', (TID,))
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    for rd, board, a, b, res in R:
        w, rs = WIN[res]
        p1 = roster[a]
        p2 = '轮空' if b == BYE_NO else roster[b]
        d.execute('insert into matches(id, tournament_id, round, board_number,'
                  ' player1, player2, winner, result, date, board_record,'
                  ' swap_sequence, five_a, unplayed, walkover)'
                  ' values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                  (nid, TID, rd, board, p1, p2, w, rs, DATE))
        nid += 1

    for name in roster.values():
        r = d.execute('select 1 from ratings where name=?', (name,)).fetchone()
        if not r:
            d.execute('insert into ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,?,?,NULL,0,0,0,0,NULL,"",1,NULL)',
                      (name, NEW_COLLEGE.get(name, ''), UNIT.get(name, '')))
        elif name in NEW_COLLEGE:
            d.execute('update ratings set region=? where name=? and (region is null or'
                      ' region="")', (NEW_COLLEGE[name], name))
        if UNIT.get(name):
            d.execute('update ratings set university=? where name=? and (university is'
                      ' null or university="")', (UNIT[name], name))

    d.commit()
    print('台次 %d  名单 %d 人' % (len(R), len(roster)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
