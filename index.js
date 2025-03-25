import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
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

app.post('/api/new-bot', async (req, res) => {
  try {
    const { businessName, ownerName, whatsappNumber, openingHours } = req.body;

    if (!businessName || !ownerName || !whatsappNumber || !openingHours) {
      console.warn("⚠️ Faltan datos:", req.body);
      return res.status(400).send("❌ Faltan datos obligatorios");
    }

    console.log("📥 Datos recibidos:", req.body);
    console.log("📤 ENVIANDO DESDE:", process.env.TWILIO_PHONE_NUMBER);
    console.log("📬 ENVIANDO A:", `whatsapp:${whatsappNumber}`);

    const welcomeMessage = `👋 ¡Hola ${ownerName}! Tu chatbot para *${businessName}* ha sido creado. Atendemos de ${openingHours}.`;

    try {
      const response = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `whatsapp:${whatsappNumber}`,
        body: welcomeMessage
      });

      console.log("📨 Mensaje enviado. SID:", response.sid);
      res.send("✅ Bot creado y mensaje enviado correctamente");
    } catch (twilioError) {
      console.error("🚨 Error al enviar mensaje con Twilio:", twilioError);
      res.status(500).send("❌ Falló el envío con Twilio");
    }

  } catch (err) {
    console.error("❌ ERROR en /api/new-bot:", err);
    res.status(500).send("❌ Error interno en el servidor");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));
