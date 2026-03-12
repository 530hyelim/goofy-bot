import 'dotenv/config';
import { supabase, client } from '../index.js';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { sendError } from '../utils/commonFunc.js';

export async function getRankString(guildId) {
    const { data: ranking, error: qErr } = await supabase
        .from('users')
        .select('*')
        .eq('guild_id', guildId)
        .order('total_score', { ascending: false });

    if (qErr) throw new Error(qErr);
    if (!ranking || ranking.length === 0) throw new Error('랭킹 데이터가 없습니다.');

    const guild = client.guilds.cache.get(guildId);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    let result = `🏆 **${year}년 ${month}월 랭킹**\n`;
    result += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < ranking.length; i++) {
        const rank = i < 3 ? medals[i] : `${i + 1}.`;
        let displayName = ranking[i].username;
        if (guild) {
            try {
                const member = await guild.members.fetch(ranking[i].user_id);
                displayName = member?.displayName || ranking[i].username;
            } catch (e) {}
        }
        result += `${rank} **${displayName}** - ${ranking[i].total_score}점\n`;
    }

    const totalScore = ranking.reduce((sum, u) => sum + (u.total_score || 0), 0);
    result += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    result += `📊 참여자 수: **${ranking.length}명**\n`;
    result += `📈 총점: **${totalScore}점**`;

    const embed = new EmbedBuilder()
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
            const result = await getRankString(interaction.guild.id);
            return interaction.reply(result);
        } catch (err) {
            await sendError(`⚠️ rank.js Error: ${err?.stack || err}`, interaction.guildId);
            if (!interaction.replied) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        }
    }
};
