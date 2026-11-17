# -*- coding: utf-8 -*-
"""把「杂论」里的赛后记、棋评、裁判记改写成四级阅读题，写进 data/english/reading.json。

题型两种，长度按四级卷面：
  careful  —— 仔细阅读，300–375 词，五道四选一（对应 Section C）
  matching —— 长篇阅读·信息匹配，800 词以上，A–J 十段，十个句子各归一段（对应 Section B）

本脚本做三件事：
  1. 把已有的知识类短文（r01–r07）扩写到 300 词以上，并各补一道推断题；
  2. 把两篇长篇匹配补过 800 词；
  3. 追加新的杂论改写篇目（z05–z08、m03）。

原文在 posts/*.html，这里只取事实与观点，英文重写。
用法：python tools/gen_reading_zalun.py [--check]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'english', 'reading.json')


def q(text, options, a, why):
    return {'q': text, 'options': options, 'a': a, 'why': why}


# ---------------------------------------------------------------- 扩写正文
EXPAND = {
    'r01': [
        'Renju looks like a simple game. Two players take turns placing black and white stones on a 15x15 board, and the first player to make an unbroken row of five wins. But a beginner who plays black soon meets a strange rule: some moves are simply not allowed. Why would a game punish a player for making a good move?',
        'The answer is fairness. Long ago, players discovered that a skillful first player could win almost every game of ordinary gomoku. Black moves first, builds a threat, and White can only answer. To balance the game, Japanese masters added restrictions that apply only to Black. Black may not make an overline (six or more stones in a row), a double-four, or a double-three. White has no such limits and may even win with an overline.',
        'These forbidden moves are not minor details. They change the whole way the game is played. A white player can deliberately guide Black toward a point where every natural move breaks one of the rules. Black must then play somewhere else, and White completes a line of five on the next turn. This tactic is called trapping the forbidden points.',
        'For a referee, the difficult part is not the rule but the judgement. A double three counts only when both threes are genuinely open, with room to grow into an open four; a three blocked at one end by the edge of the board or by a white stone is a sleeping three and is not counted. Two players may therefore argue for ten minutes about a single point, and the referee has to decide it at once.',
        'So the restrictions do not make Renju less exciting. They make it a real contest. Black still has a strong weapon, the four-three fork, but even that must be earned: the fork has to be built from stones already on the board, and a careless Black can turn a promising attack into a forbidden point. The rules turn an easy win for the first player into a game where both sides must think many moves ahead.',
    ],
    'r02': [
        'If you ask a Renju player what to aim for, the answer is often the same: make an open four. A four is a line of four stones that can become five with one more stone. When both ends of that line are free, it is called an open four, and it is practically a win.',
        'The reason is simple. Suppose Black has four stones in a straight line and both ends are empty. White must block one end immediately. But after White plays there, the other end is still open, and Black completes five. Blocking a half-open four is easy because there is only one point to defend. An open four has two, and a player has only one move.',
        'Because an open four cannot be defended, good players spend the whole game trying to create one. You cannot usually build it directly. You first make an open three, a line of three stones that can become an open four with one move. The opponent must then block the three, often close to the stones. If the three is a fake one, blocked by the board edge or by a white stone, there is no need to worry.',
        'Not every four has the same shape. In a straight four the stones touch one another; in a jump four one point in the middle is empty, and the line is completed by filling that gap. A jump four is still a four, so White must answer it, but because only one point completes it, it forces a reply instead of winning by itself. Strong players use such forcing moves to gain a tempo before the real attack begins.',
        'Learning to tell a real open three from a fake one takes practice. It also takes patience: a wise opponent will block every serious threat you build. That is why single-line attacks rarely win against strong players, and why the next lesson is the fork.',
    ],
    'r03': [
        'A single threat is never enough against a careful opponent. If you build an open three, it is blocked. If you build a four, it is answered. To win, you need a move that creates two threats at the same time. Such a move is called a fork.',
        'Renju players name three kinds of forks. Two fours make a 4x4 fork. A four plus an open three makes a 4x3 fork. Two open threes make a 3x3 fork. In each case the opponent can defend only one line, so the other line remains open and wins on the following move. Diagrams in rule books mark these points with letters, but on the board you have to see them yourself.',
        'Here the rules of Renju matter again. For Black, the 4x4 and 3x3 forks are forbidden moves, and so is an overline. That leaves the 4x3 fork as Black\'s only legal winning fork. For White, all three kinds are allowed. This is not an accident: the restrictions were designed to offset Black\'s advantage of the first move.',
        'Chains of threats matter as much as single forks. A VCF is a series of fours, each one forcing a block, that ends in five; a VCT is a longer series of threes and fours with the same aim. Because every move in the chain is forced, the defender has no time to build a counter-attack, which is why players calculate such a chain to its last move before playing its first one.',
        'A fork is not always obvious. A three that looks open may be closed by the edge of the board, in which case the 4x3 is not a winning fork at all. Experienced players also look for the "interesting defense", a move far away from the stones that still stops an open three. Judging which threat is real is a skill that separates strong players from beginners.',
    ],
    'r04': [
        'Gomoku began in China and traveled to Japan, where it became known as five-in-a-row. About a hundred years ago, Japanese masters were not satisfied with the game. When two strong players met, the first player almost always won. A game with such a sure result was not interesting enough to be a sport.',
        'Their answer was Renju, a word that means "connected pearls" in Japanese. The new game kept the 15x15 board and the aim of five in a row, but it added the forbidden moves for Black. Later, the opening was also regulated: the first three stones form one of a limited number of patterns, and the players then decide who will be Black and who will be White.',
        'Today Renju is played far beyond East Asia. The International Renju Federation, founded in 1988, maintains the rules and ranks players from many countries. World championships bring together players from Europe, Asia and elsewhere. Games are recorded move by move and studied afterwards, much as chess games are studied.',
        'The names differ from country to country, and the names carry the history. In China the game is wuziqi, "the five-son game"; in Korea it is omok; the Japanese word renju is the one used in international competition. In China it grew as a folk pastime played in teahouses and school clubs, while the Japanese version was reorganised as a competitive sport with ranks, examinations and published records. When the two traditions met, the stricter rules were adopted for tournaments, and the Chinese scene grew quickly around them. A single provincial event may now draw several hundred players, from primary school children to retired teachers.',
        'The game also changed as it traveled. Several opening rules are now used in different events, such as the Yamaguchi, Soosorv and Sakata rules. They all try to do the same thing: give both players a fair chance while keeping the rich tactics that made the game popular in the first place.',
    ],
    'r05': [
        'In ordinary gomoku, the first player simply puts a stone in the center. In tournament Renju, the beginning of the game is more formal. The purpose of the opening rule is to make the first advantage smaller, so that both players must fight for the result.',
        'Under the international rule, two players are first named tentative Black and tentative White. The tentative Black plays the first three moves in the prescribed shapes: two black stones and one white stone. These three stones choose one of 26 patterns, thirteen direct and thirteen indirect. Then the tentative White decides who will actually play Black and who will play White in the game. This right to change sides is an important part of the rule.',
        'After that, the new White plays a fourth stone anywhere on the board. Black must propose two different points for the fifth stone, and White chooses one of them. Only with the sixth move does the special opening end and normal play begin. Passing is not allowed during the first three moves.',
        'The twenty-six patterns have names that sound like a poem: Cold Star, Stream Moon, Flower Moon, Cloud Moon, Silver Moon, Comet. Thirteen are called direct, because the second black stone stands in line with the first; thirteen are indirect, because it stands diagonally. Each name covers a whole family of variations, and a strong player may know the first twenty moves of a dozen of them by heart.',
        'For a beginner, all of this can look complicated. But the logic is clear. Black is given the first move and the attack, while White is given the right to choose the useful side. Beginners are usually told to learn two or three patterns deeply rather than twenty badly. Other opening rules, such as Swap2 and the Yamaguchi rule, arrange the balance in different ways, but they share the same goal.',
    ],
    'r06': [
        'In a Renju tournament, a game is not decided only by the stones. Each player has a clock, and the time runs only while you are thinking about your own move. When you place a stone, you stop your clock and start your opponent\'s. If the time ends before the required number of moves has been made, you lose the game.',
        'This makes the clock a second opponent. A player who spends too long on an early position may reach a winning position with only a few seconds left. Under byoyomi, the player then has a fixed short time for each move. Mistakes come quickly: a missed open four, a forgotten forbidden point, or a stone placed on the wrong intersection.',
        'Time controls come in two main forms. In sudden death each player receives a fixed amount for the whole game, and the clock simply runs down. In byoyomi a player who has used up the main time must play each remaining move within a small fixed period, often thirty seconds, and the clock is reset after every move. Sudden death rewards the player who plans the whole game; byoyomi rewards the one who can think quickly when the end comes.',
        'Time pressure also changes the opening. Some players choose a familiar pattern to save thinking time. Others deliberately play a complicated one, hoping that the opponent will use up the clock. Both plans are legal, and both are risky.',
        'The rules are strict about claiming a win. A player who wants to win must stop both clocks at the same time as the winning move. If Black makes five in a row but does not notice, and the game continues, the win may be lost. Even a perfect position is worth nothing if you forget to claim it in time.',
    ],
    'r07': [
        'Strong Renju players do not simply play many games. They study patterns. A pattern is a shape of stones that returns again and again: an open three, a jump four, a forbidden point near the edge. Once a player recognizes such a shape at a glance, thinking becomes much faster and more reliable.',
        'Memory research suggests that recognition grows when information returns at the right moment. If you see a new term once and then never meet it again, it disappears. If you meet it just as you are about to forget it, the memory becomes stronger. This is why many learners use cards with increasing intervals: one day, then two, then four, then eight.',
        'Renju terms are especially suitable for this method. A card can show "straight four" on one side and a short definition on the other. Another card can ask what happens when Black makes an overline. On the front of the card, you must recall the answer before you turn it over; only then do you judge whether you remembered it well.',
        'Review is the other half of training, and it is the half most players skip. A lost game is more useful than a won one, because the mistakes are still there to be found. The habit that helps is narrow and boring: after each game, mark the move where the plan changed, write one sentence about why, and put the position into a file. After a season the file contains patterns rather than stories, and the same mistake stops repeating. Twenty minutes a day, kept for a year, is worth more than a weekend of frantic study.',
        'The same idea works for English. A Chinese speaker learning Renju vocabulary needs both the game concept and the English word. Reading a short article about forbidden moves puts the words into context, and a card later in the day brings them back. Little by little, "open three" stops being a translation and becomes a thought.',
    ],
    'z02': [
        'In June 2025 the provincial ranking tournament returned to the same shopping centre where the writer had won every game a year before. He signed up happily, thinking that his first-level rank might move up one more step. What followed, he says, was a lesson he had needed for a whole year.',
        'The format gave each player twenty minutes for the entire game, with no extra time added. When a player\'s clock ran out, that player lost, however good the position on the board might be. Most experienced players treat the clock as a second opponent; beginners treat it as furniture.',
        'In the first round he met an amateur who did not even know the two-opening rule. The writer played a careless move and handed his opponent a simple threat. He recovered and won, but promised himself not to relax again.',
        'Round five brought the familiar three-dan boy. The writer made a small change on move nine, and the boy\'s face darkened at once. After the exchange, the boy\'s fourteenth move was a clear mistake. Within a dozen more moves White was lost, and both players were far away from any book they had studied.',
        'At that point the writer began to enjoy himself. He considered three or four plans: a sleeping three to keep the attack alive, a steady block, a direct attack that would finish the game, or simply a loose stone placed to watch the boy\'s expression. Any of them would have won. While he was comparing them, the clock ran out. He had also failed to notice that one of his own ideas would have walked straight into a forbidden point, and the boy, hands pressed together, was waiting for exactly that.',
        'After the seventh round an elder took him aside and told him that losing is normal, and that everyone has days when nothing works. The comfort was kind, but the diagnosis that followed was sharper: all his preparation had been aimed at strong opponents, and against much weaker players those complicated lines only added risk.',
        'He calls the lesson simple and expensive. Time is part of the board, and a player who forgets it has already stopped playing, even if the stones say otherwise.',
    ],
    'z04': [
        'Every summer the world youth renju championship brings young players from many countries together. In July 2026 the fourteenth edition was held, and the writer travelled there with high hopes and a notebook full of openings.',
        'International events punish small habits. At home he could often win with a quick attack, because local opponents would defend in the way he expected. Here every player knew the main openings and answered an attack without hurrying. The board felt narrower than it did at home. At home a single good idea could carry a whole game; here the whole game had to be good, from the first move to the last, and a plan that stopped halfway was worse than no plan at all.',
        'In one game he had a continuous attack in mind. A continuous attack, usually shortened to VCT, is a series of threats that ends in a forced win: each move gives the opponent no choice, and the last one completes five. But he confused it with a looser plan, a chain of threats that looks similar and does not necessarily finish anywhere. He played as if the win were already on the board. His opponent defended calmly and turned the attack around.',
        'He describes the loss with humour rather than bitterness. He had, he says, turned a VCT into an LCT, "lost continuous threat", and so became part of the background of somebody else\'s photograph.',
        'The journey home was quiet. What stayed with him was not the result but the fog: the feeling of believing that you understand a position when you do not. Since then he has trained differently. He now checks every attack to the end before he plays it, and he writes down the exact moment when he stopped calculating.',
        'A loss abroad, he says, is a receipt for lessons that could not have been bought at home.',
    ],
}

# 扩写后给知识类短文各补一道推断题
EXTRA_Q = {
    'r01': q('What can be inferred about a sleeping three?',
             ['It is treated as a normal move for Black.',
              'It does not count towards a double-three foul.',
              'It can never become part of an open four.',
              'It is forbidden for White as well as for Black.'],
             1, '第四段：一端被边线或白子挡住的三叫眠三，不计入三三禁手；只有两个真正的活三才算。'),
    'r02': q('Why does the writer mention a jump four?',
             ['To show that every four wins immediately.',
              'To explain how to block an open four.',
              'To point out that a four can force a reply without winning.',
              'To warn beginners against making open threes.'],
             2, '第四段：跳四中间空一点，只有一个点能成五，所以它是「逼应手」而不是胜着；高手用它抢先手。'),
    'r03': q('Why must a VCF be calculated to its last move?',
             ['Because the defender can build a counter-attack if the chain is wrong.',
              'Because referees check the whole chain afterwards.',
              'Because the chain contains forbidden moves for White.',
              'Because the clock is stopped during a chain.'],
             0, '第四段：链中每一步都是逼应，对手没有时间反击；可一旦链断，主动权立刻交出去，所以必须算到最后一步。'),
    'r04': q('What does the fourth paragraph suggest about the Chinese and Japanese traditions?',
             ['Chinese players rejected the Japanese rules for many years.',
              'The two traditions gave the game different social settings.',
              'Renju was invented in China and exported to Japan unchanged.',
              'Japanese players learned the game from Chinese teahouses.'],
             1, '第四段：中国一脉是茶馆、社团里的民间消遣，日本一脉被组织成有段位、考试与棋谱的职业化运动。'),
    'r05': q('What are beginners advised to do with the twenty-six openings?',
             ['Memorize all of them before their first tournament.',
              'Learn a few of them thoroughly.',
              'Avoid them and play ordinary gomoku.',
              'Study only the thirteen indirect ones.'],
             1, '末段：初学宁可把两三个开局学透，也不要二十六个都学个半生不熟。'),
    'r06': q('What is the main difference between sudden death and byoyomi?',
             ['Sudden death adds time after every move.',
              'Byoyomi gives no time for the opening.',
              'Sudden death gives one budget; byoyomi resets a small period each move.',
              'Byoyomi is only used in team events.'],
             2, '第三段：包干是整盘一份时间用到底；读秒是主时用完后每步一小段固定时间，每步重新计时。'),
    'r07': q('Why is a lost game said to be more useful than a won one?',
             ['It takes less time to review.',
              'The mistakes are still there to be found.',
              'It improves a player\'s official rating.',
              'Opponents explain their plans afterwards.'],
             1, '第四段：输棋里的错误还留在盘上，可以一条条找出来；赢棋往往把问题盖住了。'),
}

# ------------------------------------------------------- 长篇匹配补到 800 词以上
SECT_ADD = {
    ('m01', 'D'): ' He also notes what the event did not need: no entry fee, no ranking points, no opening book. A hall, a set of boards and a free afternoon were enough to fill the room.',
    ('m01', 'F'): ' The course lasted three days, and at the end each trainee had to judge a set of prepared positions and explain the decision aloud.',
    ('m01', 'J'): ' He adds that a title also changes the way other people talk to him, which is the part he likes least.',
    ('m02', 'A'): ' The form also asks for a contact number and a school or club, because both are needed when the entry list has to be corrected.',
    ('m02', 'E'): ' Signs at the entrance of each court repeat the court number, so that a player who arrives late can still find his board without asking.',
    ('m02', 'J'): ' The report is short, usually two pages, and it is circulated to the referees before the next event.',
}

# --------------------------------------------------------------- 新增篇目
NEW = [
    {
        'id': 'z05',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《怎么突然投子了？》',
        'title': 'The Opponent Who Left Too Early',
        'text': [
            'In August 2025 the sixth World Renju Youth Cup was played, and the writer finished with eight wins and one loss, enough for first place in the combined A and B group. The second round, however, ended in a way that he still finds funny.',
            'His opponent was Wang Xinyu, a second-dan from Taiyuan who studies in Jincheng, Shanxi. The two had played many casual Taraguchi-10 games and knew each other\'s style. Wang had started playing official renju that year, and in the first round he had beaten an Estonian player who had been ranked around 517th in the world.',
            'The writer opened one of the indirect patterns and, at the fifth move, offered the three-way variation instead of the balanced four-way one. He was about ninety per cent sure that Wang would not know the follow-up. Wang did not: his sixth move was a single live three, and the writer blocked it and settled down for a long game.',
            'White then made a diagonal live three, a horizontal jump live three, and a one-move four-three. The defence was not hard: he was certain the position was a win for Black. At move fifteen he covered a sleeping three and the attack changed hands. He had four open twos and a choice of finishing lines.',
            'Then Wang resigned. The writer was baffled: the position was good for Black, but the win was still a long way off. Afraid that writing in Chinese on the Estonian platform might look like collusion, he typed "What??" in English. Wang answered at once: "I lost, I lost." He had decided that his position was hopeless and did not want to spend his energy on a sad defence when later rounds were still to come.',
            'The writer is grateful, and honest about why. He has a habit of playing a magnificent attacking game and then, one move before the kill, producing a blunder that gives the game away. Wang had simply skipped that part of the story for him. Wang went on to beat a well-known Beijing player and the writer\'s first-round opponent, finishing twentieth. He lost one game after spending twenty minutes repairing his video equipment, and came within a move of beating a Russian player ranked 282nd.',
        ],
        'gloss': [
            ['indirect pattern', '斜止开局（第二颗黑子与第一颗成斜线）'],
            ['variation', '变化，变例'],
            ['live three', '活三'],
            ['four-three', '四三（同时形成四与活三）'],
            ['collusion', '串通，通棋'],
            ['blunder', '低级失误，漏着'],
        ],
        'questions': [
            q('What does the writer say about Wang Xinyu before their game?',
              ['He had never played the Taraguchi-10 rule.',
               'He had beaten a much higher-ranked player in round one.',
               'He had won the previous World Youth Cup.',
               'He had studied the writer\'s openings for months.'],
              1, '第二段：王鑫宇第一轮击败了赛前国际排名约 517 位的爱沙尼亚选手，可见实力不弱。'),
            q('Why did the writer choose the three-way fifth move?',
              ['He wanted a quiet, balanced position.',
               'He was testing whether his opponent knew the forced win.',
               'He had forgotten the main line.',
               'The referee had asked him to vary his openings.'],
              1, '第三段：他「有九成把握对方不会这个必胜的后续」，所以直接走三打来考对方。'),
            q('Why was the writer puzzled by the resignation?',
              ['The position on the board was equal.',
               'He thought Wang had a forced win.',
               'Black was better but far from a forced win.',
               'The clocks had not yet been started.'],
              2, '第五段：局面黑方优势很大，但离必胜还很漫长，所以他无法理解对方为何此时认输。'),
            q('Why did he write in English rather than Chinese?',
              ['His Chinese input method was broken.',
               'He wanted the referee to understand him.',
               'He feared a Chinese message might look like collusion.',
               'Wang did not read Chinese.'],
              2, '第五段：他担心在爱沙尼亚平台上用中文会被当成「传递密约通棋」，所以用英文打了一句 What??。'),
            q('What does the last paragraph suggest about the writer?',
              ['He believes he was lucky to win the title.',
               'He is aware of his own habit of blundering before the finish.',
               'He thinks Wang should have continued the game.',
               'He plans to stop playing attacking openings.'],
              1, '末段：他自陈常在「出杀前一步」出现低级失误，因此很感谢对方跳过了这一段。'),
        ],
    },
    {
        'id': 'z06',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《市民之家的恩赐之地》',
        'title': 'A Room Where Tea and Stones Meet',
        'text': [
            'On 23 February 2025 the Luoyang Gomoku Association opened a training base on the top floor of the Citizens\' Home, in rooms lent by the city\'s tea art association. The plaque was unveiled by He Quanliang, executive president of the gomoku association, and Liang Jingmin, president of the tea association, before members of both groups.',
            'The writer came in from Zhengzhou and arrived with the eye of a visitor. He noticed the new district outside, the pop music in a burger shop, the sound of water boiling upstairs, and only then the click of stones. The room had been prepared with boards, clocks and a small library of game records; chairs were carried in and tea was poured.',
            'His own part was a lecture on the rules for beginners, many of whom had never met forbidden moves. He had prepared carefully and still felt that the words came out crooked: the rules arrived dressed in too much theory and produced a room of firm and confused faces. Two practical examples saved the talk, and the audience kept asking about the three-three and the overline.',
            'In the quick games that followed, the writer took White, saw a line that would have won, and chose instead to lose quickly. The afternoon, he says, was not about another victory. A base matters because it gives new players a fixed evening in the week, and a fixed evening is what turns a curious visitor into a member of the club. The city already had players; what it lacked was a place where they could meet without waiting for a tournament.',
            'He left with a gift of Ordos specialities from a player who had travelled a long way, and with the feeling that a scene is built out of such rooms rather than out of trophies. The plaque on the wall, he writes, is only the visible part; the rest is a kettle, a clock and somebody willing to explain a rule for the tenth time.',
            'The essay ends on the street outside, where children were laughing and a shop was cutting its spring prices, as on any other afternoon. The difference was a door on the top floor that would now be open on the same evening every week.',
        ],
        'gloss': [
            ['plaque', '牌匾'],
            ['unveil', '揭幕'],
            ['executive president', '执行会长'],
            ['crooked', '歪的；此处指讲得不顺'],
            ['overline', '长连（六子及以上）'],
            ['specialities', '特产'],
        ],
        'questions': [
            q('What was held on 23 February 2025?',
              ['A provincial ranking tournament.',
               'The opening of a training base in Luoyang.',
               'A referee course for beginners.',
               'The first meeting of a new tea association.'],
              1, '第一段：洛阳五子棋协会在市民之家顶层开设训练基地，两位会长共同揭牌。'),
            q('What does the writer suggest about his lecture?',
              ['It was cancelled because of the tea ceremony.',
               'It was too theoretical for the audience at first.',
               'It was given by the tea association president.',
               'It lasted longer than the games that followed.'],
              1, '第三段：他觉得自己「词不达意」，禁手规则穿着理论的外衣来到教室，造成「千万张坚定而迷惑的脸」，靠两个实例才救回来。'),
            q('Why did the writer lose the practice game on purpose?',
              ['He was short of time.',
               'He wanted to keep the friendly atmosphere of the afternoon.',
               'He had already lost a bet with the referee.',
               'He was testing a new opening.'],
              1, '第四段：他执白已看到反击成胜的线路，却「无心取胜，只愿速败一盘，延续这份完美的快乐」。'),
            q('According to the writer, what makes a training base valuable?',
              ['It attracts sponsors for tournaments.',
               'It provides a fixed weekly evening for players to meet.',
               'It offers official ranks and certificates.',
               'It keeps a complete library of professional games.'],
              1, '第四段：基地的价值在于给新棋手一个固定的晚上，把偶尔来一次的访客变成俱乐部的成员。'),
            q('What is the main point of the last two paragraphs?',
              ['The street outside had changed a great deal.',
               'A plaque is the most important part of a club.',
               'A scene grows from ordinary rooms and regular meetings.',
               'The writer prefers tea to tournament play.'],
              2, '末两段：牌匾只是看得见的部分，其余是一只水壶、一台棋钟和一个愿意把规则讲第十遍的人；街区与往常一样，不同的只是顶层那扇每周固定开放的门。'),
        ],
    },
    {
        'id': 'z07',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《脱谱必胜 攻防大战》',
        'title': 'The Move That Was in No Book',
        'text': [
            'On 21 July 2024 the professional group of the Henan Open finished in a shopping centre in Zhengzhou. The writer won all seven rounds under the Taraguchi-10 rule, with thirty minutes each for the whole game. He was pleased with the result and unimpressed by his own play: against an engine, his moves were the least accurate of his year.',
            'The fourth round was the game he published. His opponent, Gao Haofei, was a calculating player with a long record, and had found a twelve-move forced win that weekend. The opening was Gold Star with a standard fourth move, and Black offered the second of two fifth moves.',
            'The variation that followed is well known, and it is a forced win for Black. The writer declined it for three reasons: the line is long, the viewpoint from the board is awkward, and it is not new. Instead he played a modern eleventh move he knew to be strong without knowing the details. White thought for a long time and made two open twos.',
            'Black blocked one of them and made two open twos of his own. White answered with a live three, and Black blocked it while making a jump sleeping three. Then White produced a one-move four-three, and the position began to look dangerous. By then he had used most of his time, and players from finished boards were gathering. He could not calculate the whole line, so he chose a solid defence: two jump fours and a jump live three that covered the threat. His opponent nodded, which is the highest praise a defender gets.',
            'Both players were down to three or four minutes. Black made a live three on the left, then one on the right, and then played out the rest of the forced win. White built an overline, but it came too late. White\'s reply had in fact allowed a one-move four-three he never saw; he played a longer forced win instead.',
            'The lesson he draws is narrow and useful. When a short and a long kill exist together, he tends to find the long one and miss the short one. He has done it before, and he now checks for the short kill before he starts calculating.',
        ],
        'gloss': [
            ['professional group', '专业组'],
            ['forced win', '必胜'],
            ['viewpoint', '视角（从棋盘一侧看出去的方位）'],
            ['jump sleeping three', '跳眠三'],
            ['overline', '长连'],
            ['resign', '投子认负'],
        ],
        'questions': [
            q('Why was the writer unhappy with his play despite winning every round?',
              ['He had lost one game on time.',
               'His moves matched the engine less often than usual.',
               'He had prepared no openings at all.',
               'The referee had warned him about his conduct.'],
              1, '第一段：他自评发挥一般，按引擎衡量，这站的着法质量是当年有禁手比赛里最差的一次。'),
            q('Why did he refuse the well-known forced win?',
              ['It was not actually a win.',
               'It was long, awkward to see from his seat, and unoriginal.',
               'His opponent had already played it against him.',
               'The clock did not allow it.'],
              1, '第三段：他给出三条理由——线路太长、视角不好、没有新意。'),
            q('What made the position difficult after White\'s one-move four-three?',
              ['His clock was nearly empty and spectators were gathering.',
               'He had made a forbidden move by accident.',
               'His opponent had an open four.',
               'The referee had stopped the clock.'],
              0, '第四段：他已用掉大半时间，周围台次陆续结束、许多人围观，压力之下无法算尽，只能选择严防。'),
            q('What mistake did he make at the end of the game?',
              ['He claimed the win too early.',
               'He missed a shorter four-three and played a longer win.',
               'He allowed White to make five first.',
               'He forgot to stop his clock.'],
              1, '第五段：白方应手其实送了一步四三，他没看到，走了更长的 VCF；对手没等到差别显现就投了。'),
            q('What is the lesson he draws from the game?',
              ['Long forced wins should be avoided altogether.',
               'He should spend more time on the opening.',
               'He tends to find the long kill and miss the short one.',
               'Spectators should be kept away from the boards.'],
              2, '末段：短杀与长杀同时存在时，他常常先算到长杀而漏掉短杀，所以现在先检查短杀再开始计算。'),
        ],
    },
    {
        'id': 'z08',
        'type': 'careful',
        'topic': '杂论',
        'source': '杂论《2024河南省五子棋（夏季）等级赛游记①》',
        'title': 'A Game the Night Before',
        'text': [
            'The day before the 2024 Henan summer ranking tournament, the writer visited a gomoku club in Zhengzhou and played a three-dan woman under the Taraguchi-10 rule. It was his first serious game in nearly a year. He had played almost nothing since the previous summer\'s provincial mind sports games, and came to the board without preparation.',
            'His opponent opened, he swapped, and she chose an indirect pattern. He answered with one of the twenty-six openings and then could not remember whether he had seen it before. He could name four or five forced wins for Black but could not judge the balance, so he swapped again and let her choose the fifth move.',
            'After the game he looked the opening up in a database and found that it was not recorded at all, which suggested it should be a win for White. The engine, however, gave White only about seventy per cent, so the win would be hard to find. Her sixth move was not the best one, and the position slowly became his.',
            'The middle game was nearly symmetrical. He spent more than five minutes on one decision, chose the quieter side because it left room to grow, and gradually built open twos while hers ran out of space. Then, in the middle of a promising attack, he blocked a live three automatically, because it looked natural. He felt his opponent relax at once, and knew the move had been wrong.',
            'White then made a sleeping three and an open two. He considered three defences, rejected two, and chose the least ambitious. White replied with a move he had not expected, and the initiative passed back to him. A young local player later said his next move had been too cautious: the lower side was empty, and he could have built there.',
            'The game lasted over an hour. He found a seven-move forced win, calculated it for six minutes before playing it, and White resigned at move thirty-three. He won, but he felt that his opponent, knowing he had not played for a year, had not shown everything. The value of the evening, he says, was not the result but the adjustment: the next day he sat down already used to the board.',
        ],
        'gloss': [
            ['three-dan', '三段'],
            ['swap', '交换（决定执黑或执白）'],
            ['symmetrical', '对称的'],
            ['initiative', '先手，主动权'],
            ['cautious', '保守的，谨慎的'],
            ['adjustment', '适应，调整'],
        ],
        'questions': [
            q('Why was the club game unusual for the writer?',
              ['He had never played the Taraguchi-10 rule.',
               'It was his first serious game in about a year.',
               'He was playing against a professional referee.',
               'It was played without a clock.'],
              1, '第一段：自去年省智运会以来近一年没下棋，谱量几乎为零，这盘是他一年来第一盘正式对局。'),
            q('What did the database check after the game show?',
              ['The opening was a known win for Black.',
               'The opening was not recorded, and should favour White.',
               'His opponent had used a forbidden move.',
               'The game had been played in the wrong order.'],
              1, '第三段：开局库里没有记载此开局，说明应是白必胜；但引擎给白方只有七成，必胜难度很大。'),
            q('How did he know that one of his middle-game moves was wrong?',
              ['The referee pointed it out.',
               'His opponent relaxed immediately afterwards.',
               'The engine was running beside the board.',
               'He lost on time soon after.'],
              1, '第四段：他半分钟内顺手挡了一下，随后察觉对方「明显没有先前那么紧张，轻松了许多」，立刻意识到这步可能不对。'),
            q('What did the young local player think of his play?',
              ['It was too cautious in a position that offered more.',
               'It was the best sequence of the game.',
               'It ignored a forced win for White.',
               'It broke the two-opening rule.'],
              0, '第五段：本省少年棋手认为他那步「比较保守」，完全可以在下侧广阔空间做棋，不必去挡对方仅剩的活二。'),
            q('What does the writer say was the real value of the evening?',
              ['He learned a new opening for the tournament.',
               'He proved that he was still the stronger player.',
               'He got used to competitive play before the tournament.',
               'He found a training partner for the season.'],
              2, '末段：他认为这盘棋的价值不在胜负，而在「适应」——第二天正式比赛时已经熟悉了棋盘。'),
        ],
    },
    {
        'id': 'm03',
        'type': 'matching',
        'topic': '杂论',
        'source': '洛阳五子棋月赛系列、全民健身月、迎新杯、果立方杯',
        'title': 'Ten Months, One Association',
        'sections': [
            {'l': 'A', 't': 'The calendar', 'text': 'In 2026 the Luoyang Gomoku Association stopped waiting for a single big event and spread its season across the year. A monthly or venue-based tournament was held in February, March, April, May, September and October, each in a different place: an art space, a community centre, a department store. The first two stops were only a fortnight apart, because the New Year holiday and the start of the school term left no better window. Players began to treat the series as a calendar rather than as news.'},
            {'l': 'B', 't': 'The first stop', 'text': 'The season opened on 22 February, the sixth day of the New Year holiday, in the Hui Fu Tang art space, which also serves as the city\'s training base. Two groups played side by side, an open group and an unrated group, over five rounds. Li Dan won the open group; the unrated group was won by Lü Zihao, who was ten years old. Grandfathers and schoolchildren sat at neighbouring boards, which the organisers described as the point of the day rather than an accident.'},
            {'l': 'C', 't': 'The community room', 'text': 'The second stop moved into a residential community, in the party-mass service centre of the Tianyuan neighbourhood in Luolong District. It was organised by the association with support from its president unit, a local culture company, and it filled the room with players from the surrounding streets. Zhao Yan won the open group. Holding an event inside a community, rather than asking residents to travel to a gymnasium, brought in people who had never entered a tournament before.'},
            {'l': 'D', 't': 'The shopping mall', 'text': 'The April stop was timed for the 43rd Peony Culture Festival and placed in the West Plaza Wangfujing department store, with boards laid out in the atrium. Three competitions ran at once: an open individual event, an unrated group for children, and a pairs event. Shoppers stopped to watch, and some of them asked how to enter the next one. A mall is noisy and has no proper playing hall, but it puts the game in front of people who would never look for it.'},
            {'l': 'E', 't': 'Who takes part', 'text': 'The entry list of the April event shows how wide the field had become. University students travelled in from other districts; a strong international chess player came to test a different board game; a Go teacher brought a group of students to compare notes. The association\'s president unit covered the costs, and local companies provided prizes. None of these players belonged to a renju club, and most of them had learned the rules within the past two years.'},
            {'l': 'F', 't': 'The parent-child event', 'text': 'On 23 May, ahead of Children\'s Day, the association held a family tournament with three groups: parent and child pairs, an unrated children\'s group, and ordinary pairs. Each game allowed twenty minutes, after which a clock was started with five extra minutes for each player. The youngest entrant was six years old and was playing his second tournament. Organisers said the children were quieter at the board than their parents, who tended to point at the stones.'},
            {'l': 'G', 't': 'Playing in pairs', 'text': 'The pairs events are the association\'s own invention, and they are the loudest part of the day. Two players sit on the same side of the board, discuss every move in a low voice, and are not allowed to touch a stone until they agree. Wei Chenyi and Wei Ziqing won the parent-child group; Tang Bi and Pan Guanchen won the open pairs. Beginners like the format because a mistake is shared, and strong players like it because explaining a plan out loud is harder than playing it.'},
            {'l': 'H', 't': 'The September meeting room', 'text': 'In September the series came back to the Tianyuan community, this time to a second-floor meeting room. There was no stage, no banner wall and no spectator area: office desks were pushed together in pairs to make playing tables, and the room fell silent as soon as the first round began. Players who wanted to think stood up and walked to the window. The organisers call this the plainest event of the year, and also the easiest to repeat, because it needs nothing that a community centre does not already have.'},
            {'l': 'I', 't': 'The autumn stop', 'text': 'The last stop of the season returned to the same department store, on the fourth floor this time, at the end of October. Again there were three events, and again the entry list mixed children, students and older players. Holding two stops in one building was deliberate: the store\'s managers had seen the crowd in April, and the second visit cost the association almost nothing to arrange. The series ended where the year\'s biggest audience already was.'},
            {'l': 'J', 't': 'Why a monthly series', 'text': 'The association\'s stated aim is a change of verb: to move players from "make me play" to "I want to play". A single annual championship produces one day of attention and eleven months of silence, while a monthly series gives a beginner a date to prepare for and a reason to come back. Entries still arrive on the morning of an event, which the organisers accept as a sign of interest rather than a problem. What the series builds is not a champion but a habit.'},
        ],
        'statements': [
            {'q': 'Two players shared one side of the board and had to agree before touching a stone.', 'a': 'G', 'why': 'G 段讲双人联棋：两人同坐一侧、低声商议，未达成一致不能落子。'},
            {'q': 'The season began during the New Year holiday.', 'a': 'B', 'why': 'B 段：2 月 22 日，丙午年大年初六，在晖福堂艺术交流空间开赛。'},
            {'q': 'The organisers want players to ask for tournaments instead of being persuaded to attend.', 'a': 'J', 'why': 'J 段：协会的目标是把「要我下棋」变成「我要下棋」。'},
            {'q': 'One event was arranged to coincide with a flower festival.', 'a': 'D', 'why': 'D 段：4 月那站赶在第 43 届洛阳牡丹文化节期间。'},
            {'q': 'The first two stops of the year were held only two weeks apart.', 'a': 'A', 'why': 'A 段：前两站只隔两周，因为年假与开学之间没有更好的窗口。'},
            {'q': 'The youngest player at one event was six years old.', 'a': 'F', 'why': 'F 段：六一亲子赛最小的选手六岁，已是第二次参赛。'},
            {'q': 'An event took place in a neighbourhood party-mass service centre in March.', 'a': 'C', 'why': 'C 段：第二站走进洛龙区天元社区党群活动中心。'},
            {'q': 'The same department store hosted the series twice in one year.', 'a': 'I', 'why': 'I 段：10 月底回到同一家百货，这次在四楼。'},
            {'q': 'A player of another board game came to try his hand.', 'a': 'E', 'why': 'E 段：有国际象棋高手跨界挑战、围棋教师带队前来。'},
            {'q': 'Office desks were pushed together to make playing tables.', 'a': 'H', 'why': 'H 段：9 月那站把办公桌两两拼成棋桌，没有观众席。'},
        ],
        'gloss': [
            ['fortnight', '两星期'],
            ['atrium', '（商场）中庭'],
            ['party-mass service centre', '党群活动中心'],
            ['unrated group', '无级组'],
            ['entrant', '参赛者'],
            ['entry list', '报名表'],
        ],
    },
]


def sort_key(p):
    order = {'r': 0, 'z': 1, 'm': 2}
    pid = p['id']
    return (order.get(pid[0], 9), int(pid[1:]))


def main():
    check_only = '--check' in sys.argv
    with io.open(PATH, encoding='utf-8') as f:
        data = json.load(f)

    by_id = {p['id']: p for p in data['passages']}

    for pid, text in EXPAND.items():
        if pid not in by_id:
            raise SystemExit('缺少待扩写篇目 %s' % pid)
        by_id[pid]['text'] = text
        extra = EXTRA_Q.get(pid)
        if extra and len(by_id[pid]['questions']) < 5:
            by_id[pid]['questions'].append(extra)

    for (pid, letter), extra in SECT_ADD.items():
        for sec in by_id[pid]['sections']:
            if sec['l'] == letter:
                sec['text'] = sec['text'].rstrip() + extra
                break
        else:
            raise SystemExit('%s 没有段落 %s' % (pid, letter))

    added = 0
    for p in NEW:
        if p['id'] in by_id:
            by_id[p['id']] = p
        else:
            data['passages'].append(p)
            by_id[p['id']] = p
            added += 1

    data['passages'] = sorted(by_id.values(), key=sort_key)
    data['count'] = len(data['passages'])

    bad = []
    for p in data['passages']:
        if p.get('type') == 'matching':
            n = len(' '.join(s['text'] for s in p['sections']).split())
            if n < 800:
                bad.append('%s 匹配 %d 词' % (p['id'], n))
        else:
            n = len(' '.join(p['text']).split())
            if not (300 <= n <= 375):
                bad.append('%s 仔细 %d 词' % (p['id'], n))

    for p in data['passages']:
        if p.get('type') == 'matching':
            print('%s matching %4d 词 %2d 段 %2d 题 | %s' % (
                p['id'], len(' '.join(s['text'] for s in p['sections']).split()),
                len(p['sections']), len(p['statements']), p['title']))
        else:
            print('%s careful  %4d 词 %2d 题 | %s' % (
                p['id'], len(' '.join(p['text']).split()), len(p['questions']), p['title']))
    print('共 %d 篇，新增 %d 篇' % (data['count'], added))
    if bad:
        print('长度不合规：' + '；'.join(bad))
        if check_only:
            return 1

    raw = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    with open(PATH, 'wb') as f:
        f.write(raw.replace('\n', '\r\n').encode('utf-8'))
    print('已写入 %s' % os.path.relpath(PATH, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
