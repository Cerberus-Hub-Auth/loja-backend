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

// Cargos e valores por produto
const CARGOS = {
  'Source Scripts': '1506395366352879698',
  'Sources Bots': '1506395468555489350'
}

const VALORES = {
  'Source Scripts': 'R$10,00',
  'Sources Bots': 'R$10,00'
}

// Hora formatada BR
function horaAtual() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

// Enviar mensagem com Components V2
async function enviarComponente(payload) {
  await axios.post(
    `https://discord.com/api/channels/${SALES_CHANNEL_ID}/messages`,
    payload,
    { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  )
}

// Dar cargo ao usuário
async function darCargo(userId, cargoId) {
  try {
    await axios.put(
      `https://discord.com/api/guilds/${GUILD_ID}/members/${userId}/roles/${cargoId}`,
      {},
      { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    )
    console.log(`✅ Cargo ${cargoId} dado para ${userId}`)
  } catch (err) {
    console.error('Erro ao dar cargo:', err.response?.data || err.message)
  }
}

// Socket.io
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

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

  console.log('Produto recebido:', produto)
  console.log('Cargo encontrado:', CARGOS[produto])

  try {
    const cargoId = CARGOS[produto]
    let cargoTexto = 'Nenhum cargo entregue'

    if (cargoId) {
      await darCargo(userId, cargoId)
      cargoTexto = `<@&${cargoId}>`
    }

    await enviarComponente({
      flags: 32768,
      components: [
        {
          type: 17,
          accent_color: 0xFF0000,
          components: [
            {
              type: 10,
              content: '## Nova Venda Aprovada!'
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `## <:Pessoas:1498405201844113524>・Usuário\n<@${userId}> (${username})\n## <:Carrinho:1498003085136756959>・Produto\n${produto}\n## <a:gears:1483654818819080362>・Cargo Entregue\n${cargoTexto}`
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `-# Sistema de Avisos | Cerberus Store | ${horaAtual()}`
            }
          ]
        }
      ]
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar mensagem' })
  }
})

// ==========================================
// ROTA 3: Chat criado
// ==========================================
app.post('/chat-criado', async (req, res) => {
  const { userId, username, produto } = req.body

  if (!userId || !username) {
    return res.status(400).json({ error: 'Dados incompletos' })
  }

  const valor = VALORES[produto] || 'Não informado'

  try {
    await enviarComponente({
      flags: 32768,
      components: [
        {
          type: 17,
          accent_color: 0xFF0000,
          components: [
            {
              type: 10,
              content: '## Novo Carrinho Aberto!'
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `## <:Pessoas:1498405201844113524>・Usuário\n<@${userId}> (${username})\n## <:Carrinho:1498003085136756959>・Produto\n${produto || 'Não informado'}\n## <a:Flyingmoney:1498405926791675914>・Valor Pago\n${valor}`
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `-# Sistema de Avisos | Cerberus Store | ${horaAtual()}`
            }
          ]
        }
      ]
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar mensagem' })
  }
})

// ==========================================
// ROTA 4: Chat deletado
// ==========================================
app.post('/chat-deletado', async (req, res) => {
  const { userId, username, produto } = req.body

  if (!userId || !username) {
    return res.status(400).json({ error: 'Dados incompletos' })
  }

  try {
    await enviarComponente({
      flags: 32768,
      components: [
        {
          type: 17,
          accent_color: 0xFF0000,
          components: [
            {
              type: 10,
              content: '## Carrinho Fechado!'
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `## <:Pessoas:1498405201844113524>・Usuário\n<@${userId}> (${username})\n## <:Carrinho:1498003085136756959>・Produto\n${produto || 'Não informado'}`
            },
            {
              type: 14
            },
            {
              type: 10,
              content: `-# Sistema de Avisos | Cerberus Store | ${horaAtual()}`
            }
          ]
        }
      ]
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Erro ao enviar mensagem' })
  }
})

server.listen(3000, () => console.log('✅ Backend rodando na porta 3000'))
