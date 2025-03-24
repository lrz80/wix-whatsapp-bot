import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.post('/api/new-bot', async (req, res) => {
  const { businessName, ownerName, whatsappNumber, openingHours } = req.body;

  console.log("Datos recibidos:", req.body); // 👈 LOG

  const welcomeMessage = `¡Hola ${ownerName}! Tu chatbot para ${businessName} ha sido creado. Atendemos en el horario: ${openingHours}`;

  app.post('/api/new-bot', async (req, res) => {
  try {
    const { businessName, ownerName, whatsappNumber, openingHours } = req.body;

    if (!businessName || !ownerName || !whatsappNumber || !openingHours) {
      return res.status(400).json({ success: false, message: "Datos incompletos" });
    }

    const welcomeMessage = `¡Hola ${ownerName}! Tu chatbot para ${businessName} ha sido creado. Atendemos en el horario: ${openingHours}`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${whatsappNumber}`,
      body: welcomeMessage
    });

    return res.json({ success: true, message: "Mensaje enviado correctamente" });
  } catch (err) {
    console.error("ERROR en /api/new-bot:", err);
    return res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

  try {
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${whatsappNumber}`,
      body: welcomeMessage
    });

    res.json({ success: true, message: "Mensaje enviado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error enviando mensaje" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
