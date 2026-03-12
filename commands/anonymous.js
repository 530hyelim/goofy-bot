import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('anonymous')
        .setDescription('익명 메시지')
        .addStringOption((o) =>
            o
                .setName('내용')
                .setDescription('전송된 메시지의 발신자 정보는 저장되지 않습니다.')
                .setRequired(true)
                .setMaxLength(2000)
        ),

    async execute(interaction) {
        const content = interaction.options.getString('내용', true).trim();
        if (!content) {
            return interaction.reply({ content: '내용을 입력해주세요.', flags: 64 });
        }

        try {
            await interaction.channel.send(content);
            return interaction.reply({ content: '전송되었습니다.', flags: 64 });
        } catch (err) {
            return interaction.reply({ content: '전송에 실패했습니다.', flags: 64 }).catch(() => {});
        }
    },
};
