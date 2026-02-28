import 'dotenv/config';
import { upsertUserScore } from '../commonFunc.js';
import { getCorrectAnswer, resetCorrectAnswer } from './question.js';

export default {
    name: 'answer',
    description: '정답 입력',
    async execute(message, args) {
        const correctAnswer = getCorrectAnswer();

        if (!correctAnswer) return;
        if (!args.length) return;
        const userAnswer = args.join(' ').trim();
        
        try {
            let 정답;
            const answerArr = correctAnswer.answer.replace(/[\s\W_]+/g, ' ').split(' ');

            switch(correctAnswer.type) {
                case 1: // 일치
                    if (userAnswer == correctAnswer.answer.trim()) 정답 = true;
                    else 정답 = false;
                    break;

                case 2: // 포함
                    정답 = true;
                    answerArr.forEach(answer => {
                        if (!userAnswer.includes(answer)) 정답 = false;
                    });
                    break;

                case 3: // 동순
                    정답 = true;
                    let order = new Array();
                    answerArr.forEach(answer => {
                        order.push(userAnswer.indexOf(answer));
                    });
                    for (let i = 0; i < order.length - 1; i++) {
                        if (order[i] > order[i + 1]) 정답 = false;
                    }
                    break;

                default:
            }
            
            if (!정답) return message.reply("떙!!!!");
            const author = message.author;

            await upsertUserScore(author.id, author.username, 2);
            resetCorrectAnswer();
            return message.reply(`💯 ${author.username}님 정답! +2 포인트`);

        } catch (err) {
            const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                logChannel.send(`answer.js Error: ${err?.stack || err}`);
            } else {
                const members = await message.guild.members.fetch();
                const targetUsers = members.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));

                for (const [id, member] of targetUsers) {
                    await member.send(`answer.js Error: ${err?.stack || err}`);
                }
            }
        }
    }
};