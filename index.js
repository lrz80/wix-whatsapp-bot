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
  console.log("Recibido en /api/new-bot:", req.body);

  return res.send("✅ Servidor recibió la petición y respondió correctamente");
});

    if (!businessName || !ownerName || !whatsappNumber || !openingHours) {
      return res.status(400).send("ERROR: Datos incompletos");
    }

    const welcomeMessage = `¡Hola ${ownerName}! Tu chatbot para ${businessName} ha sido creado. Atendemos en el horario: ${openingHours}`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${whatsappNumber}`,
      body: welcomeMessage
    });

    res.send("OK: Mensaje enviado correctamente");
  } catch (err) {
    console.error("ERROR en /api/new-bot:", err);
    res.status(500).send("ERROR: No se pudo enviar el mensaje");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
