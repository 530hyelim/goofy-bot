import cron from 'node-cron';
import { client } from './index.js';
import { supabase } from './index.js';
import { sendError } from './commonFunc.js';
import { getRankString } from './commands/ranking.js';

export function startCrons() {
    const codingChannel = client.channels.cache.get(process.env.CODING_CHANNEL_ID);

    cron.schedule('0 0 1 * *', async () => {
        try {
            const result = await getRankString();
            await codingChannel.send(result);

            const { error } = await supabase.from('users').update({ total_score: 0 }).neq('total_score', 0);
            if (error) throw new Error(error);
            else await sendError(`점수 초기화 성공!!`);

        } catch (err) {
            await sendError(`점수 초기화 중 예외 발생 : ${err?.stack || err}`);
        }
    });
}
