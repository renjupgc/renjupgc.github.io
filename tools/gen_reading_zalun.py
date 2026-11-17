# -*- coding: utf-8 -*-
"""把「杂论」里的赛后记、棋评、裁判记改写成四级阅读题，追加进 data/english/reading.json。

题型两种：
  careful  —— 仔细阅读，五个四选一（对应四级 Section C）
  matching —— 长篇阅读·信息匹配，一篇分 A–J 段，十个句子各归一段（对应 Section B）
原文在 posts/*.html，这里只取事实与观点，英文重写。
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'english', 'reading.json')


def q(text, options, a, why):
    return {'q': text, 'options': options, 'a': a, 'why': why}


CAREFUL = [
    {
        'id': 'z01',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《冠军反对冠军》',
        'title': 'The Champion Argues with the Champion',
        'text': [
            'On 1 November 2025 a community sports meeting opened in Jinshui District, Zhengzhou, and among its events was a gomoku competition. Unlike most official renju tournaments, this one used a single-game format with no forbidden moves: the two players simply took turns, and the first to make an unbroken row of five won. About sixty people entered, including teenagers from a training team, university students, and residents who had signed up for fun.',
            'The writer won all seven rounds. It was his first important title in the no-forbidden-move version of the game, and he does not pretend that it meant nothing. But he insists that the result was not the point of the day.',
            'The title of his essay, "The Champion Argues with the Champion", comes from an older book called America Against America, written by a Chinese scholar more than thirty years ago. That book argued that a country changes by criticizing itself. The writer borrows the idea and turns it inward: a new champion must argue with the old champion, and quite often both of them live in the same person.',
            'He has won a great many events in the past few seasons: provincial opens, a provincial ranking tournament, the provincial games, a university championship three times, and a world youth cup. There are now so many that, as he puts it, two hands are no longer enough to count them. Yet he argues that those earlier titles, won when he was a weaker player, are exactly what the present one has to question.',
            'For him the real opponent is never the person sitting across the board. It is the version of himself who played last year, with last year\'s habits and last year\'s excuses. Every game is a chance to find out whether that older player has finally been left behind. A trophy, in this view, is only the receipt.',
        ],
        'gloss': [
            ['tournament', '比赛，赛事'],
            ['forbidden move', '禁手'],
            ['unbroken row', '连续不断的一列棋子'],
            ['criticize', '批评，自我批评'],
            ['receipt', '收据；此处指“结果凭证”'],
            ['excuse', '借口'],
        ],
        'questions': [
            q('What was special about the 2025 community event?',
              ['It was open only to teenagers.', 'It used a single game with no forbidden moves.',
               'It lasted for seven days.', 'It was played on a 19x19 board.'], 1,
              '第一段明确说这次比赛是单盘制、无禁手，与多数正式连珠赛不同。'),
            q('Why does the writer mention the book America Against America?',
              ['To show that he has read many old books.', 'To explain the idea of self-criticism behind his title.',
               'To compare China with the United States.', 'To prove that champions are often lonely.'], 1,
              '第三段说这本书讲“国家靠自我批评而改变”，作者借来解释“新冠军反对旧冠军”就是自我批判。'),
            q('What does the writer think of his earlier titles?',
              ['They were more valuable than the new one.', 'They should be forgotten completely.',
               'They are what his present self has to question.', 'They were won against weak opponents.'], 2,
              '第四段末句：早年那些冠军，正是现在这个冠军要去质疑的东西。'),
            q('According to the passage, who is "the real opponent"?',
              ['The strongest player in the hall.', 'The referee who controls the game.',
               'The player he used to be.', 'The young players from the training team.'], 2,
              '第五段开头：真正的对手不是对面坐着的人，而是去年的自己。'),
            q('What is the main message of the passage?',
              ['A player improves by questioning his own past success.', 'Winning more titles makes a player happy.',
               'Community events are easier than official ones.', 'Young players should copy famous champions.'], 0,
              '全文借“冠军反对冠军”说明成长来自不断否定过去的自己，奖杯只是结果凭证。'),
        ],
    },
    {
        'id': 'z02',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《悟道，从输一盘棋开始》',
        'title': 'Losing on the Clock',
        'text': [
            'In June 2025 the provincial ranking tournament returned to the same shopping centre where the writer had won every game a year before. He signed up happily, thinking that his first-level rank might move up one more step. What followed, he says, was a lesson he had needed for a whole year.',
            'The format gave each player twenty minutes for the entire game, with no extra time added. When a player\'s clock ran out, that player lost, however good the position on the board might be. Most experienced players treat the clock as a second opponent; beginners treat it as furniture.',
            'In the first round he met an amateur who did not even know the two-opening rule. The writer played a careless move and handed his opponent a simple threat. He recovered and won, but promised himself not to relax again.',
            'Round five brought the familiar three-dan boy. The writer made a small change on move nine, and the boy\'s face darkened at once. After the exchange, the boy\'s fourteenth move was a clear mistake. Within a dozen more moves White was lost, and both players were far away from any book they had studied.',
            'At that point the writer began to enjoy himself. He considered three or four plans: a sleeping three to keep the attack alive, a steady block, a direct attack that would finish the game, or simply a loose stone placed to watch the boy\'s expression. Any of them would have won. While he was comparing them, the clock ran out. He lost on time with a winning position in front of him.',
            'He calls the lesson simple and expensive. Time is part of the board, and a player who forgets it has already stopped playing, even if the stones say otherwise.',
        ],
        'gloss': [
            ['ranking tournament', '等级赛'],
            ['run out', '（时间）用完'],
            ['careless', '粗心的'],
            ['exchange', '交换（对局中交换先后手）'],
            ['steady', '稳健的'],
            ['expression', '表情'],
        ],
        'questions': [
            q('What does the time rule of the event mean?',
              ['Each player has twenty minutes and may ask for more.', 'A player who uses up the time loses whatever the position is.',
               'The clock stops when a player is winning.', 'Both players share one clock.'], 1,
              '第二段：每人二十分钟包干，时间用尽即负，不论局面好坏。'),
            q('What happened to the writer in the first round?',
              ['He lost because of a careless move.', 'He won without any difficulty.',
               'He made a careless move but still won.', 'He forgot to start his clock.'], 2,
              '第三段：第一轮他走了一步随手棋，送了对手一个简单的杀，但仍赢下比赛。'),
            q('Why did the writer lose in round five?',
              ['His opponent found a stronger attack.', 'He spent too long comparing winning plans.',
               'He knocked the stones off the board.', 'He was late for the round.'], 1,
              '第五段：他反复比较几种都能赢的下法，结果时间先走完了。'),
            q('What can be inferred about the position when the game ended?',
              ['The writer was winning on the board.', 'The writer had already resigned.',
               'The boy had a forced win.', 'Both sides had equal chances.'], 0,
              '末段之前的第五段说“他输在时间上，而面前是一个赢定的局面”。'),
            q('What is the lesson the writer draws?',
              ['Amateurs should not enter ranking events.', 'Clock management is part of a player\'s skill.',
               'Fast moves are always better than slow ones.', 'A win on the board matters more than the clock.'], 1,
              '末段点题：时间也是棋盘的一部分，忘了时间的棋手等于已经停手。'),
        ],
    },
    {
        'id': 'z03',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《告慰成行的连珠之城》',
        'title': 'Two Hundred and Forty Players, Nine Rounds',
        'text': [
            'In May 2025 a university chess and card league held its gomoku event in Kaifeng. More than 240 students entered, which is a large field for a game that is still often treated as a hobby. The organizer chose nine rounds of the Swiss system, in which players are paired round by round with opponents on a similar score.',
            'The writer, who served as chief referee, mentions a small mathematical worry. In a Swiss event the number of rounds is usually about log2(N)+2, where N is the number of players. For 240 players that works out at more than nine. With only nine rounds, two players can finish on the same score, and the title may have to be decided by tie-break rather than by a direct result between them.',
            'The hall was divided into three courts: the first for boards 1 to 40, the second for boards 41 to 80, and the third for everything after that. In the second court an assistant referee began shouting, "Nine games in one round! Sign the sheet and leave when you finish!" A referee cannot run nine games at once; he came over and corrected the instruction, half amused and half annoyed.',
            'Other voices showed how new many of the players were. On one board a student announced proudly, "I won eight to one!" as if the game were a ball match with a score. Elsewhere players asked what an exchange was, and where exactly the fifth stone should be placed.',
            'None of this became a disaster. From the second round the referees and the players found the rhythm. The two-opening rule, which had looked like a wall in the morning, was accepted board by board. By the afternoon the hall was quiet, the result sheets matched, and the prizes were handed out on time.',
            'For the writer, the event was a reminder that a tournament tests more than the players. It also tests the people who run it, and it shows how patiently a new game has to be taught before it can be played well.',
        ],
        'gloss': [
            ['Swiss system', '瑞士制（积分编排）'],
            ['tie-break', '破同分，加赛'],
            ['assistant referee', '辅助裁判'],
            ['exchange', '交换'],
            ['rhythm', '节奏'],
            ['patiently', '耐心地'],
        ],
        'questions': [
            q('Why does the writer mention log2(N)+2?',
              ['To prove that the Swiss system is unfair.', 'To show that nine rounds were fewer than the number usually needed.',
               'To explain how the prize money was calculated.', 'To suggest that 240 players were too few.'], 1,
              '第二段：瑞士制轮次通常约为 log2(N)+2，240 人应多于九轮，因此九轮偏少。'),
            q('What was wrong with the assistant referee\'s instruction?',
              ['He asked players to leave before signing.', 'He confused the number of rounds with the number of boards.',
               'He gave the instruction in the wrong language.', 'He told players to play nine moves each.'], 1,
              '第三段：辅助裁判喊“一轮下九盘”，把轮次和台次混在一起，裁判长过去纠正。'),
            q('What does "I won eight to one" show about the student?',
              ['He was the strongest player in the hall.', 'He did not understand how gomoku is scored.',
               'He had played eight games already.', 'He was joking with the referee.'], 1,
              '第四段用这句话说明不少选手是新手，把棋类当成有比分的球类比赛。'),
            q('What happened after the second round?',
              ['Many players gave up and left.', 'The event settled into a normal rhythm.',
               'The referees changed the rules.', 'The number of rounds was increased.'], 1,
              '第五段：从第二轮起裁判和选手都找到了节奏，五手两打也逐台被接受。'),
            q('What is the writer\'s main point?',
              ['Large events should not use the Swiss system.', 'Running a tournament teaches as much as playing in one.',
               'University students are too careless for gomoku.', 'Nine rounds are always enough to find a champion.'], 1,
              '末段：比赛不只考验选手，也考验办赛的人，还说明新项目要耐心地教。'),
        ],
    },
    {
        'id': 'z04',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《那份空寂的忧愁薄雾》',
        'title': 'The Fog over the World Youth Championship',
        'text': [
            'Every summer the world youth renju championship brings young players from many countries together. In July 2026 the fourteenth edition was held, and the writer travelled there with high hopes and a notebook full of openings.',
            'International events punish small habits. At home he could often win with a quick attack, because local opponents would defend in the way he expected. Here every player knew the main openings and answered an attack without hurrying. The board felt narrower than it did at home.',
            'In one game he had a continuous attack in mind. A continuous attack, usually shortened to VCT, is a series of threats that ends in a forced win: each move gives the opponent no choice, and the last one completes five. But he confused it with a looser plan, a chain of threats that looks similar and does not necessarily finish anywhere. He played as if the win were already on the board. His opponent defended calmly and turned the attack around.',
            'He describes the loss with humour rather than bitterness. He had, he says, turned a VCT into an LCT, "lost continuous threat", and so became part of the background of somebody else\'s photograph.',
            'The journey home was quiet. What stayed with him was not the result but the fog: the feeling of believing that you understand a position when you do not. Since then he has trained differently. He now checks every attack to the end before he plays it, and he writes down the exact moment when he stopped calculating.',
            'A loss abroad, he says, is a receipt for lessons that could not have been bought at home.',
        ],
        'gloss': [
            ['edition', '（赛事）届'],
            ['opening', '开局'],
            ['continuous attack', '连续进攻（VCT）'],
            ['forced win', '必胜，必杀'],
            ['bitterness', '苦涩，怨恨'],
            ['calculate', '计算（棋步）'],
        ],
        'questions': [
            q('How are international events different, according to the writer?',
              ['They are played with a different set of rules.', 'Opponents know the openings and defend without hurrying.',
               'They last much longer than local events.', 'They are held on a larger board.'], 1,
              '第二段：国外棋手都熟悉主要开局，面对进攻不急不慌，不会按他熟悉的套路应。'),
            q('What mistake did the writer make in the game?',
              ['He forgot the opening he had prepared.', 'He treated an unfinished attacking plan as a forced win.',
               'He played too slowly and lost on time.', 'He offered a draw too early.'], 1,
              '第三段：他把“不一定能杀完的连续威胁”当成了 VCT，以为赢已经在盘上。'),
            q('What does "LCT" refer to?',
              ['A well-known opening system.', 'A referee\'s decision in the game.',
               'The writer\'s own joking name for a plan that never wins.', 'A title given to young champions.'], 2,
              '第四段：LCT 是作者自嘲的说法，“lost continuous threat”，指看着像杀棋却杀不完的计划。'),
            q('What has changed in his training since the loss?',
              ['He no longer studies openings.', 'He checks an attack to the end before playing it.',
               'He plays only friendly games.', 'He trains with older players.'], 1,
              '第五段：现在每走一个进攻前都要算到底，并记下自己是从哪一步开始停止计算的。'),
            q('What does the last sentence suggest?',
              ['The trip was too expensive for him.', 'The loss was worth more than an easy home win.',
               'He will not go abroad again.', 'Home events are badly organized.'], 1,
              '末句把这场败局称为“收据”，说明它换来了在家赢多少盘也换不到的经验。'),
        ],
    },
]

MATCHING = [
    {
        'id': 'm01',
        'type': 'matching',
        'topic': '杂论',
        'source': '杂论·赛场记与棋评',
        'title': 'One Season, Four Tournaments',
        'sections': [
            {'l': 'A', 't': 'The ranking event', 'text': 'The provincial ranking tournament is where ranks are actually earned. Results are recorded one by one, and a player who does well enough can move up a level at the end of the season. The writer treats it as the most honest event on the calendar: nobody can talk his way into a higher rank, because every game is written down.'},
            {'l': 'B', 't': 'The open', 'text': 'An open is different. Anyone may enter, from a first-year student to a retired teacher, and the field is wide. The writer won one of these by leaving the book earlier than his opponents expected. They had memorized the main lines; he played a move that was not in the book at all, and they had to think for themselves. That, he says, is where an open is decided.'},
            {'l': 'C', 't': 'The university final', 'text': 'At the provincial university final in Zhumadian, seven rounds were played in two days and the writer won all of them. The interesting part was not the score but the speed. In several games the result was settled within twelve or fifteen moves: a quick move, a collapse, a finish. He later wrote about those games under the title "fast move, fast collapse, fast kill".'},
            {'l': 'D', 't': 'The community meeting', 'text': 'The community sports meeting in Zhengzhou used no forbidden moves at all. Black has no restrictions, White may also win with an overline, and a single game decides the result. Teenagers from a training team, university students and local residents all sat in the same hall. For many of the residents it was their first tournament, and the atmosphere was friendlier than at any ranking event.'},
            {'l': 'E', 't': 'The world youth championship', 'text': 'The world youth championship is a different world. Opponents arrive with prepared openings, defend an attack without hurrying, and are not impressed by speed. The writer lost one game there because he mistook an unfinished attacking plan for a forced win. He describes the level simply: at home you can win with one good idea; there you need the whole game to be good.'},
            {'l': 'F', 't': 'The referee course', 'text': 'In the winter of 2024 a three-level referee course was held in Zhengzhou, taught by a six-dan player. The course covered the rules in detail, and in particular how to decide whether a point is a forbidden point for Black. Trainees also learned how to record a game and how to explain the two-opening rule to a beginner without making it sound like mathematics.'},
            {'l': 'G', 't': 'Refereeing the league', 'text': 'Refereeing the university league meant 240 players and nine rounds in one day. Because there were so many boards, the hall was divided into three courts, and each referee was given a fixed group of boards to look after. The chief referee spent most of the morning walking between courts, answering questions and correcting instructions that had been given too quickly.'},
            {'l': 'H', 't': 'The training base', 'text': 'In Luoyang a city association opened a training base inside a citizens\' home, with tables, clocks and a small library of game records. The writer went to the opening ceremony and came away convinced that such places matter more than trophies. A base gives new players a fixed evening in the week, and that regular evening is what turns a curious visitor into a member.'},
            {'l': 'I', 't': 'Practice at home', 'text': 'His own routine is unglamorous. He solves a few positions every morning, replays the games he lost, and keeps a small opening file that he adds to only when an idea has survived a real game. Twenty minutes a day, he says, is worth more than one long session at the weekend, because the memory needs to meet the same pattern many times.'},
            {'l': 'J', 't': 'What a title means', 'text': 'He keeps his trophies in a cupboard rather than on a shelf. A title, he writes, is a receipt: it proves that something was paid, but it does not tell you what to buy next. The next game is always the interesting one, and the opponent who matters is the player he was last season.'},
        ],
        'gloss': [
            ['ranking', '等级，排名'],
            ['open', '公开赛'],
            ['overline', '长连'],
            ['trainee', '受训者，学员'],
            ['unglamorous', '不起眼的，不光鲜的'],
            ['receipt', '收据；凭证'],
        ],
        'statements': [
            {'q': 'Doing well here can move a player up one level at the end of the season.', 'a': 'A', 'why': 'A 段讲等级赛，成绩逐局记录，赛季末可升一级。'},
            {'q': 'This event is open to anyone, and the writer won it by leaving known lines early.', 'a': 'B', 'why': 'B 段讲公开赛人人可报，作者靠“早脱谱”取胜。'},
            {'q': 'Several games here were decided within twelve to fifteen moves.', 'a': 'C', 'why': 'C 段讲驻马店大学生总决赛，“秒拍、秒崩、秒杀”。'},
            {'q': 'Here the first player has no restrictions and one game decides the result.', 'a': 'D', 'why': 'D 段讲社区运动会：无禁手、单盘制。'},
            {'q': 'At this level opponents are not impressed by speed and defend calmly.', 'a': 'E', 'why': 'E 段讲世青赛对手有备而来，不惧快攻。'},
            {'q': 'This course teaches how to tell whether a point is forbidden for Black.', 'a': 'F', 'why': 'F 段讲裁判培训班，重点之一是禁手判定。'},
            {'q': 'The hall was split into three parts because of the number of boards.', 'a': 'G', 'why': 'G 段讲高校联赛 240 人，赛场分三区。'},
            {'q': 'A fixed weekly evening is what turns a visitor into a member.', 'a': 'H', 'why': 'H 段讲洛阳茶训基地，固定的活动日最重要。'},
            {'q': 'A short daily session is worth more than one long weekly session.', 'a': 'I', 'why': 'I 段讲每天二十分钟胜过周末一次长练。'},
            {'q': 'A title is compared to a receipt rather than a goal.', 'a': 'J', 'why': 'J 段把奖杯比作“收据”，下一盘棋才是有意思的。'},
        ],
    },
    {
        'id': 'm02',
        'type': 'matching',
        'topic': '杂论',
        'source': '杂论·裁判记与培训记',
        'title': 'Inside the Organizer\'s Room',
        'sections': [
            {'l': 'A', 't': 'Entries', 'text': 'Entries are collected through an online form and closed a week before the first round. The deadline is not a matter of taste. Pairing takes time, and a list that changes on the morning of the event makes the first round a lottery. Late arrivals are usually accepted only as reserves, and only if an even number of players is preserved.'},
            {'l': 'B', 't': 'Choosing the system', 'text': 'A large field is normally paired round by round, with players meeting opponents on a similar score; a small field may play a full round robin, in which everybody meets everybody. The first system keeps every player busy until the end, while the second gives a fair ranking but takes far too long once the entry list grows.'},
            {'l': 'C', 't': 'Counting the rounds', 'text': 'The number of rounds is not chosen by feeling. A common guide is log2(N)+2, where N is the number of players. With too few rounds, two players may finish on the same score, and the title is then decided by tie-break rather than on the board. The referee can point this out, but the final decision belongs to the organizer.'},
            {'l': 'D', 't': 'The opening rule', 'text': 'The two-opening rule gives the second player a choice: the first player offers two possible fifth moves, and the second player removes one. Referees must check that fifth move before play continues. In a hall full of beginners this is the single most common source of confusion, and it is also the rule that makes the game fair between the two sides.'},
            {'l': 'E', 't': 'Dividing the hall', 'text': 'When the number of boards passes eighty, the hall is usually divided into courts, each with its own entrance and its own result desk. The point is not decoration. Noise falls, the walk to the desk becomes short, and a referee can see a whole court from one place instead of crossing the room every few minutes.'},
            {'l': 'F', 't': 'The staff', 'text': 'A chief referee is responsible for the rules and for the final decision in a dispute. Assistant referees each look after a fixed group of boards, so that a player always knows whom to call. Recorders collect the signed sheets and enter the results. One person cannot watch nine boards and answer questions at the same time, and no rule asks him to.'},
            {'l': 'G', 't': 'The clock', 'text': 'At lower levels a sudden-death control is common: twenty minutes for the whole game, with nothing added. The clocks are placed where both players can see them, and the referee announces the last five minutes. A player whose time runs out loses, even if the position on the board is better, which is why beginners are told to look at the clock as often as at the stones.'},
            {'l': 'H', 't': 'Disputes', 'text': 'A claim that Black has played a forbidden point must be made at once, before the next move is played. The referee then checks the position, and if the point is indeed forbidden, Black loses the game. Claims made three moves later are politely refused, however sincere they are, because the position can no longer be reconstructed with certainty.'},
            {'l': 'I', 't': 'Becoming a referee', 'text': 'Referees in the province are licensed in three levels. A candidate passes a written test on the rules, then works at real events under supervision before the licence is issued. The written test is the easy part; the difficult part is telling a nervous beginner, in one sentence, why the move he just made is not allowed.'},
            {'l': 'J', 't': 'After the last round', 'text': 'When the last result is entered, the tie-breaks are calculated and the final list is published with the prizes. The organizer also writes a short report: the number of entries, the number of rounds, the problems that appeared, and the changes to make next year. Events improve through these reports far more than through good intentions.'},
        ],
        'gloss': [
            ['entry', '报名，参赛'],
            ['reserve', '替补'],
            ['round robin', '循环赛'],
            ['sudden-death', '包干制（用完即负）'],
            ['reconstruct', '复原，重现'],
            ['tie-break', '破同分'],
        ],
        'statements': [
            {'q': 'Entries close early so that the pairing can be prepared in time.', 'a': 'A', 'why': 'A 段：报名提前一周截止，否则首轮编排会变成抽签。'},
            {'q': 'A full round robin becomes too slow once the field grows.', 'a': 'B', 'why': 'B 段：人数一多，循环赛耗时太长，所以大场面用积分编排。'},
            {'q': 'Too few rounds may leave two players on the same score.', 'a': 'C', 'why': 'C 段：轮次不足会出现同分，冠军只能靠破同分决定。'},
            {'q': 'Referees have to check the fifth move before play goes on.', 'a': 'D', 'why': 'D 段：五手两打，裁判必须在继续落子前核对第五手。'},
            {'q': 'A referee can see a whole court from one place instead of crossing the room.', 'a': 'E', 'why': 'E 段：分区之后噪音下降、走动变少，一名裁判能看住整个赛区。'},
            {'q': 'Each assistant referee is given a fixed group of boards.', 'a': 'F', 'why': 'F 段：辅助裁判分台负责，选手知道该找谁。'},
            {'q': 'A player may lose on time even with a better position.', 'a': 'G', 'why': 'G 段：包干制时间用尽即负，与局面无关。'},
            {'q': 'A claim about an illegal point must be made immediately, not later.', 'a': 'H', 'why': 'H 段：禁手必须在下一手之前提出，过后不受理。'},
            {'q': 'A candidate must pass a written test and work at real events before being licensed.', 'a': 'I', 'why': 'I 段：三级裁判要笔试，还要在真实比赛中实习后才发证。'},
            {'q': 'Tie-breaks are worked out and published together with the final results.', 'a': 'J', 'why': 'J 段：最后一局录入后计算破同分、公布名次与奖项。'},
        ],
    },
]


def main():
    with io.open(PATH, encoding='utf-8') as f:
        data = json.load(f)
    old = {p['id'] for p in data['passages']}
    add = [p for p in (CAREFUL + MATCHING) if p['id'] not in old]
    # 题面顺序刻意打散，答案不是 A→J 顺着排
    orders = {
        'm01': ['E', 'C', 'J', 'A', 'G', 'D', 'I', 'B', 'F', 'H'],
        'm02': ['H', 'B', 'F', 'J', 'A', 'G', 'C', 'I', 'D', 'E'],
    }
    for p in add:
        if p.get('type') == 'matching':
            by = dict((s['a'], s) for s in p['statements'])
            p['statements'] = [by[L] for L in orders[p['id']]]
    data['passages'].extend(add)
    data['count'] = len(data['passages'])
    with io.open(PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('新增 %d 篇，共 %d 篇' % (len(add), data['count']))


if __name__ == '__main__':
    main()
