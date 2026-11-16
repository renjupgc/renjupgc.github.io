# -*- coding: utf-8 -*-
"""录入 2021 年体彩杯五子棋比赛（成人公开组，t120）。

9 轮积分编排，132 人报名，据赛后公布的逐轮对阵表录入（数据见 data_t120.py）。
弃权记 0f / f0，双方弃权记 ff，轮空没有；未到场的棋手只留下弃权记录、不生成主页。
"""
import sqlite3
import sys

import data_t120 as D

DB = 'data/renju.db'
TID = 120
DATE = '2021-08-08'

CODE = {
    '1': ('1', '1-0'), '0': ('0', '0-1'), 'd': ('0.5', '½-½'),
    'A': ('0f', '+-'), 'B': ('f0', '-+'), 'X': ('ff', '--'),
}

DESC = ('2021 年河南省智力体育线上系列活动五子棋比赛（“体彩杯”），成人公开组，'
        '9 轮积分编排制，132 人报名。由河南省社会体育事务中心主办、河南省棋类协会承办，'
        '8 月 8 日全民健身日线上举行，采用《中国五子棋竞赛规则》（2013 版）指定开局、'
        '三手交换、五手 N 打，每方 30 分钟包干。成绩据赛后公布的逐轮对阵表录入，'
        '未记先后手；中间数轮有棋手弃权或未到场，双弃记 --、单方弃权记 +-。'
        '陈涛 9 战全胜居首，任治国、杨硕 7.5 分列二三位。')


def main():
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    rows = [l.split() for l in D.ROWS.strip().split('\n') if l.strip()]

    names = [D.NO[i] for i in sorted(D.NO)]
    if d.execute('select 1 from tournaments where id=?', (TID,)).fetchone():
        d.execute('update tournaments set name=?, date=?, organizer=?, rules=?, time_limit=?,'
                  ' chief_arbiter=?, participants=?, description=?, group_name=? where id=?',
                  ('2021年体彩杯五子棋比赛', DATE, '河南省社会体育事务中心、河南省棋类协会',
                   '指定开局、三手交换、五手N打', '30分钟包干', None,
                   ','.join(names), DESC, '成人公开组', TID))
    else:
        d.execute('insert into tournaments(id, name, date, organizer, rules, time_limit,'
                  ' chief_arbiter, participants, description, group_name)'
                  ' values(?,?,?,?,?,?,?,?,?,?)',
                  (TID, '2021年体彩杯五子棋比赛', DATE, '河南省社会体育事务中心、河南省棋类协会',
                   '指定开局、三手交换、五手N打', '30分钟包干', None,
                   ','.join(names), DESC, '成人公开组'))

    d.execute('delete from players where tournament_id=?', (TID,))
    for no in sorted(D.NO):
        d.execute('insert into players(tournament_id, player_no, name, unit) values(?,?,?,?)',
                  (TID, no, D.NO[no], D.UNIT.get(D.NO[no], '')))

    d.execute('delete from matches where tournament_id=?', (TID,))
    nid = d.execute('select max(id) from matches').fetchone()[0] + 1
    board = {}
    for r, a, b, c in rows:
        r, a, b = int(r), int(a), int(b)
        board[r] = board.get(r, 0) + 1
        w, rs = CODE[c]
        d.execute('insert into matches(id, tournament_id, round, board_number, player1,'
                  ' player2, winner, result, date, board_record, swap_sequence, five_a,'
                  ' unplayed, walkover) values(?,?,?,?,?,?,?,?,?,"","","",0,0)',
                  (nid, TID, r, board[r], D.NO[a], D.NO[b], w, rs, DATE))
        nid += 1

    # 生面孔先占一行（地区按河南记；高校/成人由名单决定），分数交给重算脚本
    for no in sorted(D.NO):
        name = D.NO[no]
        row = d.execute('select region, university from ratings where name=?', (name,)).fetchone()
        if row:
            if not (row['region'] or '').strip():
                d.execute('update ratings set region="河南省" where name=?', (name,))
            if D.UNIT.get(name) and not (row['university'] or '').strip():
                d.execute('update ratings set university=? where name=?', (D.UNIT[name], name))
        else:
            d.execute('insert into ratings(name, region, university, rating, games, wins,'
                      ' draws, losses, rank, as_of, college, est_rank)'
                      ' values(?,"河南省",?,NULL,0,0,0,0,NULL,"",1,NULL)',
                      (name, D.UNIT.get(name, '')))

    d.commit()
    print('赛事 t%d 对局 %d  报名 %d 人' % (TID, len(rows), len(D.NO)))
    for r in d.execute('select round, count(*) from matches where tournament_id=?'
                       ' group by round', (TID,)):
        print('  第 %d 轮 %d 台' % (r[0], r[1]))
    d.close()


if __name__ == '__main__':
    sys.exit(main())
