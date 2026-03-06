import 'dotenv/config';
import { supabase } from '../index.js';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { sendError } from '../commonFunc.js';

export async function getRankString() {
    const { data: ranking, error: qErr } = await supabase
        .from('users')
        .select('*')
        .order('total_score', { ascending: false });

    if (qErr) throw new Error(qErr);
    if (!ranking || ranking.length === 0) throw new Error('랭킹 데이터가 없습니다.');

    let result = '';
    for (let i = 0; i < ranking.length; i++) {
        switch (i) {
            case 0: result += `🥇등 : `; break;
            case 1: result += `🥈등 : `; break;
            case 2: result += `🥉등 : `; break;
            default: result += `${i+1}등 : `;
        }
        result += `${ranking[i].username} - ${ranking[i].total_score}점\n`;
    }

    const embed = new EmbedBuilder()
        .setTitle(`${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월 랭킹`)
        .setDescription(result)
        .setColor("#5865F2");

    return { embeds: [embed] };
}

export default {
    data: new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('랭킹 조회'),

    async execute(interaction) {
        try {
            const result = await getRankString();
            return interaction.reply(result);
        } catch (err) {
            await sendError(`rank.js Error: ${err?.stack || err}`);
            if (!interaction.replied) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        }
    }
};
