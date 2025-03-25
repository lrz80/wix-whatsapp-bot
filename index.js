import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';
import pkg from 'pg';

const { Pool } = pkg;

const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/", (req, res) => {
  res.send("🚀 Backend activo y funcionando.");
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Manejo de errores globales que podrían crashear el proceso
process.on('uncaughtException', (err) => {
  console.error('🛑 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🛑 Unhandled Rejection:', reason);
});

app.post('/webhook', async (req, res) => {
  const from = req.body.From; // número que escribió
  const message = req.body.Body; // mensaje que envió

  console.log("📩 Mensaje recibido:", message);
  console.log("🔍 De:", from);

  if (!from || !from.startsWith("whatsapp:")) {
    console.error("❌ Número de origen inválido:", from);
    return res.status(400).send("Número inválido");
  }  

  // Aquí pondríamos lógica para identificar qué negocio es
  const number = from.replace("whatsapp:", "");

const result = await db.query(
  'SELECT * FROM customers WHERE whatsapp = $1',
  [number]
);

if (result.rows.length === 0) {
  await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: from,
    body: "¡Hola! Este número no está registrado. Por favor crea tu bot en la página web."
  });
  return res.sendStatus(200);
}

const customer = result.rows[0];

  // Prompt para que OpenAI responda como si fuera el negocio
  const prompt = `
Eres el chatbot del negocio "${customer.business_name}". 
Atiendes con amabilidad, usando respuestas breves y claras.
Horario: ${customer.opening_hours}.
Servicios ofrecidos: ${customer.services}.
Responde al cliente: "${message}"
`;

  try {
    const completion = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: prompt }],
});

    const reply = completion.choices[0].message.content;

    await client.messages.create({
  from: process.env.TWILIO_PHONE_NUMBER, // ya incluye "whatsapp:"
  to: from, // el número que escribió
  body: reply
});

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));
