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
  try {
    const { businessName, ownerName, whatsappNumber, openingHours } = req.body;

    if (!businessName || !ownerName || !whatsappNumber || !openingHours) {
      return res.status(400).send("❌ Faltan datos obligatorios");
    }

    console.log("📥 Datos recibidos:", req.body);
    console.log("📤 ENVIANDO DESDE:", process.env.TWILIO_PHONE_NUMBER);
    console.log("📬 ENVIANDO A:", `whatsapp:${whatsappNumber}`);

    const welcomeMessage = `👋 ¡Hola ${ownerName}! Tu chatbot para *${businessName}* ha sido creado y estará activo en el horario: ${openingHours}.`;

    try {
  const response = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: `whatsapp:${whatsappNumber}`,
    body: welcomeMessage
  });
  console.log("📨 Respuesta Twilio:", response.sid);
} catch (twilioError) {
  console.error("🚨 Error al enviar mensaje con Twilio:", twilioError);
  return res.status(500).send("❌ Falló el envío con Twilio");
}

    res.send("✅ Bot creado y mensaje enviado correctamente");
  } catch (err) {
    console.error("❌ ERROR en /api/new-bot:", err);
    res.status(500).send("❌ Error interno al enviar el mensaje");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));

setInterval(() => {
  console.log("⏳ Manteniendo el proceso activo...");
}, 10000);

