require('dotenv').config()
const express = require('express')
const axios = require('axios')
const cors = require('cors')
const app = express()

app.use(cors())
app.use(express.json())

const {
  CLIENT_ID, CLIENT_SECRET, BOT_TOKEN,
  GUILD_ID, SALES_CHANNEL_ID, REDIRECT_URI
} = process.env

// ==========================================
// ROTA 1: Callback do login com Discord
// ==========================================
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'Code não encontrado' })

  try {
    // Trocar o code pelo access_token
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const { access_token } = tokenRes.data

    // Pegar perfil do usuário
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    })

    const user = userRes.data

    // Adicionar usuário ao servidor automaticamente
    await axios.put(
      `https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}`,
      { access_token },
      { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    )

    // Redireciona de volta pro site com os dados do usuário
    res.redirect(`https://cerberusshop.lovable.app/sucesso?userId=${user.id}&username=${encodeURIComponent(user.username)}`)

  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro no login' })
  }
})

// ==========================================
// ROTA 2: Venda aprovada → envia embed
// ==========================================
app.post('/venda-aprovada', async (req, res) => {
  const { userId, username, produto } = req.body

  try {
    await axios.post(
      `https://discord.com/api/channels/${SALES_CHANNEL_ID}/messages`,
      {
        embeds: [{
          title: '✅ Venda Aprovada!',
          color: 0x57F287,
          fields: [
            { name: '👤 Comprador', value: `<@${userId}>`, inline: true },
            { name: '🏷️ Username', value: username, inline: true },
            { name: '🛒 Produto', value: produto, inline: false },
            { name: '🆔 User ID', value: `\`${userId}\``, inline: false },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'Sistema de Vendas' }
        }]
      },
      { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    )

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar embed' })
  }
})

app.listen(3000, () => console.log('✅ Backend rodando na porta 3000'))
