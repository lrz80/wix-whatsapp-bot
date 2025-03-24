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
    console.log("Recibido en /api/new-bot:", req.body);

    const { businessName, ownerName, whatsappNumber, openingHours } = req.body;

    if (!businessName || !ownerName || !whatsappNumber || !openingHours) {
      res.status(400).send("ERROR: Datos incompletos");
      return;
    }

    res.send("✅ Servidor recibió la petición y respondió correctamente");
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Error en el servidor");
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
