require('dotenv').config()
const express = require('express')
const axios = require('axios')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const cloudinary = require('cloudinary').v2
const multer = require('multer')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

const {
  CLIENT_ID, CLIENT_SECRET, BOT_TOKEN,
  GUILD_ID, SALES_CHANNEL_ID, REDIRECT_URI, SITE_URL,
  CLOUDINARY_NAME, CLOUDINARY_KEY, CLOUDINARY_SECRET
} = process.env

// Supabase
const supabase = createClient(
  'https://fekltmaxsiibptpqpsxi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2x0bWF4c2lpYnB0cHFwc3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjUyNzksImV4cCI6MjA5MTYwMTI3OX0.8hOnDzinM-zdC6GKWJtIiPtEjG9igGkl0YobQxzdigs'
)

// Cloudinary
cloudinary.config({
  cloud_name: CLOUDINARY_NAME,
  api_key: CLOUDINARY_KEY,
  api_secret: CLOUDINARY_SECRET
})

// Função de enviar embed no Discord
async function enviarEmbed(embed) {
  await axios.post(
    `https://discord.com/api/channels/${SALES_CHANNEL_ID}/messages`,
    { embeds: [embed] },
    { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  )
}

// Socket.io
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id)

  socket.on('carregar_mensagens', async () => {
    const { data } = await supabase
      .from('mensagens')
      .select('*')
      .order('created_at', { ascending: true })
    socket.emit('mensagens_antigas', data || [])
  })

  socket.on('nova_mensagem', async (dados) => {
    const { userId, username, avatar, conteudo, isAdmin } = dados
    const { data } = await supabase
      .from('mensagens')
      .insert([{ user_id: userId, username, avatar, conteudo, is_admin: isAdmin || false }])
      .select()
      .single()
    io.emit('mensagem_recebida', data)
  })

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id)
  })
})

// Upload de arquivo
const upload = multer({ storage: multer.memoryStorage() })

app.post('/upload', upload.single('arquivo'), async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { resource_type: 'auto' },
        (error, result) => error ? reject(error) : resolve(result)
      ).end(req.file.buffer)
    })
    res.json({ url: result.secure_url })
  } catch (err) {
    res.status(500).json({ error: 'Erro no upload' })
  }
})

// ==========================================
// ROTA 1: Callback do login com Discord
// ==========================================
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'Code não encontrado' })

  try {
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

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    })

    const user = userRes.data

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`

    const nickname = user.global_name || user.username

    await supabase.from('usuarios').upsert({
      user_id: user.id,
      username: user.username,
      nickname,
      avatar: avatarUrl
    })

    await axios.put(
      `https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}`,
      { access_token },
      { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    )

    res.redirect(
      `${SITE_URL}/sucesso?userId=${user.id}&username=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(avatarUrl)}&nickname=${encodeURIComponent(nickname)}`
    )

  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro no login' })
  }
})

// ==========================================
// ROTA 2: Venda aprovada
// ==========================================
app.post('/venda-aprovada', async (req, res) => {
  const { userId, username, produto } = req.body

  if (!userId || !username || !produto) {
    return res.status(400).json({ error: 'Dados incompletos' })
  }

  try {
    await enviarEmbed({
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
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar embed' })
  }
})

// ==========================================
// ROTA 3: Chat criado
// ==========================================
app.post('/chat-criado', async (req, res) => {
  const { userId, username } = req.body

  if (!userId || !username) {
    return res.status(400).json({ error: 'Dados incompletos' })
  }

  try {
    await enviarEmbed({
      title: '💬 Novo Chat Aberto!',
      color: 0x5865F2,
      fields: [
        { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
        { name: '🏷️ Username', value: username, inline: true },
        { name: '🆔 User ID', value: `\`${userId}\``, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Sistema de Suporte' }
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar embed' })
  }
})

// ==========================================
// ROTA 4: Chat deletado
// ==========================================
app.post('/chat-deletado', async (req, res) => {
  const { userId, username } = req.body

  if (!userId || !username) {
    return res.status(400).json({ error: 'Dados incompletos' })
  }

  try {
    await enviarEmbed({
      title: '🗑️ Chat Encerrado!',
      color: 0xED4245,
      fields: [
        { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
        { name: '🏷️ Username', value: username, inline: true },
        { name: '🆔 User ID', value: `\`${userId}\``, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Sistema de Suporte' }
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar embed' })
  }
})

server.listen(3000, () => console.log('✅ Backend rodando na porta 3000'))
