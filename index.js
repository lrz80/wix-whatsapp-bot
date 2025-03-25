import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';

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

  // Aquí pondríamos lógica para identificar qué negocio es
  const businessInfo = {
    name: "Heladería Ana",
    horario: "Lunes a domingo de 10am a 10pm",
    servicios: "helados, malteadas, postres"
  };

  // Prompt para que OpenAI responda como si fuera el negocio
  const prompt = `Eres el chatbot del negocio "${businessInfo.name}". 
  Atiendes con amabilidad y conoces el horario: ${businessInfo.horario}, 
  y los servicios: ${businessInfo.servicios}. Responde este mensaje de cliente:\n"${message}"`;

  try {
    const completion = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: prompt }],
});

    const reply = completion.choices[0].message.content;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: from,
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
